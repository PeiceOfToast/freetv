import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { makeProxyUrl } from "../src/sign.js";
import { createProxyServer, type ProxyServer } from "../src/server.js";
import type { ProxyConfig } from "../src/config.js";

export const SECRET = "test";
export const PUBLIC_PATH = "/proxy";
export const UA = "FreeTV-Test/1.0";
export const REFERER = "https://player.example.com/embed/1";

export const SEG = Buffer.from(Array.from({ length: 10_000 }, (_, i) => (i * 7) & 255));
export const KEY = Buffer.alloc(16, 0xab);

export function baseConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    port: 0,
    secret: SECRET,
    publicPath: PUBLIC_PATH,
    maxBytes: 50 * 1024 * 1024,
    maxConcurrent: 200,
    maxConcurrentPerIp: 16,
    rateLimitRps: 20,
    rateLimitBurst: 60,
    trustProxy: true,
    allowPrivate: true,
    logLevel: "silent",
    maxPlaylistBytes: 2 * 1024 * 1024,
    ...overrides,
  };
}

export function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
}

export interface SeenRequest { path: string; headers: IncomingMessage["headers"] }

/** Fake upstream CDN: master/media playlists, redirects, keys, ranged binary, slow and chunked responses. */
export function startUpstream(): { server: Server; seen: SeenRequest[]; ready: Promise<number> } {
  const seen: SeenRequest[] = [];
  let base = "";
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    seen.push({ path, headers: req.headers });
    const text = (body: string, type = "application/vnd.apple.mpegurl") => {
      res.writeHead(200, { "content-type": type, "access-control-allow-origin": "https://upstream.example", "set-cookie": "sid=1" });
      res.end(body);
    };
    if (path === "/redir/master.m3u8") {
      res.writeHead(302, { location: "/real/master.m3u8" });
      return res.end();
    }
    if (path === "/real/master.m3u8") {
      return text([
        "#EXTM3U",
        `#EXT-X-SESSION-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"`,
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="audio/a.m3u8"`,
        `#EXT-X-STREAM-INF:BANDWIDTH=1280000,AUDIO="aud"`,
        "media/index.m3u8",
        `#EXT-X-STREAM-INF:BANDWIDTH=640000,AUDIO="aud"`,
        `${base}/abs/index.m3u8`,
        "",
      ].join("\n"));
    }
    if (path === "/real/media/index.m3u8") {
      return text([
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:4",
        `#EXT-X-KEY:METHOD=AES-128,URI="key.bin"`,
        "#EXTINF:4.0,",
        "seg1.ts",
        "#EXTINF:4.0,",
        `${base}/abs/seg2.ts`,
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"));
    }
    if (path === "/real/media/key.bin") return binary(req, res, KEY);
    if (path.endsWith(".ts") || path === "/seg.bin") return binary(req, res, SEG);
    if (path === "/chunked") {
      res.writeHead(200, { "content-type": "video/mp2t" });
      const chunk = Buffer.alloc(600, 1);
      let n = 0;
      const timer = setInterval(() => {
        if (n++ >= 3 || res.destroyed) { clearInterval(timer); return res.end(); }
        res.write(chunk);
      }, 10);
      return;
    }
    if (path === "/slow") {
      setTimeout(() => { res.writeHead(200, { "content-type": "video/mp2t" }); res.end("slow"); }, 1000);
      return;
    }
    if (path === "/loop") {
      res.writeHead(302, { location: "/loop" });
      return res.end();
    }
    if (path === "/secret/path") {
      res.writeHead(500); return res.end("nope");
    }
    res.writeHead(404); res.end("not found");
  });
  const ready = listen(server).then((port) => { base = `http://127.0.0.1:${port}`; return port; });
  return { server, seen, ready };
}

function binary(req: IncomingMessage, res: ServerResponse, buf: Buffer) {
  const headers: Record<string, string | number> = {
    "content-type": "video/mp2t",
    "accept-ranges": "bytes",
    "access-control-allow-origin": "https://upstream.example",
    "set-cookie": "sid=1",
  };
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${buf.length}`, "content-length": end - start + 1 });
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, { ...headers, "content-length": buf.length });
  res.end(buf);
}

export async function startProxy(overrides: Partial<ProxyConfig> = {}): Promise<{ proxy: ProxyServer; origin: string }> {
  const proxy = createProxyServer(baseConfig(overrides));
  const port = await listen(proxy.server);
  return { proxy, origin: `http://127.0.0.1:${port}` };
}

/** Signed path (with the public prefix) for a target, as the api would issue it. */
export function signed(u: string, ua?: string | null, r?: string | null): string {
  return makeProxyUrl(SECRET, PUBLIC_PATH, u, ua, r);
}
