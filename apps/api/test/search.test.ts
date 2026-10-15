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
import { sanitizeFts } from "../src/lib/channel-query.js";
import { EMPTY_ALIASES, aliasIndexFor } from "../src/lib/search-aliases.js";
import { parseQuery } from "../src/lib/search-parse.js";
import { suggest } from "../src/lib/search-suggest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

config.logLevel = "silent";
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.proxyPublicPath = "/proxy";
config.hideNsfwDefault = true;

interface Item {
  id: string;
  name: string;
  country: string | null;
  categories: string[];
  languages: string[];
  bestQuality: string | null;
}

describe("search parser (no database)", () => {
  test("sanitizeFts never returns FTS syntax for punctuation-only input", () => {
    for (const q of ["", "   ", "-", "***", '""', "()", "\"", "^", "+", "::"]) {
      assert.equal(sanitizeFts(q), null, JSON.stringify(q));
    }
  });

  test("tokens are quoted and only the last one is a prefix", () => {
    assert.equal(sanitizeFts("bbc news"), '"bbc" AND "news"*');
  });

  test("FTS keywords and operators are quoted, not interpreted", () => {
    // "and" is a stopword here, so it is dropped; the rest are quoted lowercase phrases.
    assert.equal(sanitizeFts("NEAR AND OR NOT bbc"), '"near" AND "or" AND "not" AND "bbc"*');
  });

  test("letter/digit tokens also match the split form (BBC1 -> BBC 1)", () => {
    const p = parseQuery("BBC1", EMPTY_ALIASES);
    assert.equal(p.match, '("bbc1"* OR "bbc 1"*)');
    assert.equal(p.nameText, "bbc 1");
  });

  test("diacritics are folded so the text form matches", () => {
    assert.equal(parseQuery("Télé", EMPTY_ALIASES).match, '"tele"*');
  });

  test("stopwords are dropped when other words remain", () => {
    const p = parseQuery("the bbc", EMPTY_ALIASES);
    assert.equal(p.match, '"bbc"*');
    assert.equal(p.nameText, "bbc");
    assert.equal(parseQuery("the", EMPTY_ALIASES).match, '"the"*');
  });

  test("quality words become a filter, not text", () => {
    assert.deepEqual(parseQuery("4k sports", EMPTY_ALIASES), {
      match: '"sports"*',
      nameText: "sports",
      categories: [],
      quality: "2160p",
    });
    assert.equal(parseQuery("hd", EMPTY_ALIASES).quality, "720p");
  });

  test("the longest quality word in the query wins", () => {
    assert.equal(parseQuery("hd 4k", EMPTY_ALIASES).quality, "2160p");
  });
});

