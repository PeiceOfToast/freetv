import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb, type Db } from "../src/db/index.js";
import { buildCatalogFromDir } from "../src/ingest/index.js";
import { buildServer } from "../src/server.js";
import { runProbe } from "../src/prober/index.js";
import { browserPlayableOf, probeStream, type ProbeResult } from "../src/prober/probe.js";
import { applyResults, enforceRelayOnly } from "../src/prober/scheduler.js";
import { VALID_PLAYLIST } from "./prober-server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const BBC = "BBCNews.uk";

config.logLevel = "silent";
config.fetchAllowPrivate = true;
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.hideNsfwDefault = true;
config.probeRatePerSecond = 100;
config.probeConcurrency = 4;
config.probeTimeoutMs = 400;

const online = (browserOk: boolean | null): ProbeResult => ({ status: "online", httpStatus: 200, latencyMs: 1, error: null, browserOk });
const offline: ProbeResult = { status: "offline", httpStatus: null, latencyMs: 1, error: "boom", browserOk: null };

describe("browserPlayableOf", () => {
  test("https with exactly * is browser-playable (whitespace around * is ignored)", () => {
    assert.equal(browserPlayableOf("https://cdn.example.test/a.m3u8", "*"), true);
    assert.equal(browserPlayableOf("https://cdn.example.test/a.m3u8", " * "), true);
  });

  test("a specific origin, a missing header or an empty value is not browser-playable", () => {
    assert.equal(browserPlayableOf("https://cdn.example.test/a.m3u8", "https://player.example"), false);
    assert.equal(browserPlayableOf("https://cdn.example.test/a.m3u8", null), false);
    assert.equal(browserPlayableOf("https://cdn.example.test/a.m3u8", ""), false);
    assert.equal(browserPlayableOf("https://cdn.example.test/a.m3u8", undefined), false);
  });

  test("plain http is never browser-playable, even with *", () => {
    assert.equal(browserPlayableOf("http://cdn.example.test/a.m3u8", "*"), false);
  });

  test("an unparsable final URL is not browser-playable", () => {
    assert.equal(browserPlayableOf("not a url", "*"), false);
  });
});

describe("probeStream browserOk (local server, http only)", () => {
  let base: string;
  let server: http.Server;

  before(async () => {
    server = http.createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const playlist = (headers: Record<string, string>) => {
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl", ...headers });
        res.end(VALID_PLAYLIST);
      };
      switch (path) {
        case "/cors.m3u8":
          return playlist({ "access-control-allow-origin": "*" });
        case "/cors-origin.m3u8":
          return playlist({ "access-control-allow-origin": "https://player.example" });
        case "/plain.m3u8":
          return playlist({});
        case "/cors-redirect.m3u8":
          res.writeHead(302, { location: "/cors.m3u8" });
          return res.end();
        case "/missing.m3u8":
          res.writeHead(404, { "access-control-allow-origin": "*" });
          return res.end("nope");
        default:
          res.writeHead(404);
          return res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });

  test("an http playlist with CORS * is online but not browser-playable (the scheme decides)", async () => {
    const r = await probeStream(`${base}/cors.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
    assert.equal(r.browserOk, false);
  });

  test("an http playlist without CORS is online with browserOk false", async () => {
    const r = await probeStream(`${base}/plain.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
    assert.equal(r.browserOk, false);
  });

  test("a specific Access-Control-Allow-Origin is not counted", async () => {
    const r = await probeStream(`${base}/cors-origin.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
    assert.equal(r.browserOk, false);
  });

  test("a redirect that ends on http is judged on the final URL", async () => {
    const r = await probeStream(`${base}/cors-redirect.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "online");
    assert.equal(r.browserOk, false);
  });

  test("a failed probe reports browserOk null, even when CORS headers came back", async () => {
    const r = await probeStream(`${base}/missing.m3u8`, { timeoutMs: 2000 });
    assert.equal(r.status, "offline");
    assert.equal(r.httpStatus, 404);
    assert.equal(r.browserOk, null);
  });

  test("connection refused reports browserOk null", async () => {
    const r = await probeStream("http://127.0.0.1:1/x.m3u8", { timeoutMs: 2000 });
    assert.equal(r.browserOk, null);
  });
});

describe("applyResults and the relay rule", () => {
  let dir: string;
  let db: Db;
  const streamsOf = (url: string) => db.prepare("SELECT browser_ok AS b FROM streams WHERE url = ?").all(url) as Array<{ b: number | null }>;
  const healthOf = (url: string) =>
    (db.prepare("SELECT browser_ok AS b FROM stream_health WHERE url = ?").get(url) as { b: number | null } | undefined)?.b;
  const browserCount = () => (db.prepare("SELECT browser_count AS n FROM channels WHERE id = ?").get(BBC) as { n: number }).n;
  const now = () => Math.floor(Date.now() / 1000);
  const [A, B, C] = ["https://cdn.test/a.m3u8", "https://cdn.test/b.m3u8", "https://cdn.test/c.m3u8"];

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-prober-browser-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
    const ids = (db.prepare("SELECT id FROM streams WHERE channel = ? ORDER BY id LIMIT 3").all(BBC) as Array<{ id: number }>).map((r) => r.id);
    [A, B, C].forEach((u, i) => db.prepare("UPDATE streams SET url = ? WHERE id = ?").run(u, ids[i]));
  });
  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a CORS-open https result is stored on stream_health, mirrored to streams and counted on the channel", () => {
    applyResults(db, [{ url: A, result: online(true) }], now());
    assert.equal(healthOf(A), 1);
    assert.deepEqual(streamsOf(A), [{ b: 1 }]);
    assert.equal(browserCount(), 1);
  });

  test("a failed probe keeps the stored browser value", () => {
    applyResults(db, [{ url: A, result: offline }], now());
    assert.equal(healthOf(A), 1);
    assert.equal(browserCount(), 1);
  });

  test("a completed probe that finds no CORS records 0 and the count drops", () => {
    applyResults(db, [{ url: A, result: online(false) }], now());
    assert.equal(healthOf(A), 0);
    assert.deepEqual(streamsOf(A), [{ b: 0 }]);
    assert.equal(browserCount(), 0);
  });

  test("a relay-only URL is 0 even when the probe says browser-ok, and also when the probe fails", () => {
    applyResults(db, [{ url: B, result: online(true), relayOnly: true }], now());
    assert.equal(healthOf(B), 0);
    applyResults(db, [{ url: C, result: offline, relayOnly: true }], now());
    assert.equal(healthOf(C), 0);
  });

  test("the catalog sweep sets 0 on relay rows that were never probed and recounts their channel", () => {
    // A row with a User-Agent and browser_ok = 1 (as a re-ingest could copy it over), never probed.
    const ua = db.prepare("SELECT id FROM streams WHERE channel = ? AND url NOT IN (?, ?, ?) ORDER BY id LIMIT 1").get(BBC, A, B, C) as { id: number };
    db.prepare("UPDATE streams SET user_agent = 'Relay/1.0', browser_ok = 1 WHERE id = ?").run(ua.id);
    db.prepare("UPDATE channels SET browser_count = 1 WHERE id = ?").run(BBC);
    enforceRelayOnly(db);
    const row = db.prepare("SELECT browser_ok AS b FROM streams WHERE id = ?").get(ua.id) as { b: number };
    assert.equal(row.b, 0);
    assert.equal(browserCount(), 0);
  });
});

