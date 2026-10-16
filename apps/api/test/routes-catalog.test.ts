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
import { resetMetaCache } from "../src/routes/catalog.js";
import { qualityRank } from "../src/lib/quality.js";
import { makeProxyUrl } from "../src/lib/sign.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const fixtureCount = (name: string) => (JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.json`), "utf8")) as unknown[]).length;

config.logLevel = "silent";
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.proxyPublicPath = "/proxy";
config.hideNsfwDefault = true;

describe("catalog routes", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;

  const get = (url: string) => app.inject({ method: "GET", url });
  const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;
  const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
  const ids = (body: { items: Array<{ id: string }> }) => body.items.map((i) => i.id);

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-routes-catalog-"));
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

  describe("GET /api/meta", () => {
    test("reports catalog counts from the ingest meta and live programme count", async () => {
      const res = await get("/api/meta");
      assert.equal(res.statusCode, 200);
      const m = json(res);
      assert.equal(m.channels, fixtureCount("channels"));
      assert.equal(m.channelsWithStreams, one<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE has_stream = 1").n);
      assert.equal(m.streams, one<{ n: number }>("SELECT COUNT(*) AS n FROM streams").n);
      assert.equal(m.programmes, 0);
      assert.equal(typeof m.lastIngest, "number");
      assert.equal(m.lastEpgImport, null);
      assert.equal(m.proxyEnabled, true);
      assert.equal(m.hideNsfwDefault, true);
      assert.equal(typeof m.version, "string");
    });

    test("is cacheable for 60 seconds", async () => {
      const res = await get("/api/meta");
      assert.equal(res.headers["cache-control"], "public, max-age=60");
    });

    test("reuses the computed body for 15 seconds, then reads the database again", async (t) => {
      resetMetaCache();
      let now = 1_000_000;
      t.mock.method(Date, "now", () => now);
      const ins = db.prepare("INSERT INTO programmes (channel, start_ts, stop_ts, title) VALUES ('BBCNews.uk', 1, 2, 'cache probe')");
      const before = json(await get("/api/meta")).programmes;
      ins.run();
      try {
        now += 14_000;
        assert.equal(json(await get("/api/meta")).programmes, before, "still inside the 15 s window");
        now += 1_000;
        assert.equal(json(await get("/api/meta")).programmes, before + 1, "window expired, fresh count");
      } finally {
        db.prepare("DELETE FROM programmes WHERE title = 'cache probe'").run();
        resetMetaCache();
      }
    });
  });

  describe("reference lists", () => {
    test("categories only include entries with channels, sorted by name", async () => {
      const list = json<Array<{ id: string; name: string; channelCount: number }>>(await get("/api/categories"));
      assert.ok(list.length > 0);
      assert.ok(list.every((c) => c.channelCount > 0));
      const names = list.map((c) => c.name.toLowerCase());
      assert.deepEqual(names, [...names].sort());
      const news = list.find((c) => c.id === "news");
      assert.ok(news, "news category present");
      assert.equal(news.channelCount, one<{ n: number }>("SELECT channel_count AS n FROM categories WHERE id = 'news'").n);
    });

    test("withStreams counts only channels that have a stream", async () => {
      const all = json<Array<{ id: string; channelCount: number }>>(await get("/api/categories"));
      const withS = json<Array<{ id: string; channelCount: number }>>(await get("/api/categories?withStreams=true"));
      assert.ok(withS.every((c) => c.channelCount > 0));
      for (const c of withS) {
        const a = all.find((x) => x.id === c.id);
        assert.ok(!a || a.channelCount >= c.channelCount);
      }
    });

    test("countries and languages have the contract shape and sorted names", async () => {
      const countries = json<Array<{ code: string; name: string; flag: string | null; channelCount: number }>>(
        await get("/api/countries"),
      );
      assert.ok(countries.length > 0);
      assert.ok(countries.every((c) => c.channelCount > 0 && typeof c.code === "string"));
      const names = countries.map((c) => c.name.toLowerCase());
      assert.deepEqual(names, [...names].sort());

      const languages = json<Array<{ code: string; name: string; channelCount: number }>>(await get("/api/languages"));
      assert.ok(languages.every((l) => l.channelCount > 0));
      assert.ok(languages.some((l) => l.code === "eng"));
    });
  });

  describe("GET /api/channels", () => {
    test("defaults to channels with streams and hides NSFW and blocked", async () => {
      const body = json(await get("/api/channels?limit=200"));
      const expected = one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM channels WHERE has_stream = 1 AND is_nsfw = 0 AND blocked = 0",
      ).n;
      assert.equal(body.total, expected);
      assert.equal(body.page, 1);
      assert.equal(body.limit, 200);
      for (const item of body.items) {
        assert.ok(item.streamCount > 0);
        assert.equal(item.isNsfw, false);
      }
    });

    test("summary items have exactly the contract keys", async () => {
      const body = json(await get("/api/channels?favorites=BBCNews.uk"));
      const item = body.items.find((i: { id: string }) => i.id === "BBCNews.uk");
      assert.ok(item, "BBCNews.uk found");
      assert.deepEqual(Object.keys(item).sort(), [
        "bestQuality", "categories", "country", "countryName", "flag", "hasGuide", "id", "isNsfw", "languages",
        "logo", "name", "network", "number", "online", "streamCount",
      ]);
      assert.equal(item.country, "UK");
      assert.equal(item.countryName, "United Kingdom");
      assert.deepEqual(item.categories, ["news"]);
      assert.equal(item.hasGuide, true);
      assert.equal(item.online, null);
      assert.equal(item.now, undefined, "now only with withNow");
    });

    test("q does prefix matching and survives FTS syntax characters", async () => {
      const bbc = json(await get("/api/channels?q=bbc&limit=200"));
      assert.ok(bbc.total > 0);
      assert.ok(ids(bbc).includes("BBCNews.uk"));
      const phrase = json(await get("/api/channels?q=BBC%20News&limit=5"));
      assert.equal(phrase.items[0].id, "BBCNews.uk", "relevance puts the exact phrase first");
      const hostile = await get("/api/channels?q=" + encodeURIComponent('"AND OR NEAR( * -'));
      assert.equal(hostile.statusCode, 200);
    });

    test("q is ANDed across tokens", async () => {
      const body = json(await get("/api/channels?q=bbc%20zzzqqq&limit=200"));
      assert.equal(body.total, 0);
    });

    test("category and country are OR within a filter and AND across filters", async () => {
      const body = json(await get("/api/channels?category=news,sports&country=US,UK&limit=200"));
      for (const item of body.items) {
        assert.ok(item.categories.some((c: string) => c === "news" || c === "sports"), item.id);
        assert.ok(["US", "UK"].includes(item.country), item.id);
      }
      const ukNews = one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM channels c WHERE c.has_stream = 1 AND c.is_nsfw = 0 AND c.blocked = 0 AND c.country = 'UK'
         AND c.id IN (SELECT channel FROM channel_categories WHERE category = 'news')`,
      ).n;
      const onlyUkNews = json(await get("/api/channels?category=news&country=UK&limit=200"));
      assert.equal(onlyUkNews.total, ukNews);
    });

    test("language filter uses the join table", async () => {
      const body = json(await get("/api/channels?language=eng&limit=200"));
      assert.ok(body.total > 0);
      for (const item of body.items) assert.ok(item.languages.includes("eng"), item.id);
    });

    test("hasStream=false includes channels without streams", async () => {
      const body = json(await get("/api/channels?hasStream=false&limit=1"));
      const expected = one<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE is_nsfw = 0 AND blocked = 0").n;
      assert.equal(body.total, expected);
    });

    test("nsfw=true includes NSFW/blocked channels that have streams", async () => {
      const hidden = one<{ id: string }>(
        "SELECT id FROM channels WHERE is_nsfw = 1 AND has_stream = 1 LIMIT 1",
      );
      if (!hidden) return; // fixture has no NSFW channel with streams
      const def = json(await get(`/api/channels?favorites=${encodeURIComponent(hidden.id)}`));
      assert.ok(!ids(def).includes(hidden.id));
      const all = json(await get(`/api/channels?favorites=${encodeURIComponent(hidden.id)}&nsfw=true`));
      assert.ok(ids(all).includes(hidden.id));
    });

    test("quality is a minimum rank over best_quality", async () => {
      const body = json(await get("/api/channels?quality=1080p&limit=200"));
      assert.ok(body.total > 0);
      for (const item of body.items) assert.ok(qualityRank(item.bestQuality) >= 3, `${item.id} ${item.bestQuality}`);
      const sd = json(await get("/api/channels?quality=sd&limit=200"));
      assert.ok(sd.total >= body.total);
    });

    test("favorites restricts to the given ids", async () => {
      const body = json(await get("/api/channels?favorites=BBCNews.uk,NoSuchChannel.xx"));
      assert.deepEqual(ids(body), ["BBCNews.uk"]);
      const empty = json(await get("/api/channels?favorites="));
      assert.equal(empty.total, 0);
    });

    test("sort=name orders by name_sort then id", async () => {
      const body = json(await get("/api/channels?sort=name&limit=50"));
      const expected = (db.prepare(
        "SELECT id FROM channels WHERE has_stream = 1 AND is_nsfw = 0 AND blocked = 0 ORDER BY name_sort, id LIMIT 50",
      ).all() as Array<{ id: string }>).map((r) => r.id);
      assert.deepEqual(ids(body), expected);
    });

    test("sort=streams defaults to descending", async () => {
      const body = json(await get("/api/channels?sort=streams&limit=200"));
      const counts = body.items.map((i: { streamCount: number }) => i.streamCount);
      assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
      const asc = json(await get("/api/channels?sort=streams&order=asc&limit=200"));
      const ascCounts = asc.items.map((i: { streamCount: number }) => i.streamCount);
      assert.deepEqual(ascCounts, [...ascCounts].sort((a, b) => a - b));
    });

    test("sort=quality defaults to descending by rank", async () => {
      const body = json(await get("/api/channels?sort=quality&limit=200"));
      const ranks = body.items.map((i: { bestQuality: string | null }) => qualityRank(i.bestQuality));
      assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
    });

    test("sort=updated orders by channels.last_checked (NULL counts as 0), newest first", async () => {
      const [a, b] = (db.prepare(
        "SELECT id FROM channels WHERE has_stream = 1 AND is_nsfw = 0 AND blocked = 0 ORDER BY name_sort, id LIMIT 2",
      ).all() as Array<{ id: string }>).map((r) => r.id);
      const saved = db.prepare("SELECT id, last_checked FROM channels WHERE id IN (?, ?)").all(a, b) as Array<{ id: string; last_checked: number | null }>;
      try {
        db.prepare("UPDATE channels SET last_checked = NULL").run();
        db.prepare("UPDATE channels SET last_checked = 1000 WHERE id = ?").run(a);
        db.prepare("UPDATE channels SET last_checked = 2000 WHERE id = ?").run(b);
        const body = json(await get("/api/channels?sort=updated&limit=200"));
        const got = ids(body);
        assert.ok(got.indexOf(b) < got.indexOf(a), "newer channel first by default");
        assert.equal(got[0], b);
        // Ascending puts the NULL (0) channels first, so walk pages until both are seen.
        const pos = new Map<string, number>();
        for (let page = 1; page < 500 && !(pos.has(a) && pos.has(b)); page++) {
          const items = ids(json(await get(`/api/channels?sort=updated&order=asc&limit=200&page=${page}`)));
          if (items.length === 0) break;
          items.forEach((id, i) => pos.set(id, page * 1000 + i));
        }
        assert.ok(pos.has(a) && pos.has(b), "both channels reachable in ascending order");
        assert.ok(pos.get(a)! < pos.get(b)!, "oldest first when order=asc");
        const nulls = got.slice(got.indexOf(a) + 1);
        assert.ok(nulls.length > 0, "channels never checked sort after the checked ones");
      } finally {
        const restore = db.prepare("UPDATE channels SET last_checked = ? WHERE id = ?");
        for (const r of saved) restore.run(r.last_checked, r.id);
      }
    });

    test("sort=relevance without q falls back to name", async () => {
      const a = json(await get("/api/channels?sort=relevance&limit=20"));
      const b = json(await get("/api/channels?sort=name&limit=20"));
      assert.deepEqual(ids(a), ids(b));
    });

    test("paging returns consecutive slices with a stable total", async () => {
      const p1 = json(await get("/api/channels?sort=name&limit=5&page=1"));
      const p2 = json(await get("/api/channels?sort=name&limit=5&page=2"));
      const big = json(await get("/api/channels?sort=name&limit=10&page=1"));
      assert.equal(p1.total, p2.total);
      assert.deepEqual([...ids(p1), ...ids(p2)], ids(big));
      const beyond = json(await get("/api/channels?limit=5&page=999999"));
      assert.deepEqual(beyond.items, []);
    });

    test("limit above 200 is clamped and reported", async () => {
      const body = json(await get("/api/channels?limit=500"));
      assert.equal(body.limit, 200);
      assert.ok(body.items.length <= 200);
    });

    test("garbage parameters are 400 with an error body and no cache header", async () => {
      const cases = [
        "/api/channels?page=0",
        "/api/channels?page=abc",
        "/api/channels?page=99999999999999999999",
        "/api/channels?limit=x",
        "/api/channels?withNow=maybe",
        "/api/channels?nsfw=yes",
        "/api/channels?sort=popularity",
        "/api/channels?order=up",
        "/api/channels?quality=8k",
        "/api/channels?favorites=" + Array.from({ length: 501 }, (_, i) => `c${i}`).join(","),
        "/api/categories?withStreams=perhaps",
      ];
      for (const url of cases) {
        const res = await get(url);
        assert.equal(res.statusCode, 400, url);
        assert.equal(typeof json(res).error, "string", url);
        assert.equal(res.headers["cache-control"], undefined, url);
      }
    });

    test("is cacheable for 60 seconds on success", async () => {
      assert.equal((await get("/api/channels")).headers["cache-control"], "public, max-age=60");
    });
  });

  describe("GET /api/channels/:id", () => {
    test("returns ChannelDetail with ordered streams, resolved names and signed proxy URLs", async () => {
      const res = await get("/api/channels/BBCNews.uk");
      assert.equal(res.statusCode, 200);
      const ch = json(res);
      assert.equal(ch.id, "BBCNews.uk");
      assert.deepEqual(ch.categories, [{ id: "news", name: "News" }]);
      assert.ok(ch.languages.some((l: { code: string; name: string }) => l.code === "eng" && l.name === "English"));
      assert.equal(ch.countryName, "United Kingdom");
      assert.ok(Array.isArray(ch.guides) && ch.guides.length > 0);
      assert.deepEqual(Object.keys(ch.guides[0]).sort(), ["lang", "site", "siteId"]);

      const expectedStreams = one<{ n: number }>("SELECT COUNT(*) AS n FROM streams WHERE channel = 'BBCNews.uk'").n;
      assert.equal(ch.streams.length, expectedStreams);
      ch.streams.forEach((s: { index: number }, i: number) => assert.equal(s.index, i));

      const first = ch.streams[0];
      // Relay URLs carry an expiry (review 2.2): decode it, check it is ~now + 24 h, then recompute the signature.
      const payloadB64 = String(first.proxyUrl).split("/").pop()!;
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { u: string; exp: number };
      assert.equal(payload.u, first.url);
      const nowS = Math.floor(Date.now() / 1000);
      assert.ok(payload.exp >= nowS + 86400 - 60 && payload.exp <= nowS + 86400 + 60, `exp ${payload.exp} ~ now+24h`);
      const expectedProxy = makeProxyUrl("test-secret", "/proxy", first.url, first.userAgent, first.referrer, payload.exp);
      assert.equal(first.proxyUrl, expectedProxy);
      assert.equal(first.online, null);
      assert.equal(first.lastChecked, null);
    });

    test("proxyUrl is omitted when the proxy is disabled", async () => {
      config.proxyEnabled = false;
      try {
        const ch = json(await get("/api/channels/BBCNews.uk"));
        assert.ok(ch.streams.length > 0);
        for (const s of ch.streams) assert.equal("proxyUrl" in s, false);
        resetMetaCache(); // /api/meta is cached for 15 s; this test changes config under it
        const meta = json(await get("/api/meta"));
        assert.equal(meta.proxyEnabled, false);
      } finally {
        config.proxyEnabled = true;
      }
    });

    test("unknown id is 404 with an error body", async () => {
      const res = await get("/api/channels/Definitely.Not.Here");
      assert.equal(res.statusCode, 404);
      assert.equal(json(res).error, "channel not found");
    });

    test("now and next come from programmes", async () => {
      const now = Math.floor(Date.now() / 1000);
      const ins = db.prepare(
        "INSERT INTO programmes (channel, start_ts, stop_ts, title, description, category, icon) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      ins.run("BBCNews.uk", now - 600, now + 600, "Newsday", "The day's news", "News", null);
      ins.run("BBCNews.uk", now + 600, now + 1800, "Weather", null, null, null);
      ins.run("BBCNews.uk", now + 1800, now + 3600, "Sport", null, null, null);

      const ch = json(await get("/api/channels/BBCNews.uk"));
      assert.equal(ch.now.title, "Newsday");
      assert.equal(ch.now.start, now - 600);
      assert.equal(ch.now.stop, now + 600);
      assert.equal(ch.now.description, "The day's news");
      assert.deepEqual(ch.next, { title: "Weather", start: now + 600, stop: now + 1800 });
    });

    test("next is the first programme starting after now when nothing is on", async () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("DELETE FROM programmes WHERE channel = 'BBCNews.uk'").run();
      db.prepare("INSERT INTO programmes (channel, start_ts, stop_ts, title) VALUES ('BBCNews.uk', ?, ?, 'Later')").run(now + 900, now + 1800);
      const ch = json(await get("/api/channels/BBCNews.uk"));
      assert.equal(ch.now, null);
      assert.deepEqual(ch.next, { title: "Later", start: now + 900, stop: now + 1800 });
      db.prepare("DELETE FROM programmes").run();
    });
  });

  describe("EPG and health fields in lists", () => {
    test("withNow adds the current programme per item and null when none", async () => {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("INSERT INTO programmes (channel, start_ts, stop_ts, title) VALUES ('BBCNews.uk', ?, ?, 'Live now')").run(now - 60, now + 60);
      const body = json(await get("/api/channels?favorites=BBCNews.uk,CNN.us&withNow=true"));
      const item = body.items.find((i: { id: string }) => i.id === "BBCNews.uk");
      assert.equal(item.now.title, "Live now");
      assert.equal(item.now.start, now - 60);
      assert.equal(item.now.stop, now + 60);
      const others = body.items.filter((i: { id: string }) => i.id !== "BBCNews.uk");
      assert.ok(others.every((i: { now: unknown }) => i.now === null));
      db.prepare("DELETE FROM programmes").run();
    });

    test("online=true is ignored until some stream has a health status", async () => {
      const plain = json(await get("/api/channels?limit=200"));
      const flagged = json(await get("/api/channels?online=true&limit=200"));
      assert.equal(flagged.total, plain.total);
    });

    test("with health data, online filter and online field reflect probe results", async () => {
      db.prepare("UPDATE streams SET status = 'online' WHERE channel = 'BBCNews.uk' AND idx = 0").run();
      db.prepare("UPDATE channels SET online_count = 1 WHERE id = 'BBCNews.uk'").run();
      const probedOff = db
        .prepare("SELECT channel FROM streams WHERE channel != 'BBCNews.uk' AND channel IN (SELECT id FROM channels WHERE has_stream = 1) LIMIT 1")
        .get() as { channel: string };
      db.prepare("UPDATE streams SET status = 'offline' WHERE channel = ?").run(probedOff.channel);

      const body = json(await get("/api/channels?online=true&limit=200"));
      assert.deepEqual(ids(body), ["BBCNews.uk"]);
      assert.equal(body.items[0].online, true);

      const detail = json(await get("/api/channels/BBCNews.uk"));
      assert.equal(detail.streams[0].online, true);
      assert.equal(typeof detail.streams[0].lastChecked === "number" || detail.streams[0].lastChecked === null, true);

      const offline = json(await get(`/api/channels?q=${encodeURIComponent(probedOff.channel)}&limit=5`));
      const offItem = offline.items.find((i: { id: string }) => i.id === probedOff.channel);
      if (offItem) assert.equal(offItem.online, false);
    });
  });
});
