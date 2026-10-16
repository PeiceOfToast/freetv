import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb, getDb, type Db } from "../src/db/index.js";
import { buildCatalogFromDir } from "../src/ingest/index.js";
import { buildServer } from "../src/server.js";
import { setMeta } from "../src/db/index.js";
import { loadExportChannels } from "../src/lib/export-query.js";
import { renderM3u } from "../src/lib/export-m3u.js";
import { makeProxyUrl, signPayload } from "../src/lib/sign.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

config.logLevel = "silent";
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.proxyPublicPath = "/proxy";
config.hideNsfwDefault = true;

interface Entry {
  id: string;
  attrs: Record<string, string>;
  name: string;
  vlc: string[];
  url: string;
}

/** Parses the playlist back into entries, asserting the basic line structure as it goes. */
function parseM3u(text: string): Entry[] {
  const lines = text.split("\n");
  assert.equal(lines.at(-1), "", "file ends with a newline");
  lines.pop();
  const out: Entry[] = [];
  let cur: { attrs: Record<string, string>; name: string; vlc: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      assert.equal(cur, null, "EXTINF must be followed by its URL before the next EXTINF");
      const m = /^#EXTINF:-1 (.*)",(.*)$/.exec(line);
      assert.ok(m, `malformed EXTINF: ${line}`);
      const attrs: Record<string, string> = {};
      // The capture stops before the closing quote of the last attribute; add it back.
      for (const a of (m[1] + '"').matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      cur = { attrs, name: m[2], vlc: [] };
    } else if (line.startsWith("#EXTVLCOPT:")) {
      assert.ok(cur, "EXTVLCOPT must follow an EXTINF");
      cur.vlc.push(line.slice("#EXTVLCOPT:".length));
    } else if (line.startsWith("#")) {
      continue;
    } else {
      assert.ok(cur, `URL without EXTINF: ${line}`);
      out.push({ id: cur.attrs["tvg-id"], attrs: cur.attrs, name: cur.name, vlc: cur.vlc, url: line });
      cur = null;
    }
  }
  assert.equal(cur, null, "dangling EXTINF at end of file");
  return out;
}

