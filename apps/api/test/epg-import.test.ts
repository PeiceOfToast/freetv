import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb, getDb, getMeta } from "../src/db/index.js";
import { importEpg } from "../src/epg/importer.js";
import { gzipIsCurrent } from "../src/lib/export-guide.js";
import { setNowFn } from "../src/epg/time.js";
import { buildServer } from "../src/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(here, "fixtures", "sample-guide.xml");

// Frozen clock: 2026-10-15T10:01:00Z. BBC News at Ten is on now, Newsday is next.
const FROZEN = 1792058460;
const BBC_TEN = 1792058400;
const NEWSDAY = 1792062000;

const bbcTen = {
  title: "BBC News at Ten",
  description: "The latest national and international news.",
  start: BBC_TEN,
  stop: NEWSDAY,
  category: "News",
  icon: null,
};
const newsday = { title: "Newsday", description: null, start: NEWSDAY, stop: 1792065600, category: null, icon: null };
const cnn = {
  title: "CNN Newsroom",
  description: null,
  start: BBC_TEN,
  stop: 1792063800,
  category: null,
  icon: "https://example.com/icon.png",
};

describe("epg import + routes", () => {
  let dir: string;
  let app: FastifyInstance;
  const savedFile = config.epgFile;
  const savedLog = config.logLevel;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-epg-"));
    config.epgFile = path.join(dir, "guide.xml");
    fs.copyFileSync(SAMPLE, config.epgFile);
    config.logLevel = "silent";
    openDb(path.join(dir, "catalog.db"));
    setNowFn(() => FROZEN);
    await importEpg({});
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
    setNowFn(null);
    closeDb();
    config.epgFile = savedFile;
    config.logLevel = savedLog;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: "GET", url });

  test("import stores 3 rows and sets meta", () => {
    const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM programmes").get() as { n: number };
    assert.equal(n, 3);
    assert.equal(getMeta("programmes_count"), "3");
    assert.ok(Number(getMeta("last_epg_import")) > 0);
    assert.ok(getMeta("epg_file_mtime"));
    assert.equal(getMeta("epg_file_size"), String(fs.statSync(config.epgFile).size));
  });

  test("unchanged file is skipped unless forced", async () => {
    getDb().prepare("INSERT INTO programmes VALUES ('Marker', 1, 2, 'marker', NULL, NULL, NULL)").run();
    await importEpg({});
    const marker = () => getDb().prepare("SELECT COUNT(*) AS n FROM programmes WHERE channel = 'Marker'").get() as { n: number };
    assert.equal(marker().n, 1, "non-forced import must skip an unchanged file");
    await importEpg({ force: true });
    assert.equal(marker().n, 0, "forced import replaces the table");
  });

  test("changed file is re-imported on the next pass", async () => {
    const extra = `<programme start="20261015120000 +0000" stop="20261015130000 +0000" channel="BBCNews.uk"><title>Extra</title></programme>`;
    const xml = fs.readFileSync(SAMPLE, "utf8").replace("</tv>", `${extra}</tv>`);
    fs.writeFileSync(config.epgFile, xml);
    await importEpg({});
    assert.equal(getMeta("programmes_count"), "4");
    // restore the fixture so later route tests see the sample data
    fs.copyFileSync(SAMPLE, config.epgFile);
    await importEpg({});
    assert.equal(getMeta("programmes_count"), "3");
  });

  test("missing file is logged and skipped without throwing", async () => {
    const saved = config.epgFile;
    config.epgFile = path.join(dir, "does-not-exist.xml");
    try {
      await importEpg({});
    } finally {
      config.epgFile = saved;
    }
  });

  test("import drops the staging table and leaves a gzip copy of the guide next to it", () => {
    const staging = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'programmes_new'").get();
    assert.equal(staging, undefined, "staging table is dropped after the swap");
    const gz = `${config.epgFile}.gz`;
    assert.ok(fs.existsSync(gz), "guide.xml.gz written");
    assert.equal(zlib.gunzipSync(fs.readFileSync(gz)).toString("utf8"), fs.readFileSync(config.epgFile, "utf8"));
    const gzSt = fs.statSync(gz);
    const srcSt = fs.statSync(config.epgFile);
    assert.ok(gzipIsCurrent(gzSt, srcSt), "gz is not older than the source, so it is served");
    assert.ok(gzipIsCurrent(srcSt, gzSt), "and it is not newer (same mtime to the millisecond)");
    assert.deepEqual(
      fs.readdirSync(path.dirname(gz)).filter((f) => f.endsWith(".tmp")),
      [],
      "no temp file left behind",
    );
  });

  test("channel epg: window returns overlapping items in start order", async () => {
    const res = await get("/api/channels/BBCNews.uk/epg?from=1792058000&to=1792070000");
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "public, max-age=60");
    const body = res.json() as { channel: string; items: unknown[] };
    assert.equal(body.channel, "BBCNews.uk");
    assert.equal(body.items.length, 2);
    assert.deepEqual(body.items, [bbcTen, newsday]);
  });

  test("channel epg: window edges exclude programmes that only touch it", async () => {
    const res = await get(`/api/channels/BBCNews.uk/epg?from=${NEWSDAY}&to=${NEWSDAY + 60}`);
    assert.deepEqual((res.json() as { items: unknown[] }).items, [newsday]);
  });

  test("channel epg: defaults to now-2h .. now+24h", async () => {
    const res = await get("/api/channels/CNN.us/epg");
    assert.deepEqual((res.json() as { items: unknown[] }).items, [cnn]);
  });

  test("channel epg: unknown channel gives empty items", async () => {
    const res = await get("/api/channels/Nope.xx/epg");
    assert.equal(res.statusCode, 200);
    assert.deepEqual((res.json() as { items: unknown[] }).items, []);
  });

  test("channel epg: bad params give 400", async () => {
    for (const q of [
      "from=abc",
      "to=1.5",
      "from=1792070000&to=1792058000",
      "from=1792058000&to=1792058000",
      `from=${FROZEN - 8 * 86400}&to=${FROZEN}`,
    ]) {
      const res = await get(`/api/channels/BBCNews.uk/epg?${q}`);
      assert.equal(res.statusCode, 400, q);
      assert.ok((res.json() as { error: string }).error);
    }
  });

  test("now: current and next per channel, nulls for unknown ids", async () => {
    const res = await get("/api/epg/now?ids=BBCNews.uk,CNN.us,Missing.xx");
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "public, max-age=60");
    assert.deepEqual(res.json(), {
      "BBCNews.uk": { now: bbcTen, next: newsday },
      "CNN.us": { now: cnn, next: null },
      "Missing.xx": { now: null, next: null },
    });
  });

  test("now: after the last programme both are null", async () => {
    setNowFn(() => 1792070000);
    try {
      const res = await get("/api/epg/now?ids=BBCNews.uk");
      assert.deepEqual(res.json(), { "BBCNews.uk": { now: null, next: null } });
    } finally {
      setNowFn(() => FROZEN);
    }
  });

  test("now: before the first programme next is the first one", async () => {
    setNowFn(() => 1792050000);
    try {
      const res = await get("/api/epg/now?ids=BBCNews.uk");
      assert.deepEqual(res.json(), { "BBCNews.uk": { now: null, next: bbcTen } });
    } finally {
      setNowFn(() => FROZEN);
    }
  });

  test("now: missing ids and too many ids give 400", async () => {
    assert.equal((await get("/api/epg/now")).statusCode, 400);
    assert.equal((await get("/api/epg/now?ids=,,")).statusCode, 400);
    const many = Array.from({ length: 201 }, (_, i) => `C${i}`).join(",");
    assert.equal((await get(`/api/epg/now?ids=${many}`)).statusCode, 400);
  });

  test("grid: programmes per channel within the window, empty arrays for others", async () => {
    const res = await get("/api/epg/grid?ids=BBCNews.uk,CNN.us,Nope.xx&from=1792058000&to=1792070000");
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "public, max-age=60");
    assert.deepEqual(res.json(), {
      from: 1792058000,
      to: 1792070000,
      channels: { "BBCNews.uk": [bbcTen, newsday], "CNN.us": [cnn], "Nope.xx": [] },
    });
  });

  test("grid: default window is 24 hours", async () => {
    const body = (await get("/api/epg/grid?ids=BBCNews.uk")).json() as { from: number; to: number };
    assert.equal(body.to - body.from, 86400);
  });

  test("grid: window over 24h, too many ids, or missing ids give 400", async () => {
    assert.equal((await get("/api/epg/grid?ids=BBCNews.uk&from=1792000000&to=1792086401")).statusCode, 400);
    assert.equal((await get("/api/epg/grid")).statusCode, 400);
    const many = Array.from({ length: 101 }, (_, i) => `C${i}`).join(",");
    assert.equal((await get(`/api/epg/grid?ids=${many}&from=1792000000&to=1792003600`)).statusCode, 400);
  });
});
