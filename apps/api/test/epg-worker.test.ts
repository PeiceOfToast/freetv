import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { openDb, closeDb, getDb, getMeta } from "../src/db/index.js";
import { importEpg } from "../src/epg/importer.js";
import { buildCatalogInWorker } from "../src/ingest/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const SAMPLE = path.join(fixtures, "sample-guide.xml");

describe("epg import in a worker thread", () => {
  let dir: string;
  const savedFile = config.epgFile;
  const savedLog = config.logLevel;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-epg-worker-"));
    config.logLevel = "silent";
    config.epgFile = path.join(dir, "guide.xml");
    fs.copyFileSync(SAMPLE, config.epgFile);
    openDb(path.join(dir, "catalog.db"));
  });

  after(() => {
    closeDb();
    config.epgFile = savedFile;
    config.logLevel = savedLog;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const programmeCount = () => (getDb().prepare("SELECT COUNT(*) AS n FROM programmes").get() as { n: number }).n;
  const stagingExists = () =>
    getDb().prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'programmes_new'").get() !== undefined;

  test("a truncated guide rejects, keeps the old programmes, and drops the staging table", async () => {
    await importEpg({});
    assert.equal(programmeCount(), 3);
    const mtimeBefore = getMeta("epg_file_mtime");

    // Truncate the file and make its mtime differ, so the import is attempted.
    const xml = fs.readFileSync(SAMPLE, "utf8");
    fs.writeFileSync(config.epgFile, xml.slice(0, Math.floor(xml.length / 2)));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(config.epgFile, later, later);

    await assert.rejects(importEpg({}), /epg import failed \(old guide kept\)/);
    assert.equal(programmeCount(), 3);
    assert.equal(getMeta("epg_file_mtime"), mtimeBefore);
    assert.equal(stagingExists(), false);
  });

  test("EPG import and catalog rebuild run together on one file and both commit", async () => {
    // Restore a good guide, then run both writers at once. Each one holds the write lock for its own
    // transaction; busy_timeout makes the second wait instead of failing.
    fs.copyFileSync(SAMPLE, config.epgFile);
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(config.epgFile, later, later);
    const dbPath = getDb().name;

    await Promise.all([
      importEpg({ force: true }),
      buildCatalogInWorker({ dbPath, rawDir: fixtures }),
    ]);

    assert.equal(programmeCount(), 3);
    const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM channels").get() as { n: number };
    assert.equal(n, JSON.parse(fs.readFileSync(path.join(fixtures, "channels.json"), "utf8")).length);
    assert.equal(stagingExists(), false);
  });
});
