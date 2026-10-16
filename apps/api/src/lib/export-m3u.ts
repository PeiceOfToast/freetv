import { config } from "../config.js";
import { PLAYLIST_CAP, type ExportChannel, type ExportStream } from "./export-query.js";
import { expiryIn } from "./views.js";

export interface M3uOptions {
  /** Absolute origin without a trailing slash, e.g. https://tv.example.com */
  base: string;
  /** Written as the `#PLAYLIST:` second line when given (the instance's site name). */
  siteName?: string;
  /** proxy=true: emit relayed URLs (base + signed path) instead of origin URLs. */
  proxy: boolean;
  /** best = first stream per channel; all = every stream, one #EXTINF each. */
  streams: "best" | "all";
  /**
   * Signed relay path starting with "/", or undefined when the proxy is unavailable. Called with the
   * exp to sign (now + PROXY_EXPORT_TTL_SECONDS); the path must carry that exp.
   */
  proxyPathFor: (s: ExportStream, exp: number) => string | undefined;
  /** True when the channel list was cut at PLAYLIST_CAP. */
  truncated: boolean;
}

const CHUNK = 1000;

/** Newlines would break the line-oriented format, so they become spaces. */
const clean = (v: string) => v.replace(/[\r\n]+/g, " ");
/** Attribute values sit in double quotes, so double quotes become single quotes. */
const attr = (v: string) => clean(v).replace(/"/g, "'");

/** An export channel, optionally with this instance's channel number (emitted as tvg-chno). */
export type M3uChannel = ExportChannel & { number?: number | null };

/** Renders the full M3U document. Lines are joined per 1,000 channels to keep allocations small. */
export function renderM3u(channels: M3uChannel[], opts: M3uOptions): string {
  const parts: string[] = [`#EXTM3U x-tvg-url="${attr(`${opts.base}/api/guide.xml`)}"\n`];
  if (opts.siteName !== undefined) parts.push(`#PLAYLIST:${clean(opts.siteName)}\n`);
  // One expiry for the whole document: the export TTL, not the 24 h UI TTL.
  const exp = expiryIn(config.proxyExportTtlSeconds);
  for (let i = 0; i < channels.length; i += CHUNK) {
    const lines: string[] = [];
    for (const ch of channels.slice(i, i + CHUNK)) appendChannel(lines, ch, opts, exp);
    parts.push(lines.join("\n") + "\n");
  }
  if (opts.truncated) {
    parts.push(`# list capped at ${PLAYLIST_CAP} channels; narrow the filters to see the rest\n`);
  }
  return parts.join("");
}

function appendChannel(out: string[], ch: M3uChannel, opts: M3uOptions, exp: number): void {
  const attrs: string[] = [];
  if (ch.number !== undefined && ch.number !== null) attrs.push(`tvg-chno="${ch.number}"`);
  attrs.push(`tvg-id="${attr(ch.id)}"`, `tvg-name="${attr(ch.name)}"`);
  if (ch.logo) attrs.push(`tvg-logo="${attr(ch.logo)}"`);
  if (ch.country) attrs.push(`tvg-country="${attr(ch.country)}"`);
  if (ch.languages[0]) attrs.push(`tvg-language="${attr(ch.languages[0])}"`);
  attrs.push(`group-title="${attr(ch.categories[0] ?? "Other")}"`);
  const extinf = `#EXTINF:-1 ${attrs.join(" ")},${clean(ch.name)}`;

  const streams = opts.streams === "best" ? ch.streams.slice(0, 1) : ch.streams;
  for (const s of streams) {
    out.push(extinf);
    // Only present when the stream has the value; with proxy=true the headers are also signed into the relay URL.
    if (s.userAgent) out.push(`#EXTVLCOPT:http-user-agent=${clean(s.userAgent)}`);
    if (s.referrer) out.push(`#EXTVLCOPT:http-referrer=${clean(s.referrer)}`);
    const relay = opts.proxy ? opts.proxyPathFor(s, exp) : undefined;
    // Proxy requested but unavailable (disabled or no secret): fall back to the origin URL.
    out.push(relay !== undefined ? `${opts.base}${relay}` : clean(s.url));
  }
}
