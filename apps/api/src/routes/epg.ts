import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { nowSeconds } from "../epg/time.js";

const HOUR = 3600;
const DAY = 24 * HOUR;
const MAX_CHANNEL_WINDOW = 7 * DAY;
const MAX_GRID_WINDOW = DAY;
const MAX_NOW_IDS = 200;
const MAX_GRID_IDS = 100;
const CACHE = "public, max-age=60";

interface ProgRow {
  channel: string;
  title: string;
  description: string | null;
  start_ts: number;
  stop_ts: number;
  category: string | null;
  icon: string | null;
}

export interface ProgrammeJson {
  title: string;
  description: string | null;
  start: number;
  stop: number;
  category: string | null;
  icon: string | null;
}

class BadRequest extends Error {}

const toJson = (r: ProgRow): ProgrammeJson => ({
  title: r.title,
  description: r.description ?? null,
  start: r.start_ts,
  stop: r.stop_ts,
  category: r.category ?? null,
  icon: r.icon ?? null,
});

/** Optional integer query param. Absent or empty gives undefined; anything else non-integer is a 400. */
function tsParam(q: Record<string, unknown>, name: string): number | undefined {
  const v = q[name];
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) throw new BadRequest(`${name} must be an integer unix timestamp`);
  return Number(v);
}

/** Comma-separated id list: trimmed, deduplicated, required, at most `max`. */
function idsParam(q: Record<string, unknown>, max: number): string[] {
  const v = q["ids"];
  if (typeof v !== "string") throw new BadRequest("ids is required (comma-separated channel ids)");
  const ids = [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) throw new BadRequest("ids is required (comma-separated channel ids)");
  if (ids.length > max) throw new BadRequest(`at most ${max} ids per request`);
  return ids;
}

function resolveWindow(q: Record<string, unknown>, defFrom: number, defTo: number, maxSpan: number) {
  const from = tsParam(q, "from") ?? defFrom;
  const to = tsParam(q, "to") ?? defTo;
  if (from >= to) throw new BadRequest("from must be before to");
  if (to - from > maxSpan) throw new BadRequest(`window must not exceed ${maxSpan / HOUR} hours`);
  return { from, to };
}

export async function epgRoutes(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof BadRequest) return reply.code(400).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    const message = err instanceof Error ? err.message : "internal error";
    return reply.code(status).send({ error: status >= 500 ? "internal error" : message });
  });

  // Programmes of one channel overlapping [from, to). Defaults: now-2h .. now+24h, max 7 days.
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/channels/:id/epg",
    async (req, reply) => {
      const id = req.params.id;
      if (!id) throw new BadRequest("channel id is required");
      const now = nowSeconds();
      const { from, to } = resolveWindow(req.query, now - 2 * HOUR, now + DAY, MAX_CHANNEL_WINDOW);
      const rows = getDb()
        .prepare(
          `SELECT channel, title, description, start_ts, stop_ts, category, icon FROM programmes
           WHERE channel = ? AND start_ts < ? AND stop_ts > ? ORDER BY start_ts`,
        )
        .all(id, to, from) as ProgRow[];
      reply.header("Cache-Control", CACHE);
      return { channel: id, items: rows.map(toJson) };
    },
  );

  // Now and next for up to 200 channels. Two queries total (one for now, one for next), grouped in JS.
  app.get<{ Querystring: Record<string, unknown> }>("/api/epg/now", async (req, reply) => {
    const ids = idsParam(req.query, MAX_NOW_IDS);
    const t = nowSeconds();
    const db = getDb();
    const marks = ids.map(() => "?").join(",");

    // Overlapping "now" rows, latest start first, so the first row per channel wins.
    const nowRows = db
      .prepare(
        `SELECT channel, title, description, start_ts, stop_ts, category, icon FROM programmes
         WHERE channel IN (${marks}) AND start_ts <= ? AND stop_ts > ? ORDER BY start_ts DESC`,
      )
      .all(...ids, t, t) as ProgRow[];

    // First programme starting after t, per channel: one row per channel via ROW_NUMBER().
    const nextRows = db
      .prepare(
        `SELECT channel, title, description, start_ts, stop_ts, category, icon FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY channel ORDER BY start_ts) AS rn
           FROM programmes WHERE channel IN (${marks}) AND start_ts > ?
         ) WHERE rn = 1`,
      )
      .all(...ids, t) as ProgRow[];

    const nowBy = new Map<string, ProgRow>();
    for (const r of nowRows) if (!nowBy.has(r.channel)) nowBy.set(r.channel, r);
    const nextBy = new Map<string, ProgRow>();
    for (const r of nextRows) nextBy.set(r.channel, r);

    const out: Record<string, { now: ProgrammeJson | null; next: ProgrammeJson | null }> = {};
    for (const id of ids) {
      const n = nowBy.get(id);
      const x = nextBy.get(id);
      out[id] = { now: n ? toJson(n) : null, next: x ? toJson(x) : null };
    }
    reply.header("Cache-Control", CACHE);
    return out;
  });

  // Programmes overlapping [from, to) for up to 100 channels. Default window: now-2h .. now+22h (24 h).
  app.get<{ Querystring: Record<string, unknown> }>("/api/epg/grid", async (req, reply) => {
    const ids = idsParam(req.query, MAX_GRID_IDS);
    const now = nowSeconds();
    const { from, to } = resolveWindow(req.query, now - 2 * HOUR, now - 2 * HOUR + MAX_GRID_WINDOW, MAX_GRID_WINDOW);
    const marks = ids.map(() => "?").join(",");
    const rows = getDb()
      .prepare(
        `SELECT channel, title, description, start_ts, stop_ts, category, icon FROM programmes
         WHERE channel IN (${marks}) AND start_ts < ? AND stop_ts > ? ORDER BY channel, start_ts`,
      )
      .all(...ids, to, from) as ProgRow[];

    const channels: Record<string, ProgrammeJson[]> = {};
    for (const id of ids) channels[id] = [];
    for (const r of rows) channels[r.channel]?.push(toJson(r));
    reply.header("Cache-Control", CACHE);
    return { from, to, channels };
  });
}
