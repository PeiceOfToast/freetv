import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb } from "../src/db/index.js";
import { buildServer } from "../src/server.js";
import { acceptsGzip, guideEtag, gzipIsCurrent, isNotModified } from "../src/lib/export-guide.js";

config.logLevel = "silent";

describe("GET /api/guide.xml", () => {
  let dir: string;
  let file: string;
  let app: FastifyInstance;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv>${"<channel id=\"X.us\"><display-name>X</display-name></channel>\n".repeat(200)}</tv>\n`;
  const MTIME = new Date("2026-10-15T06:00:00Z");

  const get = (headers: Record<string, string> = {}) => app.inject({ method: "GET", url: "/api/guide.xml", headers });

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-export-guide-"));
    // Own DB so buildServer() has something to open; the guide does not read it.
    openDb(path.join(dir, "catalog.db"));
    file = path.join(dir, "epg", "guide.xml");
    config.epgFile = file;
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("404 with the contract body when no guide file exists yet", async () => {
    assert.equal(fs.existsSync(file), false);
    const res = await get();
    assert.equal(res.statusCode, 404);
    assert.deepEqual(JSON.parse(res.body), { error: "no guide yet" });
  });

  test("streams the file as application/xml with validators and caching", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, xml);
    fs.utimesSync(file, MTIME, MTIME);

    const res = await get();
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/xml");
    assert.equal(res.headers["content-length"], String(Buffer.byteLength(xml)));
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(res.headers["last-modified"], MTIME.toUTCString());
    assert.equal(res.headers["cache-control"], "public, max-age=600");
    assert.match(String(res.headers.etag), /^W\/"\d+-\d+"$/);
    assert.equal(res.body, xml);
  });

  test("gzip when the client accepts it, with no Content-Length", async () => {
    const res = await get({ "accept-encoding": "gzip, deflate, br" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.equal(res.headers["content-length"], undefined);
    assert.equal(res.headers["content-type"], "application/xml");
    assert.equal(zlib.gunzipSync(res.rawPayload).toString("utf8"), xml);
  });

  test("identity when gzip is refused with q=0", async () => {
    const res = await get({ "accept-encoding": "gzip;q=0, identity" });
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(res.body, xml);
  });

  test("304 for a matching If-None-Match, with or without the weak prefix", async () => {
    const first = await get();
    const etag = String(first.headers.etag);
    for (const value of [etag, etag.replace(/^W\//, ""), `"nope", ${etag}`, "*"]) {
      const res = await get({ "if-none-match": value });
      assert.equal(res.statusCode, 304, value);
      assert.equal(res.body, "");
    }
    const miss = await get({ "if-none-match": '"other"' });
    assert.equal(miss.statusCode, 200);
  });

  test("304 for If-Modified-Since at or after the mtime, 200 before it", async () => {
    const at = await get({ "if-modified-since": MTIME.toUTCString() });
    assert.equal(at.statusCode, 304);
    const later = await get({ "if-modified-since": new Date(MTIME.getTime() + 3600_000).toUTCString() });
    assert.equal(later.statusCode, 304);
    const before = await get({ "if-modified-since": new Date(MTIME.getTime() - 3600_000).toUTCString() });
    assert.equal(before.statusCode, 200);
  });

  test("If-None-Match wins over If-Modified-Since", async () => {
    const res = await get({ "if-none-match": '"stale"', "if-modified-since": MTIME.toUTCString() });
    assert.equal(res.statusCode, 200);
  });

  test("a changed file gets a new ETag and full body", async () => {
    const etagBefore = String((await get()).headers.etag);
    const newer = new Date(MTIME.getTime() + 60_000);
    fs.writeFileSync(file, xml + "<!-- updated -->\n");
    fs.utimesSync(file, newer, newer);
    const res = await get({ "if-none-match": etagBefore });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["last-modified"], newer.toUTCString());
    assert.notEqual(res.headers.etag, etagBefore);
    assert.match(res.body, /updated/);
  });

  test("serves the prebuilt guide.xml.gz with its own validators when it is not older than the source", async () => {
    const srcMtime = fs.statSync(file).mtime;
    const gzFile = `${file}.gz`;
    fs.writeFileSync(gzFile, zlib.gzipSync(fs.readFileSync(file)));
    fs.utimesSync(gzFile, srcMtime, srcMtime);
    try {
      const gzSt = fs.statSync(gzFile);
      const res = await get({ "accept-encoding": "gzip" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["content-encoding"], "gzip");
      assert.equal(res.headers["content-length"], String(gzSt.size), "size of the file on disk");
      assert.equal(res.headers["last-modified"], gzSt.mtime.toUTCString());
      assert.equal(res.headers.etag, guideEtag(gzSt));
      assert.equal(zlib.gunzipSync(res.rawPayload).toString("utf8"), fs.readFileSync(file, "utf8"));

      const cached = await get({ "accept-encoding": "gzip", "if-none-match": String(res.headers.etag) });
      assert.equal(cached.statusCode, 304);
    } finally {
      fs.rmSync(gzFile, { force: true });
    }
  });

  test("falls back to on-the-fly gzip when the .gz is older than the source", async () => {
    const srcMtime = fs.statSync(file).mtime;
    const gzFile = `${file}.gz`;
    fs.writeFileSync(gzFile, zlib.gzipSync("stale"));
    fs.utimesSync(gzFile, new Date(srcMtime.getTime() - 60_000), new Date(srcMtime.getTime() - 60_000));
    try {
      const res = await get({ "accept-encoding": "gzip" });
      assert.equal(res.headers["content-encoding"], "gzip");
      assert.equal(res.headers["content-length"], undefined, "on-the-fly gzip has no Content-Length");
      assert.equal(res.headers.etag, guideEtag(fs.statSync(file)), "validators come from the source file");
      assert.equal(zlib.gunzipSync(res.rawPayload).toString("utf8"), fs.readFileSync(file, "utf8"));
    } finally {
      fs.rmSync(gzFile, { force: true });
    }
  });

  test("clients that do not accept gzip get the source file even when a current .gz exists", async () => {
    const srcMtime = fs.statSync(file).mtime;
    const gzFile = `${file}.gz`;
    fs.writeFileSync(gzFile, zlib.gzipSync(fs.readFileSync(file)));
    fs.utimesSync(gzFile, srcMtime, srcMtime);
    try {
      const res = await get({ "accept-encoding": "identity" });
      assert.equal(res.headers["content-encoding"], undefined);
      assert.equal(res.headers["content-length"], String(fs.statSync(file).size));
      assert.equal(res.headers.etag, guideEtag(fs.statSync(file)));
    } finally {
      fs.rmSync(gzFile, { force: true });
    }
  });
});

describe("guide helpers", () => {
  test("acceptsGzip honours q values and token boundaries", () => {
    assert.equal(acceptsGzip("gzip"), true);
    assert.equal(acceptsGzip("deflate, GZIP;q=0.5"), true);
    assert.equal(acceptsGzip("gzip;q=0"), false);
    assert.equal(acceptsGzip("gzipped"), false);
    assert.equal(acceptsGzip("identity"), false);
    assert.equal(acceptsGzip(undefined), false);
    assert.equal(acceptsGzip(["br", "gzip"]), true);
  });

  test("gzipIsCurrent is true for equal or newer copies, false when the source is newer", () => {
    assert.equal(gzipIsCurrent({ mtimeMs: 1000.4 }, { mtimeMs: 1000.9 }), true, "same whole millisecond");
    assert.equal(gzipIsCurrent({ mtimeMs: 2000 }, { mtimeMs: 1000 }), true);
    assert.equal(gzipIsCurrent({ mtimeMs: 1000 }, { mtimeMs: 1001 }), false);
  });

  test("isNotModified ignores invalid dates and missing headers", () => {
    const m = new Date("2026-10-15T06:00:00Z");
    assert.equal(isNotModified({}, 'W/"1-1"', m), false);
    assert.equal(isNotModified({ "if-modified-since": "not a date" }, 'W/"1-1"', m), false);
    assert.equal(isNotModified({ "if-none-match": 'W/"1-1"' }, 'W/"1-1"', m), true);
  });
});
