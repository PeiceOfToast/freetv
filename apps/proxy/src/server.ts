import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Transform, pipeline } from "node:stream";
import type { Agent } from "undici";
import { DEFAULT_UA, type ProxyConfig } from "./config.js";
import { clientIp, makeIpHasher } from "./clientip.js";
import { createMetrics } from "./metrics.js";
import { isPlaylist, rewritePlaylist } from "./playlist.js";
import { TokenBucketLimiter } from "./ratelimit.js";
import { checkExpiry, verifySignature } from "./sign.js";
import { TargetForbiddenError } from "./ssrf.js";
import { createDispatcher, fetchUpstream, UpstreamError } from "./upstream.js";

export interface ProxyServer {
  server: Server;
  /** Stops accepting connections, drops open ones and closes the upstream pool. */
  close(): Promise<void>;
}

type Kind = "playlist" | "segment" | "other";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Length, Content-Range",
};

const SWEEP_INTERVAL_MS = 60_000;

interface ReqContext {
  method: string;
  path: string;
  host: string;
  /** Salted hash of the client address. Raw addresses are never logged. */
  ip: string;
  kind: Kind;
  /** Bytes sent to the client. */
  bytes: number;
  /** Bytes received from upstream. */
  upstreamBytes: number;
  started: number;
}

/** Walks the error cause chain looking for our forbidden-target marker (undici may wrap it). */
function isForbidden(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (e instanceof TargetForbiddenError) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function json(res: ServerResponse, status: number, body: { error: string }, ctx: ReqContext) {
  const text = JSON.stringify(body);
  ctx.bytes = Buffer.byteLength(text);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": String(ctx.bytes),
    "cache-control": "no-store",
  });
  res.end(text);
}

interface Payload { u: string; ua?: string; r?: string; exp?: number }

const nowSec = () => Math.floor(Date.now() / 1000);

function decodePayload(payload: string): Payload | null {
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const p = obj as Record<string, unknown>;
    if (typeof p.u !== "string") return null;
    if (p.ua !== undefined && (typeof p.ua !== "string" || p.ua.length > 512)) return null;
    if (p.r !== undefined && typeof p.r !== "string") return null;
    if (p.exp !== undefined && !Number.isSafeInteger(p.exp)) return null;
    return { u: p.u, ua: p.ua as string | undefined, r: p.r as string | undefined, exp: p.exp as number | undefined };
  } catch {
    return null;
  }
}

/** Splits `/sig/payload`, optionally behind the public prefix. Returns null when the path does not match. */
function matchRoute(pathname: string, publicPath: string): [string, string] | null {
  let p = pathname;
  if (publicPath && p.startsWith(`${publicPath}/`)) p = p.slice(publicPath.length);
  const parts = p.split("/");
  if (parts.length !== 3 || parts[0] !== "" || !parts[1] || !parts[2]) return null;
  return [parts[1], parts[2]];
}

/** Best guess before the upstream response is seen. Refined to the real content type once it arrives. */
function guessKind(u: string): Kind {
  try {
    return isPlaylist(undefined, new URL(u)) ? "playlist" : "segment";
  } catch {
    return "other";
  }
}

