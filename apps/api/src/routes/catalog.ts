import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { publicLogoUrl } from "../lib/logo-cache.js";
import { getDb, type Db } from "../db/index.js";
import { planChannels } from "../lib/channel-query.js";
import { HttpError, boolParam, installHttpBehaviour, intParam, qs } from "../lib/http.js";
import { parseJsonArray, nowSec, placeholders, prep } from "../lib/sql.js";
import { healthOf, nextShape, nowShape, proxyUrlFor, relayOnlyOf, type ProgrammeRow } from "../lib/views.js";

interface ListRow {
  id: string;
  name: string;
  country: string | null;
  country_name: string | null;
  flag: string | null;
  categories: string;
  languages: string;
  network: string | null;
  is_nsfw: number;
  logo_url: string | null;
  stream_count: number;
  best_quality: string | null;
  online_count: number;
  guide_count: number;
  probed: number;
  number: number | null;
}

const LIST_COLUMNS = `c.id, c.name, c.country, co.name AS country_name, co.flag AS flag, c.categories, c.languages,
  c.network, c.is_nsfw, c.logo_url, c.stream_count, c.best_quality, c.online_count, c.guide_count, c.number,
  EXISTS(SELECT 1 FROM streams s WHERE s.channel = c.id AND s.status IS NOT NULL) AS probed`;

/** online: true if a stream passed its last check, false if probed but none online, null if never probed. */
const onlineOf = (r: ListRow) => (r.online_count > 0 ? true : r.probed ? false : null);

function hasHealthData(db: Db): boolean {
  return prep(db, "SELECT 1 FROM streams WHERE status IS NOT NULL LIMIT 1").get() !== undefined;
}

function currentProgrammes(db: Db, ids: string[], now: number): Map<string, ProgrammeRow> {
  const out = new Map<string, ProgrammeRow>();
  if (ids.length === 0) return out;
  const rows = prep(
    db,
    `SELECT channel, title, start_ts, stop_ts, description, category, icon FROM programmes
     WHERE channel IN (${placeholders(ids.length)}) AND start_ts <= ? AND stop_ts > ?
     ORDER BY channel, start_ts DESC`,
  ).all(...ids, now, now) as Array<ProgrammeRow & { channel: string }>;
  for (const r of rows) if (!out.has(r.channel)) out.set(r.channel, r);
  return out;
}

function meta(db: Db) {
  const rows = prep(db, "SELECT key, value FROM meta WHERE key IN ('counts', 'last_ingest', 'last_epg_import')").all() as Array<{
    key: string;
    value: string;
  }>;
  const kv = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let counts: { channels?: number; streams?: number; channelsWithStreams?: number } = {};
  try {
    counts = JSON.parse(kv.counts ?? "{}");
  } catch {
    counts = {};
  }
  // Before the first ingest the counts key is absent; fall back to live counts.
  const live = prep(
    db,
    `SELECT (SELECT COUNT(*) FROM channels) AS channels, (SELECT COUNT(*) FROM streams) AS streams,
            (SELECT COUNT(*) FROM channels WHERE has_stream = 1) AS channelsWithStreams`,
  ).get() as { channels: number; streams: number; channelsWithStreams: number };
  const programmes = (prep(db, "SELECT COUNT(*) AS n FROM programmes").get() as { n: number }).n;
  const num = (v: string | undefined) => (v === undefined ? null : Number(v));
  return {
    channels: counts.channels ?? live.channels,
    streams: counts.streams ?? live.streams,
    channelsWithStreams: counts.channelsWithStreams ?? live.channelsWithStreams,
    lastIngest: num(kv.last_ingest),
    lastEpgImport: num(kv.last_epg_import),
    programmes,
    proxyEnabled: config.proxyEnabled && config.proxySecret !== "",
    hideNsfwDefault: config.hideNsfwDefault,
    version: config.version,
    health: healthMeta(db),
  };
}

/** Stream health summary from the prober's rows on `streams` (probed = has a published status). */
function healthMeta(db: Db) {
  const row = prep(
    db,
    "SELECT COUNT(CASE WHEN status IS NOT NULL THEN 1 END) AS probed, COUNT(CASE WHEN status = 'online' THEN 1 END) AS online FROM streams",
  ).get() as { probed: number; online: number };
  const last = prep(db, "SELECT value FROM meta WHERE key = 'last_probe'").get() as { value: string } | undefined;
  return { probed: row.probed, online: row.online, lastProbe: last ? Number(last.value) : null };
}

/** How long the /api/meta body is reused (see also GAUGE_TTL_MS for /metrics). */
const META_TTL_MS = 15_000;
let metaCache: { at: number; body: ReturnType<typeof meta> } | null = null;

