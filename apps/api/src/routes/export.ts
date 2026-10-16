import fs from "node:fs";
import zlib from "node:zlib";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getDb, getMeta } from "../db/index.js";
import { HttpError, badRequest, boolParam, qs } from "../lib/http.js";
import { loadExportChannels } from "../lib/export-query.js";
import { renderM3u } from "../lib/export-m3u.js";
import { acceptsGzip, guideEtag, gzipIsCurrent, isNotModified } from "../lib/export-guide.js";
import { getSettings, publicBase, settingsGeneration } from "../lib/settings.js";
import { prep } from "../lib/sql.js";
import { proxyUrlFor } from "../lib/views.js";
import { guideGzPath } from "../epg/importer.js";

// Playlist memo: rendering a 2.7 MB playlist costs ~160 ms (300 ms with proxy=true), and TV apps and
// browsers refetch it often. Bodies are reused for 60 s per normalised query + base URL. An entry is
// dropped as soon as meta.last_ingest differs from the value it was rendered under.
const PLAYLIST_TTL_MS = 60_000;
const PLAYLIST_MEMO_MAX_ENTRIES = 50;
/** Extra bound beyond the entry count: a full proxy=true playlist is ~6 MB, so 50 of them is 300 MB. */
const PLAYLIST_MEMO_MAX_BYTES = 64 * 1024 * 1024;

interface MemoEntry {
  body: string;
  at: number;
  ingest: string | null;
}
/** Insertion order is recency order (a hit re-inserts its entry), so the first key is the LRU one. */
const playlistMemo = new Map<string, MemoEntry>();
let playlistMemoBytes = 0;

/** Stable key: base URL plus the query's parameters sorted by name then value, repeats kept. */
function playlistKey(base: string, query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const k of Object.keys(query)) {
    const v = query[k];
    for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined) params.append(k, String(item));
  }
  params.sort();
  return `${base}?${params.toString()}`;
}

function memoGet(key: string, ingest: string | null, now: number): string | null {
  const e = playlistMemo.get(key);
  if (!e) return null;
  if (e.ingest !== ingest || now - e.at >= PLAYLIST_TTL_MS) {
    playlistMemoDelete(key);
    return null;
  }
  playlistMemo.delete(key);
  playlistMemo.set(key, e);
  return e.body;
}

function memoPut(key: string, body: string, now: number, ingest: string | null) {
  playlistMemoDelete(key);
  playlistMemo.set(key, { body, at: now, ingest });
  playlistMemoBytes += body.length;
  while (playlistMemo.size > PLAYLIST_MEMO_MAX_ENTRIES || (playlistMemoBytes > PLAYLIST_MEMO_MAX_BYTES && playlistMemo.size > 1)) {
    const oldest = playlistMemo.keys().next().value as string;
    playlistMemoDelete(oldest);
  }
}

function playlistMemoDelete(key: string) {
  const e = playlistMemo.get(key);
  if (!e) return;
  playlistMemoBytes -= e.body.length;
  playlistMemo.delete(key);
}

/** Stats of the prebuilt gzip copy when it exists and is at least as new as the source; otherwise null. */
async function currentGzip(file: string, src: fs.Stats): Promise<fs.Stats | null> {
  try {
    const gz = await fs.promises.stat(guideGzPath(file));
    return gz.isFile() && gzipIsCurrent(gz, src) ? gz : null;
  } catch {
    return null;
  }
}

/** A filename safe in a quoted Content-Disposition value: ASCII letters, digits, space, dot, dash, underscore. */
export function safeFilename(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9 ._-]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  // A name with no ASCII letters or digits (e.g. all CJK) falls back to the channel id.
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback.replace(/[^A-Za-z0-9._-]+/g, "_");
}

