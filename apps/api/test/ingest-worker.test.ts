import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, closeDb, getDb } from "../src/db/index.js";
import { buildCatalogFromDir, buildCatalogInWorker } from "../src/ingest/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

// Tables the catalog build owns. meta and programmes are not touched by it.
const CATALOG_TABLES = [
  "channels", "channels_fts", "channel_categories", "channel_languages", "channel_numbers",
  "feeds", "streams", "guides", "categories", "countries", "languages",
];

/** Every row of every catalog table, as sorted JSON strings, so insertion order does not matter. */
function snapshot(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of CATALOG_TABLES) {
    const rows = getDb().prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    out[t] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

describe("catalog build in a worker thread", () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-ingest-worker-"));
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("produces exactly the rows the in-thread build produces", async () => {
    const workerDb = path.join(dir, "worker.db");
    openDb(workerDb);
    const stats = await buildCatalogInWorker({ dbPath: workerDb, rawDir: fixtures });
    assert.ok(stats.channels > 0);
    const fromWorker = snapshot();
    const meta = getDb().prepare("SELECT value FROM meta WHERE key = 'last_ingest'").get() as { value: string } | undefined;
    assert.match(meta?.value ?? "", /^\d+$/, "worker commit visible on the main connection");
    closeDb();

    const threadDb = path.join(dir, "thread.db");
    openDb(threadDb);
    buildCatalogFromDir(getDb(), fixtures);
    const fromThread = snapshot();

    for (const t of CATALOG_TABLES) {
      assert.deepEqual(fromWorker[t], fromThread[t], `table ${t} matches`);
    }
    assert.equal(stats.channels, fromThread.channels.length);
  });

  test("main-thread reads keep working while the worker commits the new catalog", async () => {
    // Same catalog with the first half of the channels: the commit changes the channel count.
    const rawDir = path.join(dir, "raw-half");
    fs.cpSync(fixtures, rawDir, { recursive: true });
    const channels = JSON.parse(fs.readFileSync(path.join(rawDir, "channels.json"), "utf8")) as unknown[];
    fs.writeFileSync(path.join(rawDir, "channels.json"), JSON.stringify(channels.slice(0, Math.floor(channels.length / 2))));

    closeDb();
    const dbPath = path.join(dir, "reads.db");
    openDb(dbPath);
    buildCatalogFromDir(getDb(), fixtures);
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM channels").get() as { n: number }).n;

    let reads = 0;
    let stopPolling = false;
    const polling = (async () => {
      while (!stopPolling) {
        // Synchronous reads on the main connection, interleaved with the worker's transaction.
        getDb().prepare("SELECT COUNT(*) AS n FROM channels").get();
        reads++;
        await new Promise((r) => setTimeout(r, 1));
      }
    })();
    await buildCatalogInWorker({ dbPath, rawDir });
    stopPolling = true;
    await polling;

    const after = (getDb().prepare("SELECT COUNT(*) AS n FROM channels").get() as { n: number }).n;
    assert.ok(reads > 0);
    assert.equal(after, Math.floor(channels.length / 2));
    assert.notEqual(after, before);
  });

  test("a worker that fails rejects with the reason and leaves the catalog as it was", async () => {
    const dbPath = path.join(dir, "reads.db");
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM channels").get() as { n: number }).n;
    await assert.rejects(
      buildCatalogInWorker({ dbPath, rawDir: path.join(dir, "no-such-raw-dir") }),
      /ENOENT/,
    );
    assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM channels").get() as { n: number }).n, before);
    // The process is still healthy: the main connection still answers.
    assert.deepEqual(getDb().prepare("SELECT 1 AS one").get(), { one: 1 });
  });

  test("a worker that cannot open the database rejects instead of crashing the process", async () => {
    await assert.rejects(
      buildCatalogInWorker({ dbPath: path.join(dir, "missing", "catalog.db"), rawDir: fixtures }),
      /unable to open|does not exist|no such file|ENOENT/i,
    );
  });
});
