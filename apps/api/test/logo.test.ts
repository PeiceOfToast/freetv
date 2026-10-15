import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import sharp from "sharp";
import { config } from "../src/config.js";
import { openDb, closeDb, getDb, type Db } from "../src/db/index.js";
import { buildCatalogFromDir } from "../src/ingest/index.js";
import { logoRoutes } from "../src/routes/logo.js";
import {
  closeLogoCache,
  getLogo,
  logoCacheStats,
  logoOptions,
  normalizeLogoSize,
  publicLogoUrl,
  svgIsSafe,
} from "../src/lib/logo-cache.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

const SAVED = {
  enabled: config.logoCacheEnabled,
  maxMb: config.logoCacheMaxMb,
  maxSize: config.logoMaxSize,
  ttl: logoOptions.negativeTtlMs,
};

/** Every file under dir except the index, as paths relative to dir. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const shard of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(dir, shard.name))) out.push(`${shard.name}/${f}`);
  }
  return out;
}
const imageFiles = (dir: string) => listFiles(dir).filter((f) => /\.(webp|png|svg)$/.test(f));

describe("logo cache", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let upstream: http.Server;
  let base: string;
  let pngBuf: Buffer;
  let ids: string[];

  const counts = new Map<string, number>();
  const upstreamHits = (p: string) => counts.get(p) ?? 0;
  const enc = (id: string) => encodeURIComponent(id);
  const setLogo = (id: string, url: string | null) =>
    db.prepare("UPDATE channels SET logo_url = ? WHERE id = ?").run(url, id);

  /** 400x400 RGBA noise with a transparent top-left quadrant, so output must keep alpha. */
  async function makePng(): Promise<Buffer> {
    const w = 400;
    const h = 400;
    const raw = crypto.randomBytes(w * h * 4);
    for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 2; x++) raw[(y * w + x) * 4 + 3] = 0;
    return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  }

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-logo-"));
    config.logoCacheEnabled = true;
    config.logoCacheDir = path.join(dir, "logos");
    config.logoCacheMaxMb = 50;
    config.logoMaxSize = 512;
    logoOptions.fetchTimeoutMs = 500;

    pngBuf = await makePng();
    const svgOk = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>`;
    const svgEvil = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;

    upstream = http.createServer((req, res) => {
      const u = req.url ?? "/";
      counts.set(u, (counts.get(u) ?? 0) + 1);
      const p = u.split("?")[0];
      const png = () => {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(pngBuf);
      };
      switch (p) {
        case "/png":
          return png();
        case "/svg":
          res.writeHead(200, { "content-type": "image/svg+xml" });
          return res.end(svgOk);
        case "/evil":
          res.writeHead(200, { "content-type": "image/svg+xml" });
          return res.end(svgEvil);
        case "/missing":
          res.writeHead(404);
          return res.end("nope");
        case "/slow":
          return setTimeout(() => !res.destroyed && png(), 1500);
        case "/single":
          return setTimeout(() => !res.destroyed && png(), 150);
        case "/huge": {
          const size = 6 * 1024 * 1024;
          res.writeHead(200, { "content-type": "image/png", "content-length": String(size) });
          return res.end(Buffer.alloc(size));
        }
        case "/text":
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("hello");
        default:
          res.writeHead(404);
          return res.end();
      }
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const port = (upstream.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;

    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
    ids = (db.prepare("SELECT id FROM channels WHERE blocked = 0 ORDER BY id LIMIT 20").all() as Array<{ id: string }>).map(
      (r) => r.id,
    );
    assert.ok(ids.length >= 16, "fixture needs at least 16 unblocked channels");

    const urls: Array<string | null> = [
      `${base}/png`, // 0 happy path
      `${base}/svg`, // 1 clean svg
      `${base}/evil`, // 2 script svg
      `${base}/missing`, // 3 upstream 404
      `${base}/slow`, // 4 slower than the fetch timeout
      null, // 5 no logo
      `${base}/single`, // 6 single-flight
      `${base}/huge`, // 7 over 5 MB
      `${base}/text`, // 8 not an image
      `${base}/png`, // 9-12 eviction
      `${base}/png`,
      `${base}/png`,
      `${base}/png`,
      `${base}/png?v=1`, // 13 upstream URL change
    ];
    urls.forEach((u, i) => setLogo(ids[i], u));

    app = Fastify({ logger: false });
    await app.register(logoRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeLogoCache();
    closeDb();
    await new Promise<void>((resolve) => {
      upstream.closeAllConnections();
      upstream.close(() => resolve());
    });
    config.logoCacheEnabled = SAVED.enabled;
    config.logoCacheMaxMb = SAVED.maxMb;
    config.logoMaxSize = SAVED.maxSize;
    logoOptions.negativeTtlMs = SAVED.ttl;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("publicLogoUrl is the relative /logo path when enabled, the upstream URL otherwise", () => {
    assert.equal(publicLogoUrl("A&B.us", "https://x.example/a.png"), `/logo/${enc("A&B.us")}`);
    assert.equal(publicLogoUrl("A&B.us", null), null);
    config.logoCacheEnabled = false;
    try {
      assert.equal(publicLogoUrl("A&B.us", "https://x.example/a.png"), "https://x.example/a.png");
      assert.equal(publicLogoUrl("A&B.us", null), null);
    } finally {
      config.logoCacheEnabled = SAVED.enabled;
    }
  });

  test("normalizeLogoSize snaps to a cached size and respects LOGO_MAX_SIZE", () => {
    assert.equal(normalizeLogoSize(undefined), 256);
    assert.equal(normalizeLogoSize(100), 128);
    assert.equal(normalizeLogoSize(1000), 512);
    config.logoMaxSize = 256;
    try {
      assert.equal(normalizeLogoSize(512), 256);
    } finally {
      config.logoMaxSize = SAVED.maxSize;
    }
  });

  test("returns null for channels without a logo and for unknown ids", async () => {
    assert.equal(await getLogo(ids[5], 256), null);
    assert.equal(await getLogo("does-not-exist", 256), null);
    const res = await get(`/logo/${enc(ids[5])}`);
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, "no logo");
  });

  test("serves WebP when Accept includes image/webp and PNG otherwise, keeping alpha, in sharded cache files", async () => {
    const webp = await getLogo(ids[0], 256, { webp: true });
    assert.ok(webp);
    assert.equal(webp.contentType, "image/webp");
    assert.equal(path.basename(webp.path), `${enc(ids[0])}-256.webp`);
    assert.match(path.basename(path.dirname(webp.path)), /^[0-9a-f]{2}$/);
    const wm = await sharp(webp.path).metadata();
    assert.equal(wm.format, "webp");
    assert.equal(wm.width, 256);
    assert.equal(wm.height, 256);
    assert.equal(wm.hasAlpha, true);

    const png = await getLogo(ids[0], 256);
    assert.ok(png);
    assert.equal(png.contentType, "image/png");
    assert.equal(path.basename(png.path), `${enc(ids[0])}-256.png`);
    const pm = await sharp(png.path).metadata();
    assert.equal(pm.format, "png");
    assert.equal(pm.hasAlpha, true);

    const asWebp = await get(`/logo/${enc(ids[0])}?s=256`, { accept: "image/webp,*/*" });
    assert.equal(asWebp.statusCode, 200);
    assert.equal(asWebp.headers["content-type"], "image/webp");
    assert.equal(asWebp.headers["cache-control"], "public, max-age=604800, stale-while-revalidate=86400");
    assert.equal(asWebp.headers["vary"], "Accept");
    assert.ok(asWebp.headers["etag"]);

    const asPng = await get(`/logo/${enc(ids[0])}`, { accept: "image/png" });
    assert.equal(asPng.statusCode, 200);
    assert.equal(asPng.headers["content-type"], "image/png");
  });

  test("a cache hit does not contact upstream again", async () => {
    const prev = upstreamHits("/png");
    const again = await getLogo(ids[0], 256, { webp: true });
    assert.ok(again);
    assert.equal(upstreamHits("/png"), prev);
  });

  test("resizes to fit inside the requested edge and never enlarges", async () => {
    const small = await getLogo(ids[0], 64, { webp: true });
    assert.ok(small);
    const sm = await sharp(small.path).metadata();
    assert.equal(sm.width, 64);
    assert.equal(sm.height, 64);

    const big = await getLogo(ids[0], 512, { webp: true });
    assert.ok(big);
    const bm = await sharp(big.path).metadata();
    assert.equal(bm.width, 400, "400px source is not enlarged to 512");
    assert.equal(bm.height, 400);
  });

  test("clean SVG is stored as-is and served as image/svg+xml with a locked-down CSP", async () => {
    const res = await get(`/logo/${enc(ids[1])}?s=128`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/svg+xml");
    assert.match(String(res.headers["content-security-policy"]), /sandbox/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(res.body, /<rect/);
    assert.ok(listFiles(config.logoCacheDir).some((f) => f.endsWith(`${enc(ids[1])}-128.svg`)));
  });

  test("SVG containing script is rejected, negative-cached and answered with 404", async () => {
    const res = await get(`/logo/${enc(ids[2])}`);
    assert.equal(res.statusCode, 404);
    assert.equal(imageFiles(config.logoCacheDir).filter((f) => f.includes(enc(ids[2]))).length, 0);
    assert.ok(listFiles(config.logoCacheDir).some((f) => f.endsWith(`${enc(ids[2])}.miss`)));

    assert.equal(svgIsSafe(`<svg><script>x</script></svg>`), false);
    assert.equal(svgIsSafe(`<svg onload="x()"></svg>`), false);
    assert.equal(svgIsSafe(`<svg><a href="javascript:x">y</a></svg>`), false);
    assert.equal(svgIsSafe(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`), true);
  });

  test("upstream 404 is negative-cached for the TTL, then retried", async () => {
    assert.equal(await getLogo(ids[3], 256), null);
    assert.equal(upstreamHits("/missing"), 1);
    assert.equal(await getLogo(ids[3], 256), null);
    assert.equal(upstreamHits("/missing"), 1, "second request served from the negative cache");

    logoOptions.negativeTtlMs = 0;
    try {
      assert.equal(await getLogo(ids[3], 256), null);
      assert.equal(upstreamHits("/missing"), 2, "expired marker triggers a fresh fetch");
    } finally {
      logoOptions.negativeTtlMs = SAVED.ttl;
    }
  });

  test("slow upstream hits the fetch timeout and counts as a miss", async () => {
    const started = Date.now();
    assert.equal(await getLogo(ids[4], 256), null);
    assert.ok(Date.now() - started < 1400, "gave up before the slow upstream answered");
    assert.equal(upstreamHits("/slow"), 1);
  });

  test("oversized upstream body is rejected", async () => {
    assert.equal(await getLogo(ids[7], 256), null);
    assert.equal(upstreamHits("/huge"), 1);
  });

  test("non-image upstream body is rejected", async () => {
    assert.equal(await getLogo(ids[8], 256), null);
    assert.ok(listFiles(config.logoCacheDir).some((f) => f.endsWith(`${enc(ids[8])}.miss`)));
  });

  test("304 Not Modified when If-None-Match matches the ETag", async () => {
    const first = await get(`/logo/${enc(ids[0])}?s=256`, { accept: "image/webp" });
    const etag = String(first.headers["etag"]);
    assert.ok(etag);
    const second = await get(`/logo/${enc(ids[0])}?s=256`, { accept: "image/webp", "if-none-match": etag });
    assert.equal(second.statusCode, 304);
    assert.equal(second.body, "");
    assert.equal(second.headers["etag"], etag);
    assert.equal(second.headers["cache-control"], "public, max-age=604800, stale-while-revalidate=86400");

    const stale = await get(`/logo/${enc(ids[0])}?s=256`, { accept: "image/webp", "if-none-match": '"nope"' });
    assert.equal(stale.statusCode, 200);
  });

  test("ten concurrent requests for one logo fetch upstream once", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => getLogo(ids[6], 128, { webp: true })));
    assert.equal(upstreamHits("/single"), 1);
    for (const r of results) {
      assert.ok(r);
      assert.equal(r.path, results[0]!.path);
    }
  });

  test("upstream URL change regenerates the cached variant", async () => {
    const v1 = await getLogo(ids[13], 256, { webp: true });
    assert.ok(v1);
    assert.equal(upstreamHits("/png?v=1"), 1);

    setLogo(ids[13], `${base}/png?v=2`);
    const v2 = await getLogo(ids[13], 256, { webp: true });
    assert.ok(v2);
    assert.equal(upstreamHits("/png?v=2"), 1);
  });

  test("bad size and id parameters are handled", async () => {
    const bad = await get(`/logo/${enc(ids[0])}?s=abc`);
    assert.equal(bad.statusCode, 400);
    const traversal = await get(`/logo/${encodeURIComponent("../../etc/passwd")}`);
    assert.equal(traversal.statusCode, 404);
    const huge = await get(`/logo/${enc(ids[0])}?s=9999`);
    assert.equal(huge.statusCode, 200);
    assert.equal(huge.headers["content-type"], "image/png");
  });

  test("stats report cached files and bytes", () => {
    const stats = logoCacheStats();
    assert.ok(stats.cached > 0);
    const onDisk = imageFiles(config.logoCacheDir).reduce((n, f) => n + fs.statSync(path.join(config.logoCacheDir, f)).size, 0);
    assert.equal(stats.bytes, onDisk);
  });

  test("LRU eviction keeps the cache near LOGO_CACHE_MAX_MB and protects the file just written", async () => {
    config.logoCacheMaxMb = 0.01; // ~10 KB: every encoded logo is larger than the whole budget
    try {
      for (const id of ids.slice(9, 13)) {
        const hit = await getLogo(id, 256, { webp: true });
        assert.ok(hit, `logo for ${id} should be served even when it alone exceeds the budget`);
        assert.ok(fs.existsSync(hit.path));
      }
      const remaining = imageFiles(config.logoCacheDir);
      assert.equal(remaining.length, 1, `expected one file left, got ${remaining.join(", ")}`);
      assert.ok(remaining[0].endsWith(`${enc(ids[12])}-256.webp`), "the most recently written file survives");
      assert.equal(logoCacheStats().bytes, fs.statSync(path.join(config.logoCacheDir, remaining[0])).size);
    } finally {
      config.logoCacheMaxMb = SAVED.maxMb;
    }
  });
});
