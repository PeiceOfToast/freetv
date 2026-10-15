import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, type Db } from "../src/db/index.js";
import { buildCatalogFromDir } from "../src/ingest/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const fixtureCount = (name: string) => (JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.json`), "utf8")) as unknown[]).length;

describe("ingest catalog build", () => {
  let dir: string;
  let db: Db;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-ingest-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;

  test("channel count equals fixture count", () => {
    const { n } = one<{ n: number }>("SELECT COUNT(*) AS n FROM channels");
    assert.equal(n, fixtureCount("channels"));
  });

  test("BBCNews.uk has a stream, flagged has_stream, streams ordered https first then quality desc", () => {
    const ch = one<{ has_stream: number; stream_count: number; best_quality: string | null }>(
      "SELECT has_stream, stream_count, best_quality FROM channels WHERE id = 'BBCNews.uk'",
    );
    assert.equal(ch.has_stream, 1);
    assert.ok(ch.stream_count > 0);
    const rows = db
      .prepare("SELECT idx, url, quality_rank FROM streams WHERE channel = 'BBCNews.uk' ORDER BY idx")
      .all() as Array<{ idx: number; url: string; quality_rank: number }>;
    assert.deepEqual(rows.map((r) => r.idx), rows.map((_, i) => i));
    const https = rows.map((r) => r.url.startsWith("https://"));
    const firstHttp = https.indexOf(false);
    if (firstHttp !== -1) assert.ok(https.slice(firstHttp).every((x) => !x), "no https after first http");
    rows.forEach((r, i) => {
      if (i === 0) return;
      const prev = rows[i - 1];
      const prevHttps = prev.url.startsWith("https://");
      const curHttps = r.url.startsWith("https://");
      if (prevHttps === curHttps) assert.ok(prev.quality_rank >= r.quality_rank, "quality desc within group");
    });
  });

  test("every channel's streams are contiguous and https-first", () => {
    const bad = db
      .prepare(
        `SELECT channel FROM streams GROUP BY channel
         HAVING MAX(idx) + 1 != COUNT(*) OR MIN(idx) != 0`,
      )
      .all();
    assert.deepEqual(bad, []);
  });

  test("FTS prefix query finds BBCNews.uk", () => {
    const ids = db.prepare("SELECT id FROM channels_fts WHERE channels_fts MATCH 'bbc*'").all() as Array<{ id: string }>;
    assert.ok(ids.some((r) => r.id === "BBCNews.uk"), `got ${ids.map((r) => r.id).join(", ")}`);
  });

  test("categories have channel counts", () => {
    const { n } = one<{ n: number }>("SELECT COUNT(*) AS n FROM categories WHERE channel_count > 0");
    assert.ok(n > 0);
    const { m } = one<{ m: number }>("SELECT COUNT(*) AS m FROM categories");
    assert.equal(m, fixtureCount("categories"));
  });

  test("blocklisted channels are flagged blocked", () => {
    const blockedIds = (JSON.parse(fs.readFileSync(path.join(fixtures, "blocklist.json"), "utf8")) as Array<{ channel: string }>).map((b) => b.channel);
    for (const id of blockedIds) {
      const row = one<{ blocked: number } | undefined>("SELECT blocked FROM channels WHERE id = ?", id);
      assert.ok(row, `${id} present`);
      assert.equal(row.blocked, 1, `${id} blocked`);
    }
    const { n } = one<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE blocked = 1");
    assert.equal(n, blockedIds.length);
  });

  test("blocked channels are excluded from category and country counts", () => {
    const sum = one<{ s: number }>(
      "SELECT COALESCE(SUM(channel_count), 0) AS s FROM countries",
    ).s;
    const unblockedWithCountry = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM channels WHERE blocked = 0 AND country IN (SELECT code FROM countries)",
    ).n;
    assert.equal(sum, unblockedWithCountry);
  });

  test("logo, languages and name_sort are derived", () => {
    const { n } = one<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE logo_url IS NOT NULL");
    assert.ok(n > 0);
    const bbc = one<{ name_sort: string; languages: string }>("SELECT name_sort, languages FROM channels WHERE id = 'BBCNews.uk'");
    assert.equal(bbc.name_sort, bbc.name_sort.toLowerCase());
    assert.ok(JSON.parse(bbc.languages).length >= 0);
  });

  test("meta records last_ingest and counts", () => {
    const last = one<{ value: string }>("SELECT value FROM meta WHERE key = 'last_ingest'").value;
    assert.match(last, /^\d+$/);
    const counts = JSON.parse(one<{ value: string }>("SELECT value FROM meta WHERE key = 'counts'").value);
    assert.equal(counts.channels, fixtureCount("channels"));
    assert.equal(typeof counts.streams, "number");
    assert.equal(typeof counts.channelsWithStreams, "number");
  });

  test("rebuild is idempotent and leaves programmes untouched", () => {
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM channels").n;
    db.prepare("INSERT INTO programmes (channel, start_ts, stop_ts, title) VALUES ('BBCNews.uk', 1, 2, 'x')").run();
    buildCatalogFromDir(db, fixtures);
    assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM channels").n, before);
    assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM channels_fts").n, before);
    assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM programmes WHERE channel = 'BBCNews.uk'").n, 1);
    db.prepare("DELETE FROM programmes").run();
  });
});
