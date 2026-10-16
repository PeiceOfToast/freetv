export interface ProxyConfig {
  port: number;
  secret: string;
  /** Normalised: no trailing slash; "" when the proxy is served at the root. */
  publicPath: string;
  maxBytes: number;
  maxConcurrent: number;
  /** Per-client-IP concurrent requests. 0 disables. */
  maxConcurrentPerIp: number;
  /** Per-client-IP sustained requests/second (token refill rate). 0 disables the limiter. */
  rateLimitRps: number;
  /** Per-client-IP bucket capacity (requests allowed in a burst). */
  rateLimitBurst: number;
  /** Take the client IP from the first X-Forwarded-For entry. When false, the socket address is used. */
  trustProxy: boolean;
  /** DEV ONLY. Lets upstreams on private/loopback addresses through (tests use it). */
  allowPrivate: boolean;
  logLevel: "silent" | "warn" | "info";
  /** Playlist size cap (bytes). Fixed by contract. */
  maxPlaylistBytes: number;
}

export const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function int(name: string, env: NodeJS.ProcessEnv, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Like int, but 0 is allowed and means "disabled". */
function intOrZero(name: string, env: NodeJS.ProcessEnv, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

/** Non-negative finite number (fractions allowed). 0 disables. */
function nonNegNumber(name: string, env: NodeJS.ProcessEnv, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number >= 0`);
  return n;
}

function bool(name: string, env: NodeJS.ProcessEnv, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

/** Strict boolean: anything other than true/false/1/0 is a configuration error. */
function strictBool(name: string, env: NodeJS.ProcessEnv, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const secret = env.PROXY_SECRET;
  if (!secret || /^change-me/i.test(secret)) throw new Error("PROXY_SECRET is required (set a real secret: openssl rand -hex 32)");
  const publicPath = (env.PROXY_PUBLIC_PATH ?? "/proxy").replace(/\/+$/, "");
  return {
    port: int("PORT", env, 3001),
    secret,
    publicPath: publicPath.startsWith("/") || publicPath === "" ? publicPath : `/${publicPath}`,
    maxBytes: int("PROXY_MAX_BYTES", env, 50 * 1024 * 1024),
    maxConcurrent: int("PROXY_MAX_CONCURRENT", env, 200),
    maxConcurrentPerIp: intOrZero("PROXY_MAX_CONCURRENT_PER_IP", env, 16),
    rateLimitRps: nonNegNumber("PROXY_RATE_LIMIT_RPS", env, 20),
    rateLimitBurst: int("PROXY_RATE_LIMIT_BURST", env, 60),
    trustProxy: strictBool("PROXY_TRUST_PROXY", env, true),
    allowPrivate: bool("PROXY_ALLOW_PRIVATE", env, false),
    logLevel: env.LOG_LEVEL === "silent" ? "silent" : env.LOG_LEVEL === "warn" || env.LOG_LEVEL === "error" ? "warn" : "info",
    maxPlaylistBytes: 2 * 1024 * 1024,
  };
}
