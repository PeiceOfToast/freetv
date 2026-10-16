import path from "node:path";

const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === "" ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase());
const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? "/data",
  get dbPath() {
    return path.join(this.dataDir, "catalog.db");
  },
  get rawDir() {
    return path.join(this.dataDir, "raw");
  },
  iptvApiBase: (process.env.IPTV_API_BASE ?? "https://iptv-org.github.io/api").replace(/\/$/, ""),
  iptvApiMirror: "https://raw.githubusercontent.com/iptv-org/api/gh-pages",
  ingestIntervalHours: num(process.env.INGEST_INTERVAL_HOURS, 6),
  hideNsfwDefault: bool(process.env.HIDE_NSFW_DEFAULT, true),
  proxyEnabled: bool(process.env.PROXY_ENABLED, true),
  proxySecret: /^change-me/i.test(process.env.PROXY_SECRET ?? "") ? "" : (process.env.PROXY_SECRET ?? ""),
  proxyPublicPath: (process.env.PROXY_PUBLIC_PATH ?? "/proxy").replace(/\/$/, ""),
  /** Lifetime of relay URLs in channel responses (seconds from issue). The proxy rejects them after exp. */
  proxyUrlTtlSeconds: num(process.env.PROXY_URL_TTL_SECONDS, 86400),
  /** Lifetime of relay URLs in playlist.m3u?proxy=true (seconds from issue). */
  proxyExportTtlSeconds: num(process.env.PROXY_EXPORT_TTL_SECONDS, 604800),
  adminToken: process.env.ADMIN_TOKEN ?? "",
  /** Public base URL of this instance (e.g. https://tv.example.com); used to build absolute URLs in exports. Empty = derive from request. */
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/$/, ""),
  epgFile: process.env.EPG_FILE ?? path.join(process.env.DATA_DIR ?? "/data", "epg", "guide.xml"),
  epgPollSeconds: num(process.env.EPG_POLL_SECONDS, 60),
  // Stream health prober (TRACK P)
  probeEnabled: bool(process.env.PROBE_ENABLED, true),
  probeIntervalHours: num(process.env.PROBE_INTERVAL_HOURS, 6),
  probeConcurrency: num(process.env.PROBE_CONCURRENCY, 8),
  probeTimeoutMs: num(process.env.PROBE_TIMEOUT_MS, 10000),
  probeRatePerSecond: num(process.env.PROBE_RATE_PER_SECOND, 5),
  // Logo cache (TRACK L)
  logoCacheEnabled: bool(process.env.LOGO_CACHE_ENABLED, true),
  logoCacheDir: process.env.LOGO_CACHE_DIR ?? path.join(process.env.DATA_DIR ?? "/data", "logos"),
  logoCacheMaxMb: num(process.env.LOGO_CACHE_MAX_MB, 500),
  logoMaxSize: num(process.env.LOGO_MAX_SIZE, 512),
  /** Concurrent logo encodes (sharp). Requests waiting longer than 10 s for a slot get 503 Retry-After: 5. */
  logoConcurrency: num(process.env.LOGO_CONCURRENCY, 6),
  /** false = prober and logo fetches refuse private, loopback and link-local targets (see lib/ssrf.ts). */
  fetchAllowPrivate: bool(process.env.FETCH_ALLOW_PRIVATE, false),
  version: process.env.APP_VERSION ?? "0.1.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
};
export type Config = typeof config;
