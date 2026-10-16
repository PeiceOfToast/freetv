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
const BBC = "BBCNews.uk";

config.logLevel = "silent";
config.hideNsfwDefault = true;

interface Item {
  id: string;
  browserPlayable: boolean | null;
  streamCount: number;
}

describe("browserPlayable fields and the playable filter", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let unknownId: string;
  let failingId: string;

  const get = (url: string) => app.inject({ method: "GET", url });
  const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
  const items = async (query: string) => json<{ total: number; items: Item[] }>(await get(`/api/channels?${query}&limit=200`));
  const setBrowser = (channel: string, values: Array<number | null>) => {
    const rows = db.prepare("SELECT id FROM streams WHERE channel = ? ORDER BY id").all(channel) as Array<{ id: number }>;
    db.prepare("UPDATE streams SET browser_ok = NULL WHERE channel = ?").run(channel);
    rows.forEach((r, i) => {
      if (i < values.length) db.prepare("UPDATE streams SET browser_ok = ? WHERE id = ?").run(values[i], r.id);
    });
    db.prepare(
      "UPDATE channels SET browser_count = (SELECT COUNT(*) FROM streams s WHERE s.channel = channels.id AND s.browser_ok = 1) WHERE id = ?",
    ).run(channel);
  };

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-routes-browser-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
    // Channels with streams, not NSFW, not blocked. BBC gets one playable and one not; failingId gets only "not"; unknownId stays unprobed.
    const others = (db.prepare(
      "SELECT id FROM channels WHERE has_stream = 1 AND is_nsfw = 0 AND blocked = 0 AND id != ? AND id IN (SELECT channel FROM streams GROUP BY channel HAVING COUNT(*) >= 2) ORDER BY id LIMIT 2",
    ).all(BBC) as Array<{ id: string }>).map((r) => r.id);
    [failingId, unknownId] = others;
    setBrowser(BBC, [1, 0]);
    setBrowser(failingId, [0, 0]);
    setBrowser(unknownId, []);
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("summary: true when a stream is browser-playable, false when probed and none is, null when unprobed", async () => {
    const body = await items(`favorites=${BBC},${failingId},${unknownId}`);
    const by = (id: string) => body.items.find((i) => i.id === id)!;
    assert.equal(by(BBC).browserPlayable, true);
    assert.equal(by(failingId).browserPlayable, false);
    assert.equal(by(unknownId).browserPlayable, null);
  });

  test("detail: each stream is true, false or null from browser_ok", async () => {
    const detail = json<{ streams: Array<{ index: number; browserPlayable: boolean | null }> }>(await get(`/api/channels/${BBC}`));
    const values = detail.streams.map((s) => s.browserPlayable);
    assert.deepEqual(values.slice(0, 2), [true, false]);
    assert.ok(detail.streams.slice(2).every((s) => s.browserPlayable === null));
  });

  test("playable=browser keeps only channels with browserPlayable true", async () => {
    const body = await items("playable=browser");
    assert.ok(body.items.some((i) => i.id === BBC));
    assert.ok(body.items.every((i) => i.browserPlayable === true));
    assert.ok(!body.items.some((i) => i.id === failingId || i.id === unknownId));
  });

  test("playable=app keeps channels with streams that are not browser-playable, unknown included", async () => {
    const body = await items("playable=app");
    const ids = body.items.map((i) => i.id);
    assert.ok(ids.includes(failingId), "probed, none playable");
    assert.ok(ids.includes(unknownId), "unknown counts as app");
    assert.ok(!ids.includes(BBC));
    assert.ok(body.items.every((i) => i.browserPlayable !== true));
  });

  test("browser and app partition the channels that have streams", async () => {
    const all = await items("playable=any");
    const browser = await items("playable=browser");
    const app = await items("playable=app");
    assert.equal(browser.total + app.total, all.total);
  });

  test("playable=any, and an absent playable, are the same list", async () => {
    const any = await items("playable=any&q=news");
    const none = await items("q=news");
    assert.equal(any.total, none.total);
  });

  test("an unknown playable value is a 400", async () => {
    const res = await get("/api/channels?playable=tv");
    assert.equal(res.statusCode, 400);
    assert.match(json(res).error, /playable must be browser, app or any/);
  });
});