describe("runProbe end to end", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let server: http.Server;
  let base: string;

  before(async () => {
    server = http.createServer((req, res) => {
      if ((req.url ?? "").startsWith("/missing")) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*" });
      res.end(VALID_PLAYLIST);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-prober-browser-run-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
    const keep = (db.prepare("SELECT id FROM streams WHERE channel = ? ORDER BY id LIMIT 3").all(BBC) as Array<{ id: number }>).map((r) => r.id);
    db.prepare(`DELETE FROM streams WHERE channel = ? AND id NOT IN (${keep.map(() => "?").join(",")})`).run(BBC, ...keep);
    db.prepare("UPDATE streams SET url = ? WHERE id = ?").run(`${base}/cors.m3u8`, keep[0]);
    db.prepare("UPDATE streams SET url = ? WHERE id = ?").run(`${base}/plain.m3u8`, keep[1]);
    db.prepare("UPDATE streams SET url = ? WHERE id = ?").run(`${base}/missing.m3u8`, keep[2]);
    app = await buildServer();
    await app.ready();
  });
  after(async () => {
    await app.close();
    closeDb();
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a pass stores browserOk per stream, leaves failed checks null and reports the channel as known-but-not-playable", async () => {
    await runProbe(undefined, { channels: [BBC], limit: 3 });
    const [withCors, plain, missing] = (db.prepare("SELECT id FROM streams WHERE channel = ? ORDER BY id").all(BBC) as Array<{ id: number }>).map((r) => r.id);
    const val = (id: number) => (db.prepare("SELECT browser_ok AS b FROM streams WHERE id = ?").get(id) as { b: number | null }).b;
    assert.equal(val(withCors), 0, "http with CORS is not browser-playable");
    assert.equal(val(plain), 0, "http without CORS is not browser-playable");
    assert.equal(val(missing), null, "a failed probe leaves browser_ok unknown");

    const ch = (db.prepare("SELECT browser_count AS n FROM channels WHERE id = ?").get(BBC) as { n: number }).n;
    assert.equal(ch, 0);

    const detail = (await app.inject({ method: "GET", url: `/api/channels/${BBC}` })).json() as {
      streams: Array<{ url: string; browserPlayable: boolean | null }>;
    };
    const byUrl = (u: string) => detail.streams.find((s) => s.url === u)?.browserPlayable;
    assert.equal(byUrl(`${base}/cors.m3u8`), false);
    assert.equal(byUrl(`${base}/plain.m3u8`), false);
    assert.equal(byUrl(`${base}/missing.m3u8`), null);

    const list = (await app.inject({ method: "GET", url: `/api/channels?favorites=${BBC}` })).json() as {
      items: Array<{ id: string; browserPlayable: boolean | null }>;
    };
    assert.equal(list.items[0].browserPlayable, false, "probed, nothing browser-playable");
  });
});
