// Single-URL probe: is this stream's HLS playlist (or a raw media response) reachable right now?
// Never throws. Every failure (bad URL, HTTP error, DNS, reset, timeout, empty master) is an offline result.

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const MAX_REDIRECTS = 5;
export const READ_LIMIT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ProbeOptions {
  userAgent?: string | null;
  referrer?: string | null;
  timeoutMs?: number;
}

export interface ProbeResult {
  status: "online" | "offline";
  /** Status of the last response received, null when no response arrived (DNS, reset, timeout before headers). */
  httpStatus: number | null;
  latencyMs: number;
  /** Why it is offline; null when online. */
  error: string | null;
}

const M3U8_PATH = /\.m3u8?$/i;
const PLAYLIST_MAGIC = /^﻿?\s*#EXTM3U/;
const MEDIA_TYPE_HINTS = ["video/mp2t", "video/mp4"];

export async function probeStream(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let httpStatus: number | null = null;
  try {
    const problem = await verdictFor(url, opts, controller.signal, (s) => (httpStatus = s));
    return { status: problem === null ? "online" : "offline", httpStatus, latencyMs: Date.now() - started, error: problem };
  } catch (err) {
    return {
      status: "offline",
      httpStatus,
      latencyMs: Date.now() - started,
      error: timedOut ? `timeout after ${timeoutMs} ms` : describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Returns null when the stream looks online, otherwise the reason it does not. */
async function verdictFor(
  url: string,
  opts: ProbeOptions,
  signal: AbortSignal,
  setStatus: (s: number) => void,
): Promise<string | null> {
  let target = parseHttpUrl(url);
  if (!target) return "unsupported URL (only http and https are probed)";

  let res: Response;
  for (let hop = 0; ; hop++) {
    res = await fetch(target, { method: "GET", redirect: "manual", signal, headers: requestHeaders(opts) });
    setStatus(res.status);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await discard(res);
      if (hop >= MAX_REDIRECTS) return `more than ${MAX_REDIRECTS} redirects`;
      const next = parseHttpUrl(new URL(location, target).toString());
      if (!next) return "redirect to an unsupported URL";
      target = next;
      continue;
    }
    break;
  }

  if (!res.ok) {
    await discard(res);
    return `HTTP ${res.status}`;
  }

  const { head, total } = await readHead(res);
  const text = head.toString("utf8");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

  // DASH manifests (~220 streams in the catalog, e.g. BBC) are healthy when the body is an MPD.
  if (/<MPD[\s>]/.test(text) || type.includes("dash+xml")) return /<MPD[\s>]/.test(text) ? null : "dash content-type without MPD body";

  if (M3U8_PATH.test(target.pathname) || PLAYLIST_MAGIC.test(text)) {
    if (!PLAYLIST_MAGIC.test(text)) return `not an HLS playlist (content-type ${type || "none"})`;
    if (isMasterWithoutVariants(text)) return "master playlist has no variants";
    return null;
  }

  const mediaType =
    MEDIA_TYPE_HINTS.includes(type) || type.includes("mpegurl") || type === "application/octet-stream";
  if (mediaType && total > 0) return null;
  return `not a playlist or media response (content-type ${type || "none"})`;
}

function parseHttpUrl(s: string): URL | null {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function requestHeaders(opts: ProbeOptions): Record<string, string> {
  const headers: Record<string, string> = { "user-agent": opts.userAgent || DEFAULT_USER_AGENT, accept: "*/*" };
  if (opts.referrer) headers.referer = opts.referrer;
  return headers;
}

/** Reads at most READ_LIMIT_BYTES, then cancels the rest of the body. */
async function readHead(res: Response): Promise<{ head: Buffer; total: number }> {
  const reader = res.body?.getReader();
  if (!reader) return { head: Buffer.alloc(0), total: 0 };
  const parts: Buffer[] = [];
  let total = 0;
  try {
    while (total < READ_LIMIT_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const take = Math.min(buf.byteLength, READ_LIMIT_BYTES - total);
      parts.push(buf.subarray(0, take));
      total += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { head: Buffer.concat(parts), total };
}

/** A master playlist (has STREAM-INF tags) with no variant URI lines is unusable. */
function isMasterWithoutVariants(text: string): boolean {
  if (!text.includes("#EXT-X-STREAM-INF")) return false;
  const variants = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#")).length;
  return variants === 0;
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}

function describeError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.cause?.code;
  if (code) return `${e?.message ?? "fetch failed"}: ${code}`.slice(0, 200);
  return (e?.message ?? String(err)).slice(0, 200);
}
