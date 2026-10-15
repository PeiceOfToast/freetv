import fs from "node:fs";
import zlib from "node:zlib";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { HttpError, badRequest, boolParam, qs } from "../lib/http.js";
import { loadExportChannels } from "../lib/export-query.js";
import { renderM3u } from "../lib/export-m3u.js";
import { acceptsGzip, guideEtag, isNotModified } from "../lib/export-guide.js";
import { proxyUrlFor } from "../lib/views.js";

const firstValue = (v: string | string[] | undefined): string | undefined => {
  const first = (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  return first ? first : undefined;
};

/** PUBLIC_URL when set, else the request's (forwarded) scheme and host. */
function absoluteBase(req: FastifyRequest): string {
  const pinned = config.publicUrl.replace(/\/+$/, "");
  if (pinned) return pinned;
  const proto = firstValue(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const host = firstValue(req.headers["x-forwarded-host"]) ?? firstValue(req.headers.host) ?? "localhost";
  return `${proto}://${host}`;
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

    const result = loadExportChannels(getDb(), query, { hideNsfwDefault: config.hideNsfwDefault });
    const body = renderM3u(result.channels, {
      base: absoluteBase(req),
      proxy,
      streams: streamsRaw,
      proxyPathFor: (s) => proxyUrlFor(s.url, s.userAgent, s.referrer),
      truncated: result.truncated,
    });

    reply.header("content-type", "audio/x-mpegurl; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="freetv.m3u"');
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

    const etag = guideEtag(st);
    reply.header("etag", etag);
    reply.header("last-modified", st.mtime.toUTCString());
    reply.header("cache-control", "public, max-age=600");
    reply.header("vary", "Accept-Encoding");
    if (isNotModified(req.headers, etag, st.mtime)) return reply.code(304).send();

    reply.header("content-type", "application/xml");
    if (acceptsGzip(req.headers["accept-encoding"])) {
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
