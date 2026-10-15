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
  proxySecret: process.env.PROXY_SECRET ?? "",
  proxyPublicPath: (process.env.PROXY_PUBLIC_PATH ?? "/proxy").replace(/\/$/, ""),
  adminToken: process.env.ADMIN_TOKEN ?? "",
  epgFile: process.env.EPG_FILE ?? path.join(process.env.DATA_DIR ?? "/data", "epg", "guide.xml"),
  epgPollSeconds: num(process.env.EPG_POLL_SECONDS, 60),
  version: process.env.APP_VERSION ?? "0.1.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
};
export type Config = typeof config;