// TRACK J: /api/playlist.m3u and /api/guide.xml per docs/API.md "Exports"
export async function exportRoutes(app: FastifyInstance) {
  // Scoped to this plugin. Not installHttpBehaviour: its onSend hook would overwrite the export Cache-Control.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/api/playlist.m3u", async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const proxy = boolParam(qs(query.proxy), "proxy", false);
    const streamsRaw = (qs(query.streams) ?? "").trim().toLowerCase() || "best";
    if (streamsRaw !== "best" && streamsRaw !== "all") throw badRequest("streams must be best or all");

    const settings = getSettings();
    const base = publicBase(req);
    // The memo also depends on the settings (site name, public URL): a write bumps the generation.
    const ingest = `${getMeta("last_ingest")}|${settingsGeneration()}`;
    const key = playlistKey(base, query);
    let body = memoGet(key, ingest, Date.now());
    if (body === null) {
      const result = loadExportChannels(getDb(), query, { hideNsfwDefault: config.hideNsfwDefault });
      body = renderM3u(result.channels, {
        base,
        siteName: settings.siteName,
        proxy,
        streams: streamsRaw,
        proxyPathFor: (s, exp) => proxyUrlFor(s.url, s.userAgent, s.referrer, exp),
        truncated: result.truncated,
      });
      memoPut(key, body, Date.now(), ingest);
    }

    reply.header("content-type", "audio/x-mpegurl; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="freetv.m3u"');
    reply.header("cache-control", "public, max-age=300");
    return reply.send(body);
  });

  // One channel, every stream, origin URLs (never relayed): what "Open in app" hands to a player.
  app.get("/api/channels/:id/playlist.m3u", async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const ch = prep(db, "SELECT name, number, blocked FROM channels WHERE id = ?").get(id) as
      | { name: string; number: number | null; blocked: number }
      | undefined;
    if (!ch || ch.blocked) throw new HttpError(404, "channel not found");

    // Same loader as the full export. favorites=<id> narrows it to this channel; nsfw=true because the
    // channel detail endpoint shows NSFW channels too, and the blocked check above already ran.
    const result = loadExportChannels(db, { favorites: id, nsfw: "true" }, { hideNsfwDefault: config.hideNsfwDefault });
    const settings = getSettings();
    const body = renderM3u(
      result.channels.map((c) => ({ ...c, number: ch.number })),
      {
        base: publicBase(req),
        siteName: settings.siteName,
        proxy: false,
        streams: "all",
        proxyPathFor: () => undefined,
        truncated: false,
      },
    );

    reply.header("content-type", "audio/x-mpegurl; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${safeFilename(ch.name, id)}.m3u"`);
    reply.header("cache-control", "public, max-age=300");
    return reply.send(body);
  });

  app.get("/api/guide.xml", async (req, reply) => {
    const file = config.epgFile;
    const noGuide = () => reply.code(404).send({ error: "no guide yet" });
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(file);
    } catch {
      return noGuide();
    }
    if (!st.isFile()) return noGuide();

    // Serve the importer's prebuilt gzip copy when the client takes gzip and the copy is not older than
    // the source. Its validators are its own (ETag and Last-Modified from the .gz file).
    const wantGzip = acceptsGzip(req.headers["accept-encoding"]);
    const gz = wantGzip ? await currentGzip(file, st) : null;
    const variant = gz ?? st;

    const etag = guideEtag(variant);
    reply.header("etag", etag);
    reply.header("last-modified", variant.mtime.toUTCString());
    reply.header("cache-control", "public, max-age=600");
    reply.header("vary", "Accept-Encoding");
    if (isNotModified(req.headers, etag, variant.mtime)) return reply.code(304).send();

    reply.header("content-type", "application/xml");
    if (gz) {
      reply.header("content-encoding", "gzip");
      reply.header("content-length", String(gz.size));
      return reply.send(fs.createReadStream(guideGzPath(file)));
    }
    if (wantGzip) {
      // No Content-Length: the compressed size is not known up front.
      const gz = zlib.createGzip();
      const src = fs.createReadStream(file);
      src.on("error", (e) => gz.destroy(e));
      src.pipe(gz);
      reply.header("content-encoding", "gzip");
      return reply.send(gz);
    }
    reply.header("content-length", String(st.size));
    return reply.send(fs.createReadStream(file));
  });
}
