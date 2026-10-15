import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb, type Db } from "../src/db/index.js";
import { buildCatalogFromDir } from "../src/ingest/index.js";
import { buildServer } from "../src/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const TOKEN = "test-admin-token";

config.logLevel = "silent";
config.adminToken = TOKEN;
config.proxyEnabled = true;
config.proxySecret = "test-secret";

const FAMILIES = [
  "freetv_channels_total",
  "freetv_channels_with_streams",
  "freetv_streams_online",
  "freetv_programmes_total",
  "freetv_ingest_last_timestamp",
  "freetv_epg_last_import_timestamp",
  "freetv_probe_last_timestamp",
  "freetv_http_requests_total",
  "freetv_http_request_duration_seconds",
];

describe("admin routes", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;

  const auth = { authorization: `Bearer ${TOKEN}` };
  const status = (headers: Record<string, string> = {}) => app.inject({ method: "GET", url: "/api/admin/status", headers });
  const scrape = async () => (await app.inject({ method: "GET", url: "/metrics" })).body;
  const requestCount = (body: string, route: string, code: string) => {
    const m = body.match(new RegExp(`freetv_http_requests_total\\{route="${route.replace(/\//g, "\\/")}",status="${code}"\\} (\\d+)`));
    return m ? Number(m[1]) : 0;
  };

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-routes-admin-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("GET /api/admin/status", () => {
    test("401 without a token", async () => {
      const res = await status();
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers["cache-control"], "no-store");
    });

    test("401 with a wrong token of the same length", async () => {
      const res = await status({ authorization: `Bearer ${"x".repeat(TOKEN.length)}` });
      assert.equal(res.statusCode, 401);
    });

    test("401 when ADMIN_TOKEN is not configured, even for an empty bearer", async () => {
      const saved = config.adminToken;
      config.adminToken = "";
      try {
        assert.equal((await status({ authorization: "Bearer " })).statusCode, 401);
        assert.equal((await status()).statusCode, 401);
      } finally {
        config.adminToken = saved;
      }
    });

    test("200 with the token and the documented key set", async () => {
      const res = await status(auth);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["cache-control"], "no-store");
      const body = JSON.parse(res.body) as Record<string, any>;
      assert.deepEqual(Object.keys(body).sort(), ["catalog", "db", "epg", "health", "logos", "now", "proxy", "uptime", "version"]);
      assert.deepEqual(Object.keys(body.catalog).sort(), ["channels", "lastIngest", "lastIngestMs", "source", "streams", "withStreams"]);
      assert.deepEqual(Object.keys(body.epg).sort(), ["file", "lastImport", "programmes"]);
      assert.deepEqual(Object.keys(body.epg.file).sort(), ["exists", "mtime", "size"]);
      assert.deepEqual(Object.keys(body.health).sort(), ["lastProbe", "lastProbeMs", "offline", "online", "probed", "running"]);
      assert.deepEqual(Object.keys(body.logos).sort(), ["bytes", "cached"]);
      assert.deepEqual(Object.keys(body.proxy), ["enabled"]);
      assert.deepEqual(Object.keys(body.db).sort(), ["bytes", "walBytes"]);
      assert.equal(body.version, config.version);
      assert.equal(body.catalog.channels > 0, true);
      assert.equal(body.health.running, false);
      assert.equal(body.proxy.enabled, true);
      assert.equal(body.db.bytes > 0, true);
    });

    test("accepts the token from a case-sensitive Bearer header only", async () => {
      assert.equal((await status({ authorization: `bearer ${TOKEN}` })).statusCode, 401);
    });
  });

  describe("GET /metrics", () => {
    test("is public and exposes the named metric families", async () => {
      const res = await app.inject({ method: "GET", url: "/metrics" });
      assert.equal(res.statusCode, 200);
      assert.match(String(res.headers["content-type"]), /^text\/plain/);
      for (const f of FAMILIES) assert.match(res.body, new RegExp(`^# TYPE ${f} `, "m"), f);
      assert.match(res.body, /^freetv_channels_total \d+$/m);
      assert.match(res.body, /freetv_http_request_duration_seconds_bucket\{le="\+Inf"\} \d+/);
    });

    test("request counter increments after a request", async () => {
      const before = requestCount(await scrape(), "/api/health", "200");
      await app.inject({ method: "GET", url: "/api/health" });
      const after = requestCount(await scrape(), "/api/health", "200");
      assert.equal(after, before + 1);
    });

    test("labels unknown paths as unmatched and counts 401s by status", async () => {
      await app.inject({ method: "GET", url: "/no/such/path" });
      await status();
      const body = await scrape();
      assert.ok(requestCount(body, "unmatched", "404") >= 1);
      assert.ok(requestCount(body, "/api/admin/status", "401") >= 1);
    });
  });
});
