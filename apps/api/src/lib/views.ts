import { config } from "../config.js";
import { makeProxyUrl } from "./sign.js";

/** Unix seconds: now plus `ttlSeconds`. */
export const expiryIn = (ttlSeconds: number): number => Math.floor(Date.now() / 1000) + ttlSeconds;

/**
 * Signed proxy URL, or undefined when the proxy is off or has no secret. exp defaults to now plus
 * PROXY_URL_TTL_SECONDS; M3U exports pass their own (PROXY_EXPORT_TTL_SECONDS).
 */
export function proxyUrlFor(
  url: string,
  userAgent: string | null,
  referrer: string | null,
  exp: number = expiryIn(config.proxyUrlTtlSeconds),
): string | undefined {
  if (!config.proxyEnabled || !config.proxySecret) return undefined;
  return makeProxyUrl(config.proxySecret, config.proxyPublicPath, url, userAgent, referrer, exp);
}

/** streams.status -> true | false | null (null = never probed). */
export function healthOf(status: string | null | undefined): boolean | null {
  if (status === "online") return true;
  if (status === "offline") return false;
  return null;
}

export interface ProgrammeRow {
  title: string;
  start_ts: number;
  stop_ts: number;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
}

export const nowShape = (p: ProgrammeRow) => ({
  title: p.title,
  start: p.start_ts,
  stop: p.stop_ts,
  description: p.description ?? null,
  category: p.category ?? null,
  icon: p.icon ?? null,
});

export const nextShape = (p: ProgrammeRow) => ({ title: p.title, start: p.start_ts, stop: p.stop_ts });

/**
 * Channel-level browser playability: true when at least one stream plays in a browser, false when some
 * stream was probed and none did, null when no stream has been probed for it yet.
 */
export const browserPlayableOfChannel = (browserCount: number, anyProbed: boolean): boolean | null =>
  browserCount > 0 ? true : anyProbed ? false : null;

/** Stream-level browser playability from streams.browser_ok (1 | 0 | NULL). */
export const browserPlayableOfStream = (browserOk: number | null | undefined): boolean | null =>
  browserOk === null || browserOk === undefined ? null : browserOk === 1;

/** Browsers cannot send a custom User-Agent/Referer, so such streams only work through the relay. */
export function relayOnlyOf(userAgent: string | null, referrer: string | null): boolean {
  return Boolean(userAgent || referrer);
}