describe("search (fixture catalog)", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-search-"));
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

  const get = (url: string) => app.inject({ method: "GET", url });
  const search = async (q: string, extra = ""): Promise<{ status: number; total: number; items: Item[] }> => {
    const res = await get(`/api/channels?q=${encodeURIComponent(q)}&limit=200${extra}`);
    assert.equal(res.statusCode, 200, `status for q=${JSON.stringify(q)}: ${res.body}`);
    const body = JSON.parse(res.body);
    return { status: res.statusCode, total: body.total, items: body.items };
  };
  const sqlIds = (sql: string) => (db.prepare(sql).all() as Array<{ id: string }>).map((r) => r.id);
  const ALIVE = "c.has_stream = 1 AND c.is_nsfw = 0 AND c.blocked = 0";

  describe("ranking", () => {
    test("name matches come before channels that only match elsewhere", async () => {
      const { items } = await search("bbc");
      assert.ok(items.length > 1);
      const startsWith = items.map((i) => i.name.toLowerCase().startsWith("bbc"));
      const firstOther = startsWith.indexOf(false);
      if (firstOther !== -1) {
        assert.ok(startsWith.slice(firstOther).every((v) => !v), "every BBC-named channel precedes the rest");
      }
      assert.equal(items[0]?.name.toLowerCase().startsWith("bbc"), true);
    });

    test("an exact name match is first", async () => {
      const { items } = await search("BBC News");
      assert.equal(items[0]?.id, "BBCNews.uk");
    });

    test("query text is matched after accent folding", async () => {
      const a = (await search("télé")).items.map((i) => i.id);
      const b = (await search("tele")).items.map((i) => i.id);
      assert.ok(a.length > 0);
      assert.deepEqual(a, b);
    });

    test("sort=name with q still sorts by name", async () => {
      const { items } = await search("bbc", "&sort=name");
      const names = items.map((i) => i.name.toLowerCase());
      assert.deepEqual(names, [...names].sort());
    });
  });

  describe("aliases and filters", () => {
    test("a country name matches every channel with that country code", async () => {
      const expected = sqlIds(`SELECT c.id FROM channels c WHERE c.country = 'DE' AND ${ALIVE}`);
      assert.ok(expected.length > 0, "fixture has German channels");
      const { items } = await search("germany");
      const got = new Set(items.map((i) => i.id));
      for (const id of expected) assert.ok(got.has(id), `${id} should match "germany"`);
    });

    test("a demonym matches the country too", async () => {
      const expected = sqlIds(`SELECT c.id FROM channels c WHERE c.country = 'DE' AND ${ALIVE}`);
      const got = new Set((await search("german")).items.map((i) => i.id));
      for (const id of expected) assert.ok(got.has(id), `${id} should match "german"`);
    });

    test("an uppercase country code matches that country", async () => {
      const expected = sqlIds(`SELECT c.id FROM channels c WHERE c.country = 'DE' AND ${ALIVE}`);
      const got = new Set((await search("DE")).items.map((i) => i.id));
      for (const id of expected) assert.ok(got.has(id), `${id} should match "DE"`);
    });

    test("a two-letter code matches the whole token, not a prefix", async () => {
      const { items } = await search("DE");
      assert.ok(items.length > 0);
      const hasToken = db.prepare(`SELECT 1 FROM channels_fts WHERE channels_fts MATCH '"de"' AND id = ?`);
      for (const item of items) {
        assert.ok(item.country === "DE" || hasToken.get(item.id), `${item.id} (${item.name}) is German or has the token "de"`);
      }
    });

    test("spanish news lists news channels with Spanish as a language", async () => {
      const expected = sqlIds(
        `SELECT c.id FROM channels c
         JOIN channel_languages l ON l.channel = c.id AND l.language = 'spa'
         JOIN channel_categories k ON k.channel = c.id AND k.category = 'news'
         WHERE ${ALIVE}`,
      );
      assert.ok(expected.length > 0, "fixture has Spanish news channels");
      const { items } = await search("spanish news");
      const got = new Set(items.map((i) => i.id));
      for (const id of expected) assert.ok(got.has(id), `${id} should match "spanish news"`);
      for (const item of items) {
        assert.ok(item.categories.includes("news"), `${item.id} is in the news category`);
        assert.ok(item.languages.includes("spa") || /spanish/i.test(item.name), `${item.id} is Spanish`);
      }
    });

    test("a single two-letter language code expands to the language", async () => {
      const expected = sqlIds(
        `SELECT c.id FROM channels c JOIN channel_languages l ON l.channel = c.id AND l.language = 'spa' WHERE ${ALIVE}`,
      );
      const got = new Set((await search("es")).items.map((i) => i.id));
      for (const id of expected) assert.ok(got.has(id), `${id} should match "es"`);
    });

    test("a category word alone lists that category", async () => {
      const expected = sqlIds(
        `SELECT c.id FROM channels c JOIN channel_categories k ON k.channel = c.id AND k.category = 'news' WHERE ${ALIVE}`,
      );
      const { items, total } = await search("news");
      assert.equal(total, expected.length);
      assert.ok(items.every((i) => i.categories.includes("news")));
    });

    test("a category synonym maps to the category id", async () => {
      const { items } = await search("sport");
      assert.ok(items.length > 0);
      assert.ok(items.every((i) => i.categories.includes("sports")));
    });

    test("a category word with other words filters, then searches the rest", async () => {
      const { items } = await search("news cnn");
      assert.ok(items.every((i) => i.categories.includes("news")));
    });

    test("quality or category words alone work with the default relevance sort", async () => {
      for (const q of ["4k", "hd", "1080p", "news", "4k news"]) {
        const { items } = await search(q);
        assert.ok(Array.isArray(items), q);
      }
    });

    test("a quality word filters by quality", async () => {
      const { items } = await search("4k");
      assert.ok(items.every((i) => i.bestQuality === "2160p"));
    });

    test("hd keeps 720p and above", async () => {
      const { items } = await search("hd");
      const height = (q: string | null) => (q ? Number(/^(\d+)/.exec(q)?.[1] ?? 0) : 0);
      assert.ok(items.every((i) => height(i.bestQuality) >= 720));
    });

    test("the quality param and a quality word combine, stricter wins", async () => {
      const { items } = await search("4k", "&quality=720p");
      assert.ok(items.every((i) => i.bestQuality === "2160p"));
    });
  });

  describe("hostile input", () => {
    const nasty = [
      '"', "*", "(", ")", "NEAR", "NEAR(", "-", "--", "AND", "OR", "NOT", "a OR", '"a" "b', "a*", "^a", "col : x",
      "name:bbc", "country_name : \"x\"", '"bbc" OR "news"', "bbc)", "((", "NEAR/2 bbc", "bbc -news", "+bbc", "bbc^2",
      "‮", "ＢＢＣ", "ß", "😀", "📺 news", "\t\n", "'", "''", "; DROP TABLE channels", "\u0000", "%", "_",
      // Words that become grouped units (letter/digit split, codes, aliases) followed by another word.
      "1Plus1Marafon.ua", "bbc1 news", "4fun kids", "germany news", "DE news", "es news", "espanol news",
      "bbc1 es", "UK BBC1", "south africa news", "télé 1080p sports", "ch5 uk",
      "a".repeat(5000), Array(200).fill("bbc").join(" "), "bbc " + "\"".repeat(50),
    ];

    test(`${nasty.length} nasty queries return 200 with a valid list`, async () => {
      for (const q of nasty) {
        const res = await get(`/api/channels?q=${encodeURIComponent(q)}&limit=5`);
        assert.equal(res.statusCode, 200, `status for ${JSON.stringify(q.slice(0, 40))}`);
        const body = JSON.parse(res.body);
        assert.ok(Array.isArray(body.items), "items is an array");
      }
    });

    test("the catalog is intact after the hostile queries", async () => {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM channels").get() as { n: number }).n;
      assert.ok(n > 0);
      const { items } = await search("bbc");
      assert.ok(items.length > 0);
    });
  });

  describe("suggest()", () => {
    test("returns at most the requested number, best match first", () => {
      const list = suggest(db, "bbc", 3);
      assert.ok(list.length > 0 && list.length <= 3);
      assert.ok(list[0]!.name.toLowerCase().startsWith("bbc"));
      assert.deepEqual(Object.keys(list[0]!).sort(), ["countryName", "id", "logo", "name"]);
    });

    test("blank or punctuation-only input suggests nothing", () => {
      assert.deepEqual(suggest(db, "", 8), []);
      assert.deepEqual(suggest(db, "-", 8), []);
    });

    test("uses the same alias index as the list endpoint", () => {
      const idx = aliasIndexFor(db);
      assert.ok(idx.spans.has("germany"));
      const list = suggest(db, "germany", 8);
      assert.ok(list.length > 0);
    });
  });
});
