import { makeProxyUrl } from "./sign.js";

export interface RewriteOptions {
  secret: string;
  publicPath: string;
  ua?: string | null;
  r?: string | null;
}

// Tags whose URI="..." attribute points at another resource that must go through the proxy.
const URI_TAGS = /^#EXT-X-(KEY|SESSION-KEY|MAP|MEDIA|I-FRAME-STREAM-INF|PRELOAD-HINT)\b/;
const URI_ATTR = /URI="([^"]*)"/g;

/**
 * Rewrites an HLS playlist so every resource it references is fetched through this proxy.
 * `base` must be the FINAL upstream URL (after redirects). Non-http(s) references (data:, skd:, ...)
 * are left untouched because the proxy cannot fetch them.
 */
export function rewritePlaylist(text: string, base: URL, opts: RewriteOptions): string {
  const signFor = (raw: string): string | null => {
    let abs: URL;
    try {
      abs = new URL(raw, base);
    } catch {
      return null;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    return makeProxyUrl(opts.secret, opts.publicPath, abs.toString(), opts.ua, opts.r);
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return line;
      if (trimmed.startsWith("#")) {
        if (!URI_TAGS.test(trimmed)) return line;
        return line.replace(URI_ATTR, (whole, raw: string) => {
          const signed = signFor(raw);
          return signed === null ? whole : `URI="${signed}"`;
        });
      }
      // A bare line is a URI (media segment or variant playlist).
      const signed = signFor(trimmed);
      return signed ?? line;
    })
    .join("\n");
}

/** Heuristic from docs/ARCHITECTURE.md: content-type first, then the URL path. */
export function isPlaylist(contentType: string | undefined, finalUrl: URL): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("mpegurl")) return true;
  const path = finalUrl.pathname.toLowerCase();
  return path.endsWith(".m3u8") || path.endsWith(".m3u");
}
