import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getDb, getMeta, type Db } from "../db/index.js";
import { isProbeRunning } from "../prober/index.js";
import { logoCacheStats } from "../lib/logo-cache.js";
import { Gauge, HttpMetrics, renderMetrics } from "../lib/metrics.js";

// TRACK ADMIN: GET /api/admin/status (Bearer ADMIN_TOKEN) and GET /metrics (no auth, not proxied by Caddy).
// See docs/API.md "Admin". The POST admin endpoints stay in server.ts.

const SKIP_OVERRIDE = Symbol.for("skip-override");

/**
 * Constant-time check of an `Authorization` header against `Bearer <token>`. Both sides are hashed first
 * so the comparison takes the same time whatever the lengths. An empty token never matches.
 */
export function bearerTokenOk(header: unknown, token: string): boolean {
  if (token === "") return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(String(header ?? "")), digest(`Bearer ${token}`));
}

function tokenOk(req: FastifyRequest): boolean {
  return bearerTokenOk(req.headers["authorization"], config.adminToken);
}

/** How long the /metrics gauges and the /api/meta body are reused. */
export const GAUGE_TTL_MS = 15_000;

const num = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

function fileStat(p: string): { size: number; mtimeMs: number } | null {
  try {
    const st = fs.statSync(p);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** Where the last ingest's datasets came from, read from the ETag store (ingest does not record it in meta). */
function ingestSource(): "primary" | "mirror" | null {
  try {
    const etags = JSON.parse(fs.readFileSync(`${config.rawDir}/etags.json`, "utf8")) as Record<string, { source?: string }>;
    const src = etags.channels?.source;
    if (src === config.iptvApiBase) return "primary";
    if (src === config.iptvApiMirror) return "mirror";
    return null;
  } catch {
    return null;
  }
}

export interface AdminStatus {
  version: string;
  uptime: number;
  now: number;
  catalog: { channels: number; withStreams: number; streams: number; lastIngest: number | null; lastIngestMs: number | null; source: "primary" | "mirror" | null };
  epg: { programmes: number; lastImport: number | null; file: { exists: boolean; size: number; mtime: number | null } };
  health: { probed: number; online: number; offline: number; lastProbe: number | null; lastProbeMs: number | null; running: boolean };
  logos: { cached: number; bytes: number };
  proxy: { enabled: boolean };
  db: { bytes: number; walBytes: number };
}

/** Everything the status endpoint reports. Also feeds the gauges on /metrics. */
export function collectStatus(db: Db = getDb()): AdminStatus {
  const counts = (() => {
    try {
      return JSON.parse(getMeta("counts") ?? "{}") as { channels?: number; streams?: number; channelsWithStreams?: number };
    } catch {
      return {};
    }
  })();
  const live = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM channels) AS channels, (SELECT COUNT(*) FROM streams) AS streams,
              (SELECT COUNT(*) FROM channels WHERE has_stream = 1) AS withStreams,
              (SELECT COUNT(*) FROM programmes) AS programmes,
              (SELECT COUNT(CASE WHEN status IS NOT NULL THEN 1 END) FROM streams) AS probed,
              (SELECT COUNT(CASE WHEN status = 'online' THEN 1 END) FROM streams) AS online,
              (SELECT COUNT(CASE WHEN status = 'offline' THEN 1 END) FROM streams) AS offline`,
    )
    .get() as { channels: number; streams: number; withStreams: number; programmes: number; probed: number; online: number; offline: number };

  const epgFile = fileStat(config.epgFile);
  const dbFile = db.name;
  const dbMain = fileStat(dbFile);
  const dbWal = fileStat(`${dbFile}-wal`);
  const logos = config.logoCacheEnabled ? logoCacheStats() : { cached: 0, bytes: 0 };

  return {
    version: config.version,
    uptime: Math.floor(process.uptime()),
    now: Math.floor(Date.now() / 1000),
    catalog: {
      channels: counts.channels ?? live.channels,
      withStreams: counts.channelsWithStreams ?? live.withStreams,
      streams: counts.streams ?? live.streams,
      lastIngest: num(getMeta("last_ingest")),
      lastIngestMs: num(getMeta("last_ingest_ms")), // duration of the last catalog rebuild
      source: ingestSource(),
    },
    epg: {
      programmes: live.programmes,
      lastImport: num(getMeta("last_epg_import")),
      file: epgFile
        ? { exists: true, size: epgFile.size, mtime: Math.floor(epgFile.mtimeMs / 1000) }
        : { exists: false, size: 0, mtime: null },
    },
    health: {
      probed: live.probed,
      online: live.online,
      offline: live.offline,
      lastProbe: num(getMeta("last_probe")),
      lastProbeMs: num(getMeta("last_probe_ms")),
      running: isProbeRunning(),
    },
    logos,
    proxy: { enabled: config.proxyEnabled && config.proxySecret !== "" },
    db: { bytes: dbMain?.size ?? 0, walBytes: dbWal?.size ?? 0 },
  };
}

/** The numbers /metrics exposes as gauges. Computed at most once per GAUGE_TTL_MS (COUNT(*) over the catalog is not free). */
interface GaugeValues {
  channels: number;
  withStreams: number;
  online: number;
  programmes: number;
  lastIngest: number;
  lastEpgImport: number;
  lastProbe: number;
}
let gaugeCache: { at: number; values: GaugeValues } | null = null;

function gaugeValues(): GaugeValues {
  const now = Date.now();
  if (gaugeCache && now - gaugeCache.at < GAUGE_TTL_MS) return gaugeCache.values;
  const s = collectStatus();
  const values: GaugeValues = {
    channels: s.catalog.channels,
    withStreams: s.catalog.withStreams,
    online: s.health.online,
    programmes: s.epg.programmes,
    lastIngest: s.catalog.lastIngest ?? 0,
    lastEpgImport: s.epg.lastImport ?? 0,
    lastProbe: s.health.lastProbe ?? 0,
  };
  gaugeCache = { at: now, values };
  return values;
}

/** Test hook: drop the cached /metrics gauges so the next scrape reads the database. */
export function resetMetricsCache(): void {
  gaugeCache = null;
}

// Encapsulation: without this flag the onResponse hook below would only see routes inside this plugin.
// It is the flag fastify-plugin sets; it must be on the function before register() reads it.
Object.defineProperty(adminRoutes, SKIP_OVERRIDE, { value: true });

export async function adminRoutes(app: FastifyInstance) {
  const http = new HttpMetrics();
  app.addHook("onResponse", async (req, reply) => {
    http.observe(req.routeOptions.url, reply.statusCode, reply.elapsedTime / 1000);
  });

  app.get("/api/admin/status", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!tokenOk(req)) return reply.code(401).send({ error: "unauthorized" });
    return collectStatus();
  });

  app.get("/metrics", async (_req, reply) => {
    const s = gaugeValues();
    const gauge = (name: string, help: string, v: number) => {
      const g = new Gauge(name, help);
      g.set(v);
      return g;
    };
    const body = renderMetrics([
      gauge("freetv_channels_total", "Channels in the catalog (blocked included).", s.channels),
      gauge("freetv_channels_with_streams", "Channels with at least one stream.", s.withStreams),
      gauge("freetv_streams_online", "Streams whose last probe was online.", s.online),
      gauge("freetv_programmes_total", "Guide programmes stored.", s.programmes),
      gauge("freetv_ingest_last_timestamp", "Unix time of the last catalog rebuild (0 = never).", s.lastIngest),
      gauge("freetv_epg_last_import_timestamp", "Unix time of the last XMLTV import (0 = never).", s.lastEpgImport),
      gauge("freetv_probe_last_timestamp", "Unix time of the last stream probe pass (0 = never).", s.lastProbe),
      http.requests,
      http.duration,
    ]);
    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    return body;
  });
}
