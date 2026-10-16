import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { probeStream } from "../src/prober/probe.js";
import { startFixtureServer, UA_REQUIRED, type FixtureServer } from "./prober-server.js";

describe("probeStream", () => {
  let srv: FixtureServer;
  const savedAllowPrivate = config.fetchAllowPrivate;

  before(async () => {
    // The fixture server is on 127.0.0.1, which the SSRF guard refuses by default. Allow it here;
    // the refusal itself is covered in the "SSRF guard" block below.
    config.fetchAllowPrivate = true;
    srv = await startFixtureServer();
  });
  after(async () => {
    config.fetchAllowPrivate = savedAllowPrivate;
    await srv.close();
  });

  test("with FETCH_ALLOW_PRIVATE off, a loopback target is refused before any connection", async () => {
    config.fetchAllowPrivate = false;
    try {
      const hitsBefore = srv.hits.get("/valid.m3u8") ?? 0;
      const r = await probeStream(`${srv.base}/valid.m3u8`, { timeoutMs: 2000 });
      assert.equal(r.status, "offline");
      assert.equal(r.httpStatus, null);
      assert.match(r.error ?? "", /^blocked target: address not allowed$/);
      assert.equal(srv.hits.get("/valid.m3u8") ?? 0, hitsBefore, "the fixture server saw no request");
    } finally {
      config.fetchAllowPrivate = true;
    }
  });

  test("with FETCH_ALLOW_PRIVATE off, the link-local metadata address is refused", async () => {
    config.fetchAllowPrivate = false;
    try {
      const r = await probeStream("http://169.254.169.254/latest/meta-data/", { timeoutMs: 2000 });
      assert.equal(r.status, "offline");
      assert.equal(r.httpStatus, null);
      assert.match(r.error ?? "", /blocked target/);
    } finally {
      config.fetchAllowPrivate = true;
    }
  });

  test("a valid media playlist is online", async () => {
    const r = await probeStream(`${srv.base}/valid.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
    assert.equal(r.httpStatus, 200);
    assert.equal(r.error, null);
    assert.equal(typeof r.latencyMs, "number");
  });

  test("a master playlist with variants is online", async () => {
    const r = await probeStream(`${srv.base}/master.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
  });

  test("a master playlist with zero variants is offline", async () => {
    const r = await probeStream(`${srv.base}/empty-master.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
    assert.equal(r.httpStatus, 200);
    assert.match(r.error ?? "", /no variants/);
  });

  test("404 is offline with the HTTP status", async () => {
    const r = await probeStream(`${srv.base}/not-found.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
    assert.equal(r.httpStatus, 404);
    assert.equal(r.error, "HTTP 404");
  });

  test("5xx is offline", async () => {
    const r = await probeStream(`${srv.base}/server-error.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
    assert.equal(r.httpStatus, 503);
  });

  test("a slow endpoint times out as offline", async () => {
    const started = Date.now();
    const r = await probeStream(`${srv.base}/slow.m3u8`, { timeoutMs: 300 });
    const took = Date.now() - started;
    assert.equal(r.status, "offline");
    assert.match(r.error ?? "", /timeout/);
    assert.ok(took < 3000, `returned after ${took} ms`);
  });

  test("a redirect is followed to the valid playlist", async () => {
    const r = await probeStream(`${srv.base}/redirect.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
    assert.equal(r.httpStatus, 200);
  });

  test("a redirect loop gives up after 5 hops", async () => {
    const before = srv.hits.get("/redirect-loop.m3u8") ?? 0;
    const r = await probeStream(`${srv.base}/redirect-loop.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
    assert.match(r.error ?? "", /redirects/);
    assert.equal((srv.hits.get("/redirect-loop.m3u8") ?? 0) - before, 6, "one request plus five redirects");
  });

  test("UA-checking endpoint: 403 without the stream's UA, online with it", async () => {
    const without = await probeStream(`${srv.base}/ua-check.m3u8`, { timeoutMs: 2000 });
    assert.equal(without.status, "offline");
    assert.equal(without.httpStatus, 403);

    const withUa = await probeStream(`${srv.base}/ua-check.m3u8`, { userAgent: UA_REQUIRED, timeoutMs: 2000 });
    assert.equal(withUa.status, "online");
  });

  test("the Referer header is sent when given", async () => {
    let seen: string | undefined;
    const http = await import("node:http");
    const probe = http.createServer((req, res) => {
      seen = req.headers.referer;
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n");
    });
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    try {
      const r = await probeStream(`http://127.0.0.1:${port}/x.m3u8`, { referrer: "https://example.test/", timeoutMs: 2000 });
      assert.equal(r.status, "online");
      assert.equal(seen, "https://example.test/");
    } finally {
      probe.close();
    }
  });

  test("a non-m3u8 URL with a media content type and bytes is online", async () => {
    const r = await probeStream(`${srv.base}/stream.ts`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
  });

  test("a non-m3u8 URL with a media content type but an empty body is offline", async () => {
    const r = await probeStream(`${srv.base}/empty-ts`, { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
  });

  test("an m3u8 URL answering HTML (login page) is offline", async () => {
    const r = await probeStream(`${srv.base}/html-page.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
    assert.match(r.error ?? "", /not an HLS playlist/);
  });

  test("connection refused is offline with no HTTP status", async () => {
    const r = await probeStream("http://127.0.0.1:1/x.m3u8", { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
    assert.equal(r.httpStatus, null);
    assert.ok(r.error);
  });

  test("unsupported schemes and malformed URLs are offline and never throw", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.test/x.m3u8", "not a url", ""]) {
      const r = await probeStream(url, { timeoutMs: 2000 });
      assert.equal(r.status, "offline", url);
      assert.equal(r.httpStatus, null, url);
    }
  });

  test("DNS failure is offline", async () => {
    const r = await probeStream("http://nonexistent.invalid/x.m3u8", { timeoutMs: 3000 });
    assert.equal(r.status, "offline");
    assert.equal(r.httpStatus, null);
  });
});
