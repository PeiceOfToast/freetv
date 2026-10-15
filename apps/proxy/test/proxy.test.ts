import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { verifySignature } from "../src/sign.js";
import { type ProxyServer } from "../src/server.js";
import { startProxy, startUpstream, closeServer, signed, SEG, KEY, UA, REFERER, SECRET, PUBLIC_PATH, listen, type SeenRequest } from "./helpers.js";

let upstream: Server;
let up = "";
let seen: SeenRequest[];
let proxy: ProxyServer;
let origin = "";

before(async () => {
  const u = startUpstream();
  upstream = u.server;
  seen = u.seen;
  const port = await u.ready;
  up = `http://127.0.0.1:${port}`;
  ({ proxy, origin } = await startProxy());
});

after(async () => {
  await proxy.close();
  await closeServer(upstream);
});

/** Splits a proxy path into signature + payload and decodes the target. */
function decode(path: string): { sig: string; payload: string; u: string; ua?: string; r?: string } {
  const [, prefix, sig, payload] = path.match(/^(\/proxy)\/([^/]+)\/([^/]+)$/) ?? [];
  assert.equal(prefix, PUBLIC_PATH, `not a proxy path: ${path}`);
  assert.ok(verifySignature(SECRET, payload, sig), "rewritten URL must carry a valid signature");
  return { sig, payload, ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) };
}

describe("health and routing", () => {
  it("GET /healthz returns 200 ok", async () => {
    const res = await fetch(`${origin}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  });

  it("unknown paths are 404", async () => {
    assert.equal((await fetch(`${origin}/nope`)).status, 404);
    assert.equal((await fetch(`${origin}${PUBLIC_PATH}/only-one-segment`)).status, 404);
  });

  it("accepts the route with and without the public prefix", async () => {
    const path = signed(`${up}/seg.bin`);
    const bare = path.slice(PUBLIC_PATH.length);
    const res = await fetch(`${origin}${bare}`, { headers: { range: "bytes=0-9" } });
    assert.equal(res.status, 206);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), SEG.subarray(0, 10));
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await fetch(`${origin}${PUBLIC_PATH}/x/y`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /Range/i);
  });
});

describe("signature verification", () => {
  it("rejects a bogus signature with 403", async () => {
    const good = signed(`${up}/seg.bin`);
    const [, , , payload] = good.split("/");
    const res = await fetch(`${origin}${PUBLIC_PATH}/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/${payload}`);
    assert.equal(res.status, 403);
  });

  it("rejects a valid signature over a tampered payload with 403", async () => {
    const good = signed(`${up}/seg.bin`);
    const [, , sig] = good.split("/");
    const tampered = Buffer.from(JSON.stringify({ u: `${up}/other.bin` })).toString("base64url");
    const res = await fetch(`${origin}${PUBLIC_PATH}/${sig}/${tampered}`);
    assert.equal(res.status, 403);
  });
});

describe("SSRF protection", () => {
  let strict: ProxyServer;
  let strictOrigin = "";
  before(async () => {
    ({ proxy: strict, origin: strictOrigin } = await startProxy({ allowPrivate: false }));
  });
  after(async () => { await strict.close(); });

  const forbidden = [
    "http://127.0.0.1:9/x",
    "http://localhost:9/x",
    "http://api.localhost/x",
    "http://10.1.2.3/x",
    "http://172.16.0.1/x",
    "http://172.31.255.255/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:9/x",
    "http://[fd00::1]/x",
    "http://[fe80::1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://metadata.google.internal/x",
    "http://printer.local/x",
    "file:///etc/passwd",
    "ftp://example.com/x",
  ];
  for (const target of forbidden) {
    it(`blocks ${target} with 403`, async () => {
      const res = await fetch(`${strictOrigin}${signed(target)}`);
      assert.equal(res.status, 403);
    });
  }
});

describe("playlist rewriting", () => {
  it("rewrites master and media playlists into signed proxy URLs that round-trip", async () => {
    const entry = signed(`${up}/redir/master.m3u8`, UA, REFERER);
    const res = await fetch(`${origin}${entry}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/vnd.apple.mpegurl");
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = await res.text();

    const lines = body.split("\n");
    // Bare URI lines: relative resolves against the FINAL (post-redirect) URL, absolute stays absolute.
    const variants = lines.filter((l) => l && !l.startsWith("#"));
    assert.equal(variants.length, 2);
    const v1 = decode(variants[0]);
    assert.equal(v1.u, `${up}/real/media/index.m3u8`);
    assert.equal(v1.ua, UA);
    assert.equal(v1.r, REFERER);
    assert.equal(decode(variants[1]).u, `${up}/abs/index.m3u8`);

    // URI="..." attributes are rewritten; data: URIs the proxy cannot fetch are left alone.
    const audio = decode(/URI="([^"]+)"/.exec(lines.find((l) => l.startsWith("#EXT-X-MEDIA"))!)![1]);
    assert.equal(audio.u, `${up}/real/audio/a.m3u8`);
    assert.ok(lines.find((l) => l.startsWith("#EXT-X-SESSION-KEY"))!.includes('URI="data:text/plain;base64,AAAA"'));

    // Follow the first variant through the proxy.
    const mediaRes = await fetch(`${origin}${variants[0]}`);
    assert.equal(mediaRes.status, 200);
    const media = await mediaRes.text();
    const keyLine = media.split("\n").find((l) => l.startsWith("#EXT-X-KEY"))!;
    const keyPath = /URI="([^"]+)"/.exec(keyLine)![1];
    assert.equal(decode(keyPath).u, `${up}/real/media/key.bin`);
    const keyRes = await fetch(`${origin}${keyPath}`);
    assert.equal(keyRes.status, 200);
    assert.deepEqual(Buffer.from(await keyRes.arrayBuffer()), KEY);

    // Segment (relative, from the media playlist) with Range round-trips.
    const segPath = media.split("\n").find((l) => l && !l.startsWith("#"))!;
    assert.equal(decode(segPath).u, `${up}/real/media/seg1.ts`);
    const segRes = await fetch(`${origin}${segPath}`, { headers: { range: "bytes=100-199" } });
    assert.equal(segRes.status, 206);
    assert.equal(segRes.headers.get("content-range"), `bytes 100-199/${SEG.length}`);
    assert.deepEqual(Buffer.from(await segRes.arrayBuffer()), SEG.subarray(100, 200));

    // The ua and referer carried in the signed URL reach the upstream, with Origin derived from the referer.
    const segSeen = seen.filter((s) => s.path === "/real/media/seg1.ts").at(-1)!;
    assert.equal(segSeen.headers["user-agent"], UA);
    assert.equal(segSeen.headers.referer, REFERER);
    assert.equal(segSeen.headers.origin, "https://player.example.com");
  });
});

