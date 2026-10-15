import { Agent, request, type Dispatcher } from "undici";
import { guardedLookup, assertPublicTarget } from "./ssrf.js";
import { DEFAULT_UA, type ProxyConfig } from "./config.js";

export const MAX_REDIRECTS = 5;
export const HEADERS_TIMEOUT_MS = 15_000;
export const BODY_TIMEOUT_MS = 60_000;

export interface FetchOptions {
  ua?: string | null;
  referer?: string | null;
  range?: string | null;
  signal: AbortSignal;
}

export interface FetchedUpstream {
  url: URL;                       // final URL after redirects
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Dispatcher.ResponseData["body"];
}

export class UpstreamError extends Error {
  constructor(message: string, readonly hostname: string) { super(message); }
}

export function createDispatcher(config: ProxyConfig): Agent {
  return new Agent({
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
    // Only enforce the address check on the connector when private targets are disabled.
    connect: config.allowPrivate ? {} : { lookup: guardedLookup as never },
  });
}

/** Browser-like headers for the upstream request. Origin is derived from the referer. */
export function upstreamHeaders(opts: FetchOptions): Record<string, string> {
  const h: Record<string, string> = {
    "user-agent": opts.ua || DEFAULT_UA,
    accept: "*/*",
    // We stream bytes through untouched, so ask for identity to avoid re-encoding issues.
    "accept-encoding": "identity",
  };
  if (opts.referer) {
    h.referer = opts.referer;
    try { h.origin = new URL(opts.referer).origin; } catch { /* validated upstream */ }
  }
  if (opts.range) h.range = opts.range;
  return h;
}

/**
 * GET with manual redirect handling so every hop is re-validated against the SSRF rules.
 * Throws TargetForbiddenError (from ssrf.ts) for forbidden hops, UpstreamError for network/redirect failures.
 */
export async function fetchUpstream(
  start: URL,
  dispatcher: Dispatcher,
  config: ProxyConfig,
  opts: FetchOptions,
): Promise<FetchedUpstream> {
  let current = start;
  for (let hop = 0; ; hop++) {
    await assertPublicTarget(current, config.allowPrivate);
    let res: Dispatcher.ResponseData;
    try {
      res = await request(current, {
        dispatcher,
        method: "GET",
        headers: upstreamHeaders(opts),
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal.aborted) throw err;
      throw new UpstreamError(`fetch failed: ${(err as Error).message}`, current.hostname);
    }

    const status = res.statusCode;
    if (status >= 300 && status < 400 && res.headers.location) {
      await res.body.dump().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new UpstreamError("too many redirects", current.hostname);
      const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
      try {
        current = new URL(loc, current);
      } catch {
        throw new UpstreamError("invalid redirect location", current.hostname);
      }
      continue;
    }
    return { url: current, statusCode: status, headers: res.headers, body: res.body };
  }
}