export function createProxyServer(config: ProxyConfig): ProxyServer {
  const dispatcher: Agent = createDispatcher(config);
  const metrics = createMetrics();
  const hashIp = makeIpHasher();
  const limiter = config.rateLimitRps > 0 ? new TokenBucketLimiter(config.rateLimitRps, config.rateLimitBurst) : null;
  const sweeper = limiter ? setInterval(() => limiter.sweep(), SWEEP_INTERVAL_MS) : null;
  sweeper?.unref();

  let inFlight = 0;
  const perIp = new Map<string, number>();
  const sockets = new Set<import("node:net").Socket>();

  /** Takes one global and one per-IP slot. The returned function releases both, once. */
  function takeSlot(addr: string): () => void {
    inFlight++;
    metrics.active.set(inFlight);
    perIp.set(addr, (perIp.get(addr) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      inFlight--;
      metrics.active.set(inFlight);
      const n = (perIp.get(addr) ?? 1) - 1;
      if (n <= 0) perIp.delete(addr);
      else perIp.set(addr, n);
    };
  }

  const log = (ctx: ReqContext, status: number) => {
    if (config.logLevel === "silent") return;
    // warn: only log problems (4xx/5xx); info: every request.
    if (config.logLevel === "warn" && status < 400) return;
    const ms = Date.now() - ctx.started;
    console.log(`proxy ${ctx.method} ${status} ${ctx.host} bytes=${ctx.bytes} ms=${ms} ip=${ctx.ip} kind=${ctx.kind}`);
  };

  async function handle(req: IncomingMessage, res: ServerResponse, ctx: ReqContext, addr: string): Promise<void> {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    ctx.path = pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...CORS_HEADERS,
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "Range",
        "access-control-max-age": "86400",
      });
      res.end(); return;
    }
    if (req.method !== "GET") {
      res.setHeader("allow", "GET, OPTIONS");
      return json(res, 405, { error: "method not allowed" }, ctx);
    }
    if (pathname === "/healthz") {
      ctx.bytes = 2;
      res.writeHead(200, { ...CORS_HEADERS, "content-type": "text/plain; charset=utf-8", "content-length": "2" });
      res.end("ok"); return;
    }
    if (pathname === "/metrics") {
      const body = metrics.render();
      ctx.bytes = Buffer.byteLength(body);
      res.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "content-length": String(ctx.bytes),
        "cache-control": "no-store",
      });
      res.end(body); return;
    }

    const route = matchRoute(pathname, config.publicPath);
    if (!route) return json(res, 404, { error: "not found" }, ctx);
    const [sig, payloadB64] = route;

    if (!verifySignature(config.secret, payloadB64, sig)) {
      return json(res, 403, { error: "invalid signature" }, ctx);
    }

    const payload = decodePayload(payloadB64);
    if (!payload) return json(res, 400, { error: "invalid payload" }, ctx);
    ctx.kind = guessKind(payload.u);

    // Expiry is checked before rate limiting, so expired requests never use tokens. Playlists must be
    // within exp; segments also get a grace period. The kind is guessed from the URL here and confirmed
    // from the response below.
    const exp = payload.exp;
    const early = checkExpiry(exp, nowSec(), ctx.kind === "playlist" ? "playlist" : "segment");
    if (early === "invalid") return json(res, 403, { error: "invalid expiry" }, ctx);
    if (early !== "ok" || exp === undefined) return json(res, 403, { error: "expired" }, ctx);

    // Rate limit after the signature check, so only requests the api actually issued consume tokens.
    if (limiter) {
      const decision = limiter.take(addr);
      if (!decision.allowed) {
        metrics.rateLimited.inc();
        res.setHeader("retry-after", String(decision.retryAfterSec));
        return json(res, 429, { error: "rate limited" }, ctx);
      }
    }

    let target: URL;
    try {
      target = new URL(payload.u);
    } catch {
      return json(res, 403, { error: "target not allowed" }, ctx);
    }
    ctx.host = target.hostname;
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return json(res, 403, { error: "target not allowed" }, ctx);
    }

    let referer: string | null = null;
    if (payload.r) {
      try {
        const r = new URL(payload.r);
        if (r.protocol !== "http:" && r.protocol !== "https:") throw new Error("scheme");
        referer = payload.r;
      } catch {
        return json(res, 400, { error: "invalid payload" }, ctx);
      }
    }

    if (config.maxConcurrentPerIp > 0 && (perIp.get(addr) ?? 0) >= config.maxConcurrentPerIp) {
      res.setHeader("retry-after", "2");
      return json(res, 429, { error: "too many concurrent requests" }, ctx);
    }
    if (inFlight >= config.maxConcurrent) {
      res.setHeader("retry-after", "2");
      return json(res, 503, { error: "too many concurrent requests" }, ctx);
    }
    const release = takeSlot(addr);

    const ac = new AbortController();
    res.once("close", () => { release(); ac.abort(); });

    let up;
    try {
      up = await fetchUpstream(target, dispatcher, config, {
        ua: payload.ua || DEFAULT_UA,
        referer,
        range: req.headers.range ?? null,
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted || res.destroyed) return;
      if (isForbidden(err)) {
        metrics.upstreamErrors.inc({ reason: "forbidden" });
        return json(res, 403, { error: "target not allowed" }, ctx);
      }
      metrics.upstreamErrors.inc({ reason: "unreachable" });
      const host = err instanceof UpstreamError ? err.hostname : target.hostname;
      return json(res, 502, { error: `upstream unreachable (${host})` }, ctx);
    }

    if (up.statusCode < 200 || up.statusCode >= 300) {
      up.body.dump().catch(() => {});
      metrics.upstreamErrors.inc({ reason: "bad_status" });
      return json(res, 502, { error: `upstream responded ${up.statusCode}` }, ctx);
    }

    const contentType = headerString(up.headers["content-type"]);
    const contentLength = headerString(up.headers["content-length"]);
    ctx.kind = isPlaylist(contentType, up.url) ? "playlist" : "segment";

    if (ctx.kind === "playlist") {
      // The URL guess said segment (no .m3u8 path) but the response is a playlist: the stricter rule applies.
      if (checkExpiry(exp, nowSec(), "playlist") !== "ok") {
        up.body.dump().catch(() => {});
        return json(res, 403, { error: "expired" }, ctx);
      }
      if (contentLength && Number(contentLength) > config.maxPlaylistBytes) {
        up.body.dump().catch(() => {});
        metrics.upstreamErrors.inc({ reason: "too_large" });
        return json(res, 413, { error: "playlist too large" }, ctx);
      }
      let text: string;
      try {
        text = await readCapped(up.body, config.maxPlaylistBytes);
      } catch (err) {
        if (ac.signal.aborted || res.destroyed) return;
        if ((err as { code?: string }).code === "EPLAYLISTTOOLARGE") {
          metrics.upstreamErrors.inc({ reason: "too_large" });
          return json(res, 413, { error: "playlist too large" }, ctx);
        }
        metrics.upstreamErrors.inc({ reason: "read" });
        return json(res, 502, { error: `upstream unreachable (${up.url.hostname})` }, ctx);
      }
      ctx.upstreamBytes += Buffer.byteLength(text);
      const out = rewritePlaylist(text, up.url, {
        secret: config.secret,
        publicPath: config.publicPath,
        ua: payload.ua ?? null,
        r: referer,
        exp,
      });
      ctx.bytes = Buffer.byteLength(out);
      res.writeHead(200, {
        ...CORS_HEADERS,
        "content-type": "application/vnd.apple.mpegurl",
        "content-length": String(ctx.bytes),
        "cache-control": "no-cache",
      });
      res.end(out); return;
    }

    // Binary passthrough (segments, keys, init sections, anything else).
    if (contentLength && Number(contentLength) > config.maxBytes) {
      up.body.dump().catch(() => {});
      metrics.upstreamErrors.inc({ reason: "too_large" });
      return json(res, 413, { error: "response too large" }, ctx);
    }
    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      "content-type": contentType ?? "application/octet-stream",
      "accept-ranges": headerString(up.headers["accept-ranges"]) ?? "bytes",
    };
    if (contentLength) headers["content-length"] = contentLength;
    const contentRange = headerString(up.headers["content-range"]);
    if (contentRange) headers["content-range"] = contentRange;
    res.writeHead(up.statusCode, headers);

    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        ctx.bytes += chunk.length;
        ctx.upstreamBytes += chunk.length;
        if (ctx.bytes > config.maxBytes) return cb(Object.assign(new Error("too large"), { code: "ETOOLARGE" }));
        cb(null, chunk);
      },
    });
    // pipeline destroys every stream on error: an over-cap or aborted transfer just drops the socket.
    pipeline(up.body, counter, res, (err) => {
      // Client disconnects are expected; only the cap is worth counting.
      if ((err as { code?: string } | undefined)?.code === "ETOOLARGE") metrics.upstreamErrors.inc({ reason: "too_large" });
    });
  }

  const server = createServer((req, res) => {
    const addr = clientIp({
      forwardedFor: req.headers["x-forwarded-for"],
      socketAddress: req.socket.remoteAddress,
      trustProxy: config.trustProxy,
    });
    const ctx: ReqContext = {
      method: req.method ?? "-",
      path: req.url ?? "/",
      host: "-",
      ip: hashIp(addr),
      kind: "other",
      bytes: 0,
      upstreamBytes: 0,
      started: Date.now(),
    };
    let done = false;
    // Runs once: on finish for normal responses, on close for aborted ones.
    const finish = () => {
      if (done) return;
      done = true;
      metrics.requests.inc({ kind: ctx.kind, status: String(res.statusCode) });
      metrics.duration.observe((Date.now() - ctx.started) / 1000);
      metrics.bytes.inc({ direction: "client" }, ctx.bytes);
      metrics.bytes.inc({ direction: "upstream" }, ctx.upstreamBytes);
      log(ctx, res.statusCode);
    };
    res.once("finish", finish);
    res.once("close", finish);
    handle(req, res, ctx, addr).catch((err) => {
      if (!res.headersSent) json(res, 500, { error: "internal error" }, ctx);
      else res.destroy();
      if (config.logLevel !== "silent") console.error("proxy internal error", (err as Error).message);
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        if (sweeper) clearInterval(sweeper);
        server.close(() => resolve());
        server.closeAllConnections();
        dispatcher.close().catch(() => {});
      }),
  };
}

function headerString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function readCapped(body: AsyncIterable<Buffer>, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > max) {
      const err = Object.assign(new Error("playlist too large"), { code: "EPLAYLISTTOOLARGE" });
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
