export interface ProxyConfig {
  port: number;
  secret: string;
  /** Normalised: no trailing slash; "" when the proxy is served at the root. */
  publicPath: string;
  maxBytes: number;
  maxConcurrent: number;
  /** DEV ONLY. Lets upstreams on private/loopback addresses through (tests use it). */
  allowPrivate: boolean;
  logLevel: "silent" | "info";
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

function bool(name: string, env: NodeJS.ProcessEnv, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
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
    allowPrivate: bool("PROXY_ALLOW_PRIVATE", env, false),
    logLevel: env.LOG_LEVEL === "silent" ? "silent" : "info",
    maxPlaylistBytes: 2 * 1024 * 1024,
  };
}