describe("GET /api/playlist.m3u", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
  const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
  const count = (sql: string, ...args: unknown[]) => one<{ n: number }>(sql, ...args).n;
  const SHOWN = "c.has_stream = 1 AND c.is_nsfw = 0 AND c.blocked = 0";

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-export-playlist-"));
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

  test("headers match the contract", async () => {
    const res = await get("/api/playlist.m3u");
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "audio/x-mpegurl; charset=utf-8");
    assert.equal(res.headers["content-disposition"], 'attachment; filename="freetv.m3u"');
    assert.equal(res.headers["cache-control"], "public, max-age=300");
    assert.match(res.body.split("\n")[0], /^#EXTM3U x-tvg-url="http:\/\/localhost:80\/api\/guide\.xml"$/);
  });

  test("one entry per channel with a stream, with metadata matching the catalog", async () => {
    const res = await get("/api/playlist.m3u");
    const entries = parseM3u(res.body);
    const expected = count(`SELECT COUNT(*) AS n FROM channels c WHERE ${SHOWN}`);
    assert.ok(expected > 0);
    assert.equal(entries.length, expected);
    assert.equal(new Set(entries.map((e) => e.id)).size, expected, "no channel appears twice");

    const categoryName = new Map(
      (db.prepare("SELECT id, name FROM categories").all() as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
    );
    const rows = db
      .prepare(`SELECT c.id, c.name, c.country, c.logo_url, c.categories, c.languages FROM channels c WHERE ${SHOWN}`)
      .all() as Array<{ id: string; name: string; country: string | null; logo_url: string | null; categories: string; languages: string }>;
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const r of rows) {
      const e = byId.get(r.id);
      assert.ok(e, `${r.id} present`);
      assert.equal(e.attrs["tvg-name"], r.name);
      assert.equal(e.name, r.name);
      assert.equal(e.attrs["tvg-logo"], r.logo_url ?? undefined);
      assert.equal(e.attrs["tvg-country"], r.country ?? undefined);
      const cats = JSON.parse(r.categories) as string[];
      assert.equal(e.attrs["group-title"], cats[0] ? (categoryName.get(cats[0]) ?? cats[0]) : "Other");
    }
    const bbc = byId.get("BBCNews.uk");
    assert.ok(bbc, "BBC News in default playlist");
    assert.equal(bbc.attrs["tvg-country"], "UK");
    assert.equal(bbc.attrs["group-title"], "News");
    assert.equal(bbc.attrs["tvg-language"], "English");
  });

  test("entries use the origin URL of the best stream by default", async () => {
    const entries = parseM3u((await get("/api/playlist.m3u")).body);
    const best = new Map(
      (db.prepare("SELECT channel, url FROM streams WHERE idx = 0").all() as Array<{ channel: string; url: string }>).map((s) => [
        s.channel,
        s.url,
      ]),
    );
    for (const e of entries) assert.equal(e.url, best.get(e.id), `${e.id} uses its first stream`);
  });

  test("country filter applies", async () => {
    const res = await get("/api/playlist.m3u?country=US");
    const entries = parseM3u(res.body);
    const expected = count(`SELECT COUNT(*) AS n FROM channels c WHERE ${SHOWN} AND c.country = 'US'`);
    assert.ok(expected > 0, "fixture has US channels");
    assert.equal(entries.length, expected);
    assert.ok(entries.every((e) => e.attrs["tvg-country"] === "US"));
  });

  test("category filter and the no-paging rule", async () => {
    const news = parseM3u((await get("/api/playlist.m3u?category=news&limit=2&page=3")).body);
    const newsIds = (
      db
        .prepare(`SELECT c.id FROM channels c WHERE ${SHOWN} AND c.id IN (SELECT channel FROM channel_categories WHERE category = 'news')`)
        .all() as Array<{ id: string }>
    ).map((r) => r.id);
    assert.ok(newsIds.length > 0);
    assert.equal(news.length, newsIds.length, "limit and page are ignored");
    assert.deepEqual(news.map((e) => e.id).sort(), [...newsIds].sort());
  });

  test("hasStream=false is ignored (always forced true)", async () => {
    const a = parseM3u((await get("/api/playlist.m3u")).body).length;
    const b = parseM3u((await get("/api/playlist.m3u?hasStream=false")).body).length;
    assert.equal(a, b);
  });

  test("streams=all emits one entry per stream", async () => {
    const res = await get("/api/playlist.m3u?streams=all");
    const entries = parseM3u(res.body);
    const expected = count(`SELECT COUNT(*) AS n FROM streams s JOIN channels c ON c.id = s.channel WHERE ${SHOWN}`);
    assert.equal(entries.length, expected);
  });

  test("streams must be best or all", async () => {
    const res = await get("/api/playlist.m3u?streams=some");
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /streams must be best or all/);
  });

  test("filter errors are 400 with the same messages as /api/channels", async () => {
    const res = await get("/api/playlist.m3u?quality=bogus");
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /quality must be one of/);
  });

  test("proxy=true rewrites every URL to an absolute relay URL under the base", async () => {
    const base = "https://tv.example.test";
    config.publicUrl = base;
    try {
      const entries = parseM3u((await get("/api/playlist.m3u?proxy=true")).body);
      assert.ok(entries.length > 0);
      const streams = new Map(
        (db.prepare("SELECT channel, url, user_agent, referrer FROM streams WHERE idx = 0").all() as Array<{
          channel: string;
          url: string;
          user_agent: string | null;
          referrer: string | null;
        }>).map((s) => [s.channel, s]),
      );
      for (const e of entries) {
        assert.ok(e.url.startsWith(`${base}/proxy/`), `${e.url} is relayed`);
        const s = streams.get(e.id)!;
        const [, , sig, payload] = e.url.slice(base.length).split("/").slice(0);
        assert.equal(sig, signPayload("test-secret", payload), "signed");
        const { exp, u, ua, r } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
          exp: number; u: string; ua?: string; r?: string;
        };
        assert.equal(u, s.url);
        assert.equal(ua, s.user_agent ?? undefined);
        assert.equal(r, s.referrer ?? undefined);
        assert.ok(exp > Math.floor(Date.now() / 1000), "relay URLs carry a future exp");
        assert.equal(e.url, `${base}${makeProxyUrl("test-secret", "/proxy", s.url, s.user_agent, s.referrer, exp)}`);
      }
    } finally {
      config.publicUrl = "";
    }
  });

  // Passes only once routes/export.ts forwards the exp that export-m3u computes (see the report).
  test("M3U relay URLs expire after PROXY_EXPORT_TTL_SECONDS (7 d), not the 24 h UI TTL", async () => {
    config.publicUrl = "https://tv.example.test";
    try {
      const entries = parseM3u((await get("/api/playlist.m3u?proxy=true&country=UK")).body);
      const payload = entries[0].url.split("/").pop() as string;
      const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number };
      const want = Math.floor(Date.now() / 1000) + config.proxyExportTtlSeconds;
      assert.ok(Math.abs(exp - want) <= 5, `exp ${exp} is about ${want}`);
    } finally {
      config.publicUrl = "";
    }
  });

  test("PUBLIC_URL sets the base for x-tvg-url and relay URLs, ignoring request headers", async () => {
    config.publicUrl = "https://tv.example.test/";
    try {
      const res = await get("/api/playlist.m3u?proxy=true&country=UK", { host: "other.test", "x-forwarded-proto": "http" });
      assert.match(res.body.split("\n")[0], /x-tvg-url="https:\/\/tv\.example\.test\/api\/guide\.xml"/);
      const entries = parseM3u(res.body);
      assert.ok(entries.length > 0);
      assert.ok(entries.every((e) => e.url.startsWith("https://tv.example.test/proxy/")));
    } finally {
      config.publicUrl = "";
    }
  });

  test("without PUBLIC_URL the base comes from x-forwarded-proto and x-forwarded-host", async () => {
    const res = await get("/api/playlist.m3u?proxy=true&country=UK", {
      host: "internal:3000",
      "x-forwarded-proto": "https,http",
      "x-forwarded-host": "tv.example.org, other",
    });
    assert.match(res.body.split("\n")[0], /x-tvg-url="https:\/\/tv\.example\.org\/api\/guide\.xml"/);
    assert.ok(parseM3u(res.body).every((e) => e.url.startsWith("https://tv.example.org/proxy/")));
  });

  test("proxy=true falls back to origin URLs when the proxy is off", async () => {
    const was = config.proxyEnabled;
    config.proxyEnabled = false;
    try {
      const entries = parseM3u((await get("/api/playlist.m3u?proxy=true&country=UK")).body);
      assert.ok(entries.length > 0);
      assert.ok(entries.every((e) => !e.url.includes("/proxy/")));
    } finally {
      config.proxyEnabled = was;
    }
  });

  test("EXTVLCOPT lines appear for streams that carry user agent or referrer", async () => {
    const entries = parseM3u((await get("/api/playlist.m3u")).body);
    const withUa = entries.find((e) => e.vlc.some((l) => l.startsWith("http-user-agent=")));
    assert.ok(withUa, "fixture has a stream with a user agent");
    const ref = entries.find((e) => e.vlc.some((l) => l.startsWith("http-referrer=")));
    assert.ok(ref, "fixture has a stream with a referrer");
    const plain = entries.find((e) => e.vlc.length === 0);
    assert.ok(plain, "some streams have neither");
    const row = db.prepare("SELECT user_agent, referrer FROM streams WHERE channel = ? AND idx = 0").get(withUa.id) as {
      user_agent: string | null;
      referrer: string | null;
    };
    assert.deepEqual(withUa.vlc.filter((l) => l.startsWith("http-user-agent=")), [`http-user-agent=${row.user_agent}`]);
    assert.equal(withUa.vlc.some((l) => l.startsWith("http-referrer=")), row.referrer !== null);
  });

  test("an empty result is still a valid playlist", async () => {
    const res = await get("/api/playlist.m3u?q=zzzqqqnomatch");
    assert.equal(res.statusCode, 200);
    assert.equal(parseM3u(res.body).length, 0);
    assert.equal(res.body.split("\n").length, 2, "header line and trailing newline only");
  });
});

