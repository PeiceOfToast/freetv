import fs from "node:fs";
import fsp from "node:fs/promises";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { getDb, getMeta, setMeta } from "../db/index.js";
import { parseXmltvFile, type Programme } from "./xmltv.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

const BATCH_SIZE = 5000;
const TEMP_TABLE = "programmes_new";
/** Gzip copy written next to the source file; export-guide.ts serves it to gzip-capable clients. */
export const guideGzPath = (file: string) => `${file}.gz`;

// Imports run one at a time; a call made while one is running waits for it, then runs its own pass.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Import config.epgFile into `programmes`. Skips when the file's mtime and size match the last
 * successful import, unless `force` is set. The whole swap happens in one transaction, so readers
 * keep the old guide until the new one is committed. A failed import leaves the old guide in place.
 */
export function importEpg(opts: { force?: boolean } = {}, log?: Log): Promise<void> {
  const run = chain.then(() => doImport(opts, log));
  chain = run.catch(() => undefined);
  return run;
}

async function doImport(opts: { force?: boolean }, log?: Log): Promise<void> {
  const file = config.epgFile;
  let st;
  try {
    st = await fsp.stat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      log?.info({ file }, "epg: no XMLTV file yet, skipping import");
      return;
    }
    throw e;
  }

  const mtime = String(Math.trunc(st.mtimeMs));
  const size = String(st.size);
  if (!opts.force && getMeta("epg_file_mtime") === mtime && getMeta("epg_file_size") === size) {
    return;
  }

  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TEMP_TABLE} (
      channel TEXT NOT NULL, start_ts INTEGER NOT NULL, stop_ts INTEGER NOT NULL,
      title TEXT NOT NULL, description TEXT, category TEXT, icon TEXT
    );
  `);
  db.prepare(`DELETE FROM ${TEMP_TABLE}`).run();

  const insert = db.prepare(
    `INSERT INTO ${TEMP_TABLE} (channel, start_ts, stop_ts, title, description, category, icon)
     VALUES (@channel, @start_ts, @stop_ts, @title, @description, @category, @icon)`,
  );
  const flushBatch = db.transaction((rows: Programme[]) => {
    for (const r of rows) insert.run(r);
  });

  const t0 = Date.now();
  let batch: Programme[] = [];
  let parsed = 0;
  try {
    parsed = await parseXmltvFile(file, (p) => {
      batch.push(p);
      if (batch.length >= BATCH_SIZE) {
        flushBatch(batch);
        batch = [];
      }
    });
    if (batch.length) flushBatch(batch);
    batch = [];
  } catch (e) {
    dropStaging(db);
    throw new Error(`epg import failed (old guide kept): ${(e as Error).message}`);
  }

  const swap = db.transaction(() => {
    db.prepare("DELETE FROM programmes").run();
    db.prepare(
      // Several guide sites can cover the same channel; keep one programme per (channel, start).
      `INSERT INTO programmes (channel, start_ts, stop_ts, title, description, category, icon)
       SELECT channel, start_ts, stop_ts, title, description, category, icon FROM ${TEMP_TABLE}
       WHERE rowid IN (SELECT MIN(rowid) FROM ${TEMP_TABLE} GROUP BY channel, start_ts)`,
    ).run();
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM programmes").get() as { n: number };
    setMeta("programmes_count", n);
    setMeta("last_epg_import", Math.floor(Date.now() / 1000));
    setMeta("epg_file_mtime", mtime);
    setMeta("epg_file_size", size);
  });
  swap();
  dropStaging(db);
  reclaimFreePages(db);
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* best effort */ }

  log?.info(
    { file, programmes: parsed, ms: Date.now() - t0 },
    "epg: import complete",
  );
  await writeGzip(file, st, log);
}

/**
 * Drops the staging table. Its rows are gone after the swap, and a dropped table returns its pages
 * to the file's freelist in one step (a DELETE would leave an empty, index-less table behind).
 * doImport recreates it at the start of the next pass.
 */
function dropStaging(db: ReturnType<typeof getDb>) {
  db.exec(`DROP TABLE IF EXISTS ${TEMP_TABLE}`);
}

/**
 * Returns freed pages to the OS, only when auto_vacuum is INCREMENTAL (2). The default is NONE (0),
 * where this does nothing: freed pages are reused by later writes, and a one-time VACUUM shrinks the
 * file (see docs/notes/review-fixes-e.md for the command).
 */
function reclaimFreePages(db: ReturnType<typeof getDb>) {
  const mode = db.pragma("auto_vacuum", { simple: true }) as number;
  if (mode === 2) db.exec("PRAGMA incremental_vacuum");
}

/**
 * Writes config.epgFile + ".gz" for /api/guide.xml. Streaming gzip to a temp file, then an atomic
 * rename. The gz gets the source's mtime as captured at the start of the import, so it is never
 * newer than a source that changed while it was being read; export-guide.ts serves it only while
 * gz mtime >= xml mtime. Best-effort: a failure is logged and the route gzips on the fly instead.
 */
async function writeGzip(file: string, src: { atime: Date; mtime: Date }, log?: Log): Promise<void> {
  const gz = guideGzPath(file);
  const tmp = `${gz}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(tmp));
    await fsp.utimes(tmp, src.atime, src.mtime);
    await fsp.rename(tmp, gz);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    log?.warn({ file: gz, err: (e as Error).message }, "epg: could not write guide.xml.gz; serving gzip on the fly");
  }
}

/** Run an import now, then re-check the file every config.epgPollSeconds. */
export function startEpgWatcher(log: Log): void {
  const tick = () => {
    importEpg({}, log).catch((e) => log.error(e));
  };
  tick();
  setInterval(tick, Math.max(1, config.epgPollSeconds) * 1000).unref();
}