describe("binary passthrough", () => {
  it("serves full responses with Content-Length and Accept-Ranges", async () => {
    const res = await fetch(`${origin}${signed(`${up}/seg.bin`)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(SEG.length));
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), SEG);
  });

  it("passes Range through and returns 206 with Content-Range", async () => {
    const res = await fetch(`${origin}${signed(`${up}/seg.bin`)}`, { headers: { range: "bytes=0-99" } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 0-99/${SEG.length}`);
    assert.equal(res.headers.get("content-length"), "100");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), SEG.subarray(0, 100));
  });

  it("strips upstream CORS and Set-Cookie, exposes Content-Range", async () => {
    const res = await fetch(`${origin}${signed(`${up}/seg.bin`)}`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("access-control-expose-headers"), "Content-Length, Content-Range");
    assert.equal(res.headers.get("set-cookie"), null);
    await res.arrayBuffer();
  });

  it("returns 502 with a hostname-only error for an upstream 404", async () => {
    const res = await fetch(`${origin}${signed(`${up}/missing.bin`)}`);
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    assert.match(((await res.json()) as { error: string }).error, /upstream responded 404/);
  });

  it("returns 502 for a redirect loop", async () => {
    assert.equal((await fetch(`${origin}${signed(`${up}/loop`)}`)).status, 502);
  });

  it("returns 502 without leaking the upstream path when the connection fails", async () => {
    const dead = createServer();
    const port = await listen(dead);
    await closeServer(dead);
    const res = await fetch(`${origin}${signed(`http://127.0.0.1:${port}/secret/path?token=1`)}`);
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.match(text, /127\.0\.0\.1/);
    assert.doesNotMatch(text, /secret\/path|token=/);
  });
});

describe("limits", () => {
  let small: ProxyServer;
  let smallOrigin = "";
  before(async () => {
    ({ proxy: small, origin: smallOrigin } = await startProxy({ maxBytes: 1000 }));
  });
  after(async () => { await small.close(); });

  it("413 when a known Content-Length exceeds PROXY_MAX_BYTES", async () => {
    const res = await fetch(`${smallOrigin}${signed(`${up}/seg.bin`)}`);
    assert.equal(res.status, 413);
    await res.arrayBuffer();
  });

  it("aborts a streamed response that exceeds PROXY_MAX_BYTES mid-stream", async () => {
    const res = await fetch(`${smallOrigin}${signed(`${up}/chunked`)}`);
    assert.equal(res.status, 200);
    let received = 0;
    try {
      received = (await res.arrayBuffer()).byteLength;
    } catch {
      // connection destroyed by the proxy: expected
    }
    assert.ok(received < 1800, `expected truncation, got ${received} bytes`);
  });

  it("503 when PROXY_MAX_CONCURRENT is reached", async () => {
    const one = await startProxy({ maxConcurrent: 1 });
    try {
      const slow = fetch(`${one.origin}${signed(`${up}/slow`)}`).then((r) => r.arrayBuffer());
      await new Promise((r) => setTimeout(r, 150));
      const res = await fetch(`${one.origin}${signed(`${up}/seg.bin`)}`);
      assert.equal(res.status, 503);
      await res.arrayBuffer();
      await slow;
    } finally {
      await one.proxy.close();
    }
  });
});