function cachedMeta(db: Db): ReturnType<typeof meta> {
  const now = Date.now();
  if (metaCache && now - metaCache.at < META_TTL_MS) return metaCache.body;
  const body = meta(db);
  metaCache = { at: now, body };
  return body;
}

/** Test hook: drop the cached /api/meta body so the next request reads the database. */
export function resetMetaCache(): void {
  metaCache = null;
}

export async function catalogRoutes(app: FastifyInstance) {
  installHttpBehaviour(app);

  app.get("/api/meta", async () => cachedMeta(getDb()));

  app.get("/api/categories", async (req) => {
    const db = getDb();
    const col = boolParam(qs((req.query as Record<string, unknown>).withStreams), "withStreams", false)
      ? "stream_count"
      : "channel_count";
    const rows = prep(
      db,
      `SELECT id, name, description, ${col} AS n FROM categories WHERE ${col} > 0 ORDER BY name COLLATE NOCASE, id`,
    ).all() as Array<{ id: string; name: string; description: string | null; n: number }>;
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, channelCount: r.n }));
  });

  app.get("/api/countries", async (req) => {
    const db = getDb();
    const col = boolParam(qs((req.query as Record<string, unknown>).withStreams), "withStreams", false)
      ? "stream_count"
      : "channel_count";
    const rows = prep(
      db,
      `SELECT code, name, flag, ${col} AS n FROM countries WHERE ${col} > 0 ORDER BY name COLLATE NOCASE, code`,
    ).all() as Array<{ code: string; name: string; flag: string | null; n: number }>;
    return rows.map((r) => ({ code: r.code, name: r.name, flag: r.flag, channelCount: r.n }));
  });

  app.get("/api/languages", async (req) => {
    const db = getDb();
    const col = boolParam(qs((req.query as Record<string, unknown>).withStreams), "withStreams", false)
      ? "stream_count"
      : "channel_count";
    const rows = prep(
      db,
      `SELECT code, name, ${col} AS n FROM languages WHERE ${col} > 0 ORDER BY name COLLATE NOCASE, code`,
    ).all() as Array<{ code: string; name: string; n: number }>;
    return rows.map((r) => ({ code: r.code, name: r.name, channelCount: r.n }));
  });

  app.get("/api/channels", async (req) => {
    const db = getDb();
    const plan = planChannels(req.query as Record<string, unknown>, {
      hideNsfwDefault: config.hideNsfwDefault,
      hasHealth: () => hasHealthData(db),
    });
    const total = (prep(db, `SELECT COUNT(*) AS n FROM ${plan.from} ${plan.where}`).get(...plan.args) as { n: number }).n;
    const rows = prep(
      db,
      `SELECT ${LIST_COLUMNS} FROM ${plan.from} LEFT JOIN countries co ON co.code = c.country
       ${plan.where} ORDER BY ${plan.orderBy} LIMIT ? OFFSET ?`,
    ).all(...plan.args, plan.limit, (plan.page - 1) * plan.limit) as ListRow[];

    const now = plan.withNow ? nowSec() : 0;
    const current = plan.withNow ? currentProgrammes(db, rows.map((r) => r.id), now) : null;

    const items = rows.map((r) => {
      const base = {
        id: r.id,
        number: r.number,
        name: r.name,
        country: r.country,
        countryName: r.country_name,
        flag: r.flag,
        categories: parseJsonArray(r.categories),
        languages: parseJsonArray(r.languages),
        network: r.network,
        isNsfw: r.is_nsfw === 1,
        logo: publicLogoUrl(r.id, r.logo_url),
        streamCount: r.stream_count,
        bestQuality: r.best_quality,
        online: onlineOf(r),
        hasGuide: r.guide_count > 0,
      };
      if (!current) return base;
      const p = current.get(r.id);
      return { ...base, now: p ? nowShape(p) : null };
    });

    return { total, page: plan.page, limit: plan.limit, items };
  });

  // Channel number lookup (numbers are per-instance; see schema.sql channel_numbers).
  app.get("/api/channels/number/:n", async (req) => {
    const n = intParam((req.params as { n: string }).n, "n", 1, 1);
    const row = prep(getDb(), "SELECT id FROM channels WHERE number = ? AND blocked = 0").get(n) as { id: string } | undefined;
    if (!row) throw new HttpError(404, "channel not found");
    const res = await app.inject({ method: "GET", url: `/api/channels/${encodeURIComponent(row.id)}` });
    return res.json();
  });

  app.get("/api/channels/:id", async (req) => {
    const db = getDb();
    const { id } = req.params as { id: string };
    const ch = prep(
      db,
      `SELECT c.id, c.name, c.alt_names, c.network, c.owners, c.country, co.name AS country_name, co.flag AS flag,
              c.categories, c.languages, c.broadcast_area, c.is_nsfw, c.launched, c.closed, c.replaced_by,
              c.website, c.logo_url, c.number
       FROM channels c LEFT JOIN countries co ON co.code = c.country WHERE c.id = ? AND c.blocked = 0`,
    ).get(id) as
      | {
          id: string;
          name: string;
          alt_names: string;
          network: string | null;
          owners: string;
          country: string | null;
          country_name: string | null;
          flag: string | null;
          categories: string;
          languages: string;
          broadcast_area: string;
          is_nsfw: number;
          launched: string | null;
          closed: string | null;
          replaced_by: string | null;
          website: string | null;
          logo_url: string | null;
          number: number | null;
        }
      | undefined;
    if (!ch) throw new HttpError(404, "channel not found");

    const catNames = new Map(
      (prep(db, "SELECT id, name FROM categories").all() as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
    );
    const langName = prep(db, "SELECT name FROM languages WHERE code = ?");

    const streams = (
      prep(
        db,
        `SELECT idx, url, title, quality, quality_rank, labels, feed, user_agent, referrer, status, last_checked
         FROM streams WHERE channel = ?
         ORDER BY CASE status WHEN 'online' THEN 0 WHEN 'offline' THEN 2 ELSE 1 END,
                  CASE WHEN lower(trim(url)) LIKE 'https://%' THEN 0 ELSE 1 END,
                  quality_rank DESC, idx`,
      ).all(id) as Array<{
        idx: number;
        url: string;
        title: string | null;
        quality: string | null;
        quality_rank: number;
        labels: string;
        feed: string | null;
        user_agent: string | null;
        referrer: string | null;
        status: string | null;
        last_checked: number | null;
      }>
    ).map((s) => {
      const proxyUrl = proxyUrlFor(s.url, s.user_agent, s.referrer);
      return {
        index: s.idx,
        url: s.url,
        title: s.title,
        quality: s.quality,
        labels: parseJsonArray(s.labels),
        feed: s.feed,
        userAgent: s.user_agent,
        referrer: s.referrer,
        online: healthOf(s.status),
        lastChecked: s.last_checked,
        relayOnly: relayOnlyOf(s.user_agent, s.referrer),
        ...(proxyUrl !== undefined ? { proxyUrl } : {}),
      };
    });

    const guides = (
      prep(db, "SELECT site, site_id, lang FROM guides WHERE channel = ? ORDER BY rowid").all(id) as Array<{
        site: string;
        site_id: string;
        lang: string | null;
      }>
    ).map((g) => ({ site: g.site, siteId: g.site_id, lang: g.lang }));

    const now = nowSec();
    const cur = prep(
      db,
      `SELECT title, start_ts, stop_ts, description, category, icon FROM programmes
       WHERE channel = ? AND start_ts <= ? AND stop_ts > ? ORDER BY start_ts DESC LIMIT 1`,
    ).get(id, now, now) as ProgrammeRow | undefined;
    const nextQuery = prep(
      db,
      `SELECT title, start_ts, stop_ts FROM programmes WHERE channel = ? AND start_ts >= ? ORDER BY start_ts LIMIT 1`,
    );
    const next = cur
      ? (nextQuery.get(id, cur.stop_ts) as ProgrammeRow | undefined)
      : (prep(
          db,
          `SELECT title, start_ts, stop_ts FROM programmes WHERE channel = ? AND start_ts > ? ORDER BY start_ts LIMIT 1`,
        ).get(id, now) as ProgrammeRow | undefined);

    return {
      id: ch.id,
      name: ch.name,
      altNames: parseJsonArray(ch.alt_names),
      network: ch.network,
      owners: parseJsonArray(ch.owners),
      country: ch.country,
      countryName: ch.country_name,
      flag: ch.flag,
      categories: parseJsonArray(ch.categories).map((cid) => ({ id: cid, name: catNames.get(cid) ?? cid })),
      languages: parseJsonArray(ch.languages).map((code) => {
        const row = langName.get(code) as { name: string } | undefined;
        return { code, name: row?.name ?? code };
      }),
      broadcastArea: parseJsonArray(ch.broadcast_area),
      isNsfw: ch.is_nsfw === 1,
      launched: ch.launched,
      closed: ch.closed,
      replacedBy: ch.replaced_by,
      website: ch.website,
      logo: publicLogoUrl(ch.id, ch.logo_url),
      number: ch.number,
      streams,
      guides,
      now: cur ? nowShape(cur) : null,
      next: next ? nextShape(next) : null,
    };
  });
}