describe("export rendering helpers", () => {
  test("quotes in attribute values become single quotes and newlines are flattened", () => {
    const text = renderM3u(
      [
        {
          id: 'X"Y',
          name: 'Say "hi"\nthere',
          country: null,
          logo: null,
          categories: [],
          languages: [],
          streams: [{ url: "http://a/b.m3u8", title: null, userAgent: 'UA "x"', referrer: null }],
        },
      ],
      { base: "http://h", proxy: false, streams: "best", proxyPathFor: () => undefined, truncated: false },
    );
    const lines = text.trimEnd().split("\n");
    assert.equal(lines[0], '#EXTM3U x-tvg-url="http://h/api/guide.xml"');
    assert.equal(lines[1], `#EXTINF:-1 tvg-id="X'Y" tvg-name="Say 'hi' there" group-title="Other",Say "hi" there`);
    assert.equal(lines[2], `#EXTVLCOPT:http-user-agent=UA "x"`);
    assert.equal(lines[3], "http://a/b.m3u8");
    assert.equal(lines.length, 4);
  });

  test("the cap is reported with a comment line, and loadExportChannels cuts at the cap", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-export-cap-"));
    try {
      const db = openDb(path.join(dir, "catalog.db"));
      buildCatalogFromDir(db, fixtures);
      const res = loadExportChannels(getDb(), {}, { hideNsfwDefault: true, cap: 3 });
      assert.equal(res.channels.length, 3);
      assert.equal(res.truncated, true);
      const text = renderM3u(res.channels, { base: "http://h", proxy: false, streams: "best", proxyPathFor: () => undefined, truncated: true });
      assert.match(text, /# list capped at 20000 channels/);
      const full = loadExportChannels(getDb(), {}, { hideNsfwDefault: true });
      assert.equal(full.truncated, false);
      assert.ok(full.channels.length > 3);
    } finally {
      closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GET /api/playlist.m3u memo", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-export-memo-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);
    config.publicUrl = "";
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a repeat request within 60 s returns the memoised body, until meta.last_ingest changes", async () => {
    const url = "/api/playlist.m3u?streams=all";
    const first = await app.inject({ method: "GET", url });
    const id = (db.prepare("SELECT id FROM channels WHERE has_stream = 1 AND blocked = 0 AND is_nsfw = 0 ORDER BY id LIMIT 1").get() as { id: string }).id;
    db.prepare("UPDATE channels SET name = name || ' memo-marker' WHERE id = ?").run(id);

    const second = await app.inject({ method: "GET", url });
    assert.equal(second.body, first.body, "served from the memo, not re-rendered");

    setMeta("last_ingest", "1900000000");
    const third = await app.inject({ method: "GET", url });
    assert.notEqual(third.body, first.body, "a new ingest invalidates the memo");
    assert.match(third.body, /memo-marker/);
  });

  test("parameter order is normalised: the same query in another order shares one memo entry", async () => {
    const a = await app.inject({ method: "GET", url: "/api/playlist.m3u?streams=all&proxy=false" });
    const b = await app.inject({ method: "GET", url: "/api/playlist.m3u?proxy=false&streams=all" });
    assert.equal(b.body, a.body);
  });

  test("the memo stays bounded and correct past its 50-entry limit", async () => {
    for (let i = 0; i < 60; i++) {
      const r = await app.inject({ method: "GET", url: `/api/playlist.m3u?streams=best&n=${i}` });
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /^#EXTM3U /);
    }
  });
});
