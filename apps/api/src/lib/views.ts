import { config } from "../config.js";
import { makeProxyUrl } from "./sign.js";

/** Signed proxy URL, or undefined when the proxy is off or has no secret. */
export function proxyUrlFor(url: string, userAgent: string | null, referrer: string | null): string | undefined {
  if (!config.proxyEnabled || !config.proxySecret) return undefined;
  return makeProxyUrl(config.proxySecret, config.proxyPublicPath, url, userAgent, referrer);
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
