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
import { makeProxyUrl } from "../src/lib/sign.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

config.logLevel = "silent";
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.proxyPublicPath = "/proxy";

describe("GET /api/stream/:id/:index/play", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;

  const get = (url: string) => app.inject({ method: "GET", url });
  const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-routes-stream-"));
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

  test("resolves stream index 0 with a signed proxy URL matching the detail endpoint", async () => {
    const res = await get("/api/stream/BBCNews.uk/0/play");
    assert.equal(res.statusCode, 200);
    const body = json(res);
    const row = db.prepare("SELECT url, user_agent, referrer FROM streams WHERE channel = 'BBCNews.uk' AND idx = 0").get() as {
      url: string;
      user_agent: string | null;
      referrer: string | null;
    };
    assert.equal(body.url, row.url);
    assert.equal(body.userAgent, row.user_agent);
    assert.equal(body.referrer, row.referrer);
    assert.equal(body.proxyUrl, makeProxyUrl("test-secret", "/proxy", row.url, row.user_agent, row.referrer));
    assert.equal(res.headers["cache-control"], "public, max-age=60");
  });

  test("User-Agent and Referer are carried inside the signed payload", async () => {
    db.prepare("UPDATE streams SET user_agent = 'UA/1.0', referrer = 'https://ref.example/' WHERE channel = 'BBCNews.uk' AND idx = 0").run();
    const body = json(await get("/api/stream/BBCNews.uk/0/play"));
    const payload = body.proxyUrl.split("/").pop() as string;
    assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), {
      u: body.url,
      ua: "UA/1.0",
      r: "https://ref.example/",
    });
    assert.equal(body.userAgent, "UA/1.0");
    assert.equal(body.referrer, "https://ref.example/");
    db.prepare("UPDATE streams SET user_agent = NULL, referrer = NULL WHERE channel = 'BBCNews.uk' AND idx = 0").run();
  });

  test("proxyUrl is omitted when the proxy is disabled", async () => {
    config.proxyEnabled = false;
    try {
      const body = json(await get("/api/stream/BBCNews.uk/0/play"));
      assert.equal("proxyUrl" in body, false);
      assert.ok(body.url);
    } finally {
      config.proxyEnabled = true;
    }
  });

  test("out-of-range index and unknown channel are 404", async () => {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM streams WHERE channel = 'BBCNews.uk'").get() as { n: number }).n;
    const beyond = await get(`/api/stream/BBCNews.uk/${count}/play`);
    assert.equal(beyond.statusCode, 404);
    assert.equal(json(beyond).error, "stream not found");
    const unknown = await get("/api/stream/Nope.xx/0/play");
    assert.equal(unknown.statusCode, 404);
  });

  test("garbage index is 400 with an error body", async () => {
    for (const idx of ["abc", "-1", "1.5", "0x1"]) {
      const res = await get(`/api/stream/BBCNews.uk/${idx}/play`);
      assert.equal(res.statusCode, 400, idx);
      assert.equal(typeof json(res).error, "string", idx);
      assert.equal(res.headers["cache-control"], undefined, idx);
    }
  });
});
