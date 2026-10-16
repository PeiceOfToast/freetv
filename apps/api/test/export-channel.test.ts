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
import { safeFilename } from "../src/routes/export.js";
import { updateSettings } from "../src/lib/settings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const BBC = "BBCNews.uk";

config.logLevel = "silent";
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.proxyPublicPath = "/proxy";
config.hideNsfwDefault = true;

describe("GET /api/channels/:id/playlist.m3u", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  const get = (url: string) => app.inject({ method: "GET", url });
  const urlsOf = (body: string) => body.split("\n").filter((l) => l && !l.startsWith("#"));

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-export-channel-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
    config.publicUrl = "";
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    config.publicUrl = "";
    await app.close();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a channel's playlist lists every stream as its origin URL, in catalog order", async () => {
    const res = await get(`/api/channels/${BBC}/playlist.m3u`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "audio/x-mpegurl; charset=utf-8");
    assert.equal(res.headers["cache-control"], "public, max-age=300");
    assert.equal(res.headers["content-disposition"], 'attachment; filename="BBC News.m3u"');

    const want = (db.prepare("SELECT url FROM streams WHERE channel = ? ORDER BY idx").all(BBC) as Array<{ url: string }>).map((r) => r.url);
    assert.ok(want.length > 1, "fixture has several BBC streams");
    assert.deepEqual(urlsOf(res.body), want, "origin URLs, never /proxy/ relay URLs");
    assert.equal(res.body.split("\n").filter((l) => l.startsWith("#EXTINF:")).length, want.length, "one EXTINF per stream");
  });

  test("header lines: x-tvg-url from the base, then the site name", async () => {
    const lines = (await get(`/api/channels/${BBC}/playlist.m3u`)).body.split("\n");
    assert.equal(lines[0], '#EXTM3U x-tvg-url="http://localhost:80/api/guide.xml"');
    assert.equal(lines[1], "#PLAYLIST:FreeTV");
  });

  test("tvg-chno carries the channel number when the channel has one", async () => {
    const number = (db.prepare("SELECT number FROM channels WHERE id = ?").get(BBC) as { number: number | null }).number;
    const extinf = (await get(`/api/channels/${BBC}/playlist.m3u`)).body.split("\n").find((l) => l.startsWith("#EXTINF:"))!;
    if (number === null) assert.doesNotMatch(extinf, /tvg-chno/);
    else assert.match(extinf, new RegExp(`tvg-chno="${number}"`));
  });

  test("unknown id is a 404 with a JSON error", async () => {
    const res = await get("/api/channels/No.Such.Channel/playlist.m3u");
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "channel not found");
  });

  test("a blocked channel is a 404", async () => {
    db.prepare("UPDATE channels SET blocked = 1 WHERE id = ?").run(BBC);
    try {
      assert.equal((await get(`/api/channels/${BBC}/playlist.m3u`)).statusCode, 404);
    } finally {
      db.prepare("UPDATE channels SET blocked = 0 WHERE id = ?").run(BBC);
    }
  });

  test("the stored public URL and site name appear in the header", async () => {
    updateSettings({ siteName: "Export Site", publicUrl: "https://tv.export.example.test" });
    const lines = (await get(`/api/channels/${BBC}/playlist.m3u`)).body.split("\n");
    assert.equal(lines[0], '#EXTM3U x-tvg-url="https://tv.export.example.test/api/guide.xml"');
    assert.equal(lines[1], "#PLAYLIST:Export Site");
    updateSettings({ siteName: "FreeTV", publicUrl: "" });
  });
});

describe("safeFilename", () => {
  test("keeps letters, digits, space, dot, dash and underscore; replaces the rest", () => {
    assert.equal(safeFilename("BBC News", "x"), "BBC News");
    const f = safeFilename('Fox "News" / 24/7', "x");
    assert.match(f, /^[A-Za-z0-9 ._-]+$/);
    assert.doesNotMatch(f, /["\\/]/);
  });

  test("never starts with dots, and falls back to the id when nothing usable is left", () => {
    assert.equal(safeFilename("..hidden", "x"), "hidden");
    assert.equal(safeFilename("日本語", "Some.Id"), "Some.Id");
  });

  test("is capped at 80 characters", () => {
    assert.equal(safeFilename("a".repeat(200), "x").length, 80);
  });
});
