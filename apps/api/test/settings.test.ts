import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb } from "../src/db/index.js";
import { buildServer } from "../src/server.js";
import { getSettings, updateSettings } from "../src/lib/settings.js";

config.logLevel = "silent";
config.adminToken = "test-admin-token";
config.proxyEnabled = true;
config.proxySecret = "test-secret";

const AUTH = { authorization: "Bearer test-admin-token" };

describe("settings", () => {
  let dir: string;
  let dbPath: string;
  let app: FastifyInstance;
  const savedPublicUrl = config.publicUrl;

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
  const put = (body: unknown, headers: Record<string, string> = AUTH) =>
    app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: { ...headers, "content-type": "application/json" },
      payload: typeof body === "string" ? body : JSON.stringify(body),
    });
  const publicSettings = async (headers: Record<string, string> = {}) => (await get("/api/settings", headers)).json() as Record<string, any>;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-settings-"));
    dbPath = path.join(dir, "catalog.db");
    openDb(dbPath);
    config.publicUrl = "";
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    config.publicUrl = savedPublicUrl;
    await app.close();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("defaults and the public endpoint", () => {
    test("with nothing stored: env defaults, request origin, relayEnabled from config", async () => {
      const s = await publicSettings();
      assert.equal(s.siteName, "FreeTV");
      assert.equal(s.publicUrl, "http://localhost:80", "no stored or env URL: the request origin");
      assert.equal(s.contact, "");
      assert.equal(s.notes, "");
      assert.deepEqual(s.featuredApps, ["tivimate", "vlc", "kodi", "plex", "jellyfin"]);
      assert.equal(s.relayEnabled, true);
      assert.deepEqual(Object.keys(s).sort(), ["contact", "featuredApps", "notes", "publicUrl", "relayEnabled", "siteName"]);
    });

    test("relayEnabled is false without a proxy secret", async () => {
      const saved = config.proxySecret;
      config.proxySecret = "";
      try {
        assert.equal((await publicSettings()).relayEnabled, false);
      } finally {
        config.proxySecret = saved;
      }
    });

    test("the public endpoint is cacheable for a minute", async () => {
      assert.equal((await get("/api/settings")).headers["cache-control"], "public, max-age=60");
    });

    test("publicUrl fallback: PUBLIC_URL beats the request origin, and the request origin is the last resort", async () => {
      config.publicUrl = "https://env.example.test/";
      try {
        assert.equal((await publicSettings()).publicUrl, "https://env.example.test", "trailing slash dropped");
        const forwarded = await publicSettings({ "x-forwarded-proto": "https", "x-forwarded-host": "tv.forwarded.test" });
        assert.equal(forwarded.publicUrl, "https://env.example.test", "env still wins over forwarded headers");
      } finally {
        config.publicUrl = "";
      }
      const forwarded = await publicSettings({ "x-forwarded-proto": "https", "x-forwarded-host": "tv.forwarded.test" });
      assert.equal(forwarded.publicUrl, "https://tv.forwarded.test");
    });
  });

  describe("admin endpoints", () => {
    test("GET and PUT require the bearer token", async () => {
      assert.equal((await app.inject({ method: "GET", url: "/api/admin/settings" })).statusCode, 401);
      assert.equal((await app.inject({ method: "GET", url: "/api/admin/settings", headers: { authorization: "Bearer nope" } })).statusCode, 401);
      assert.equal((await put({ siteName: "X" }, {})).statusCode, 401);
      assert.equal((await put({ siteName: "X" }, { authorization: "Bearer wrong-token" })).statusCode, 401);
    });

    test("GET reports stored values as null when unset, plus the env defaults", async () => {
      const res = await app.inject({ method: "GET", url: "/api/admin/settings", headers: AUTH });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["cache-control"], "no-store");
      const body = res.json() as Record<string, any>;
      assert.equal(body.siteName, null);
      assert.equal(body.featuredApps, null);
      assert.equal(body.defaults.siteName, "FreeTV");
      assert.deepEqual(body.defaults.featuredApps, ["tivimate", "vlc", "kodi", "plex", "jellyfin"]);
    });

    test("PUT stores the values, returns them, and the public endpoint reflects them at once", async () => {
      const res = await put({
        siteName: "Living Room TV",
        contact: "ops@example.test",
        notes: "<b>Hello</b> there",
        featuredApps: ["vlc", "vlc", "kodi"],
      });
      assert.equal(res.statusCode, 200);
      const body = res.json() as Record<string, any>;
      assert.equal(body.siteName, "Living Room TV");
      assert.equal(body.notes, "Hello there", "tags stripped");
      assert.deepEqual(body.featuredApps, ["vlc", "kodi"], "duplicates removed, order kept");

      const pub = await publicSettings();
      assert.equal(pub.siteName, "Living Room TV");
      assert.equal(pub.contact, "ops@example.test");
    });

    test("PUT with an empty body or an empty object is accepted and changes nothing", async () => {
      const before = await publicSettings();
      assert.equal((await put({})).statusCode, 200);
      assert.deepEqual(await publicSettings(), before);
    });

    test("publicUrl: stored value wins; an empty value falls back to PUBLIC_URL again", async () => {
      assert.equal((await put({ publicUrl: "https://stored.example.test/" })).statusCode, 200);
      assert.equal((await publicSettings()).publicUrl, "https://stored.example.test");
      config.publicUrl = "https://env.example.test";
      try {
        assert.equal((await put({ publicUrl: "" })).statusCode, 200);
        assert.equal((await publicSettings()).publicUrl, "https://env.example.test");
      } finally {
        config.publicUrl = "";
      }
    });
  });

  describe("validation", () => {
    const rejects = async (body: unknown, key: RegExp) => {
      const res = await put(body);
      assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 80));
      assert.match((res.json() as { error: string }).error, key);
    };

    test("an unknown key is a 400 naming the key", () => rejects({ siteName: "X", bogus: 1 }, /unknown setting: bogus/));
    test("siteName: empty, too long, or with control characters", async () => {
      await rejects({ siteName: "   " }, /siteName must not be empty/);
      await rejects({ siteName: "x".repeat(61) }, /siteName must be at most 60/);
      await rejects({ siteName: "line\nbreak" }, /control characters/);
      assert.equal((await put({ siteName: "x".repeat(60) })).statusCode, 200);
    });
    test("publicUrl must be an http(s) URL or empty", async () => {
      await rejects({ publicUrl: "ftp://files.example.test" }, /publicUrl must be an http or https URL/);
      await rejects({ publicUrl: "not a url" }, /publicUrl must be/);
    });
    test("contact is at most 200 characters", () => rejects({ contact: "c".repeat(201) }, /contact must be at most 200/));
    test("notes are plain text at most 2000 characters after tags are removed", async () => {
      await rejects({ notes: "n".repeat(2001) }, /notes must be at most 2000/);
      assert.equal((await put({ notes: `<i>${"n".repeat(1990)}</i>` })).statusCode, 200, "tags do not count");
    });
    test("featuredApps: only known apps, as an array", async () => {
      await rejects({ featuredApps: ["netflix"] }, /unknown app: netflix/);
      await rejects({ featuredApps: "vlc" }, /featuredApps must be an array/);
    });
    test("a non-string value and a non-object body are 400s", async () => {
      await rejects({ siteName: 42 }, /siteName must be a string/);
      await rejects(["siteName"], /body must be a JSON object/);
    });
    test("malformed JSON is a 400, not a 500", async () => {
      const res = await put("{not json");
      assert.equal(res.statusCode, 400);
    });
  });

  describe("persistence and playlist effects", () => {
    test("playlists pick up a new siteName and publicUrl on the next request", async () => {
      assert.equal((await put({ siteName: "Playlist Test", publicUrl: "https://tv.playlist.example.test" })).statusCode, 200);
      const first = (await app.inject({ method: "GET", url: "/api/playlist.m3u" })).body.split("\n");
      assert.equal(first[0], '#EXTM3U x-tvg-url="https://tv.playlist.example.test/api/guide.xml"');
      assert.equal(first[1], "#PLAYLIST:Playlist Test");

      assert.equal((await put({ siteName: "Renamed" })).statusCode, 200);
      const second = (await app.inject({ method: "GET", url: "/api/playlist.m3u" })).body.split("\n");
      assert.equal(second[1], "#PLAYLIST:Renamed", "the memoised body is not reused after a write");
    });

    test("stored values survive a restart of the database", async () => {
      assert.equal((await put({ siteName: "Survives Restart" })).statusCode, 200);
      closeDb();
      openDb(dbPath);
      assert.equal(getSettings().siteName, "Survives Restart");
      assert.equal((await publicSettings()).siteName, "Survives Restart");
    });

    test("updateSettings is the same write path the route uses", () => {
      const s = updateSettings({ contact: "direct@example.test" });
      assert.equal(s.contact, "direct@example.test");
      assert.equal(getSettings().siteName, "Survives Restart", "untouched keys keep their values");
    });
  });
});
