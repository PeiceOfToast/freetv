// Worker thread entry for the EPG import (see lib/worker.ts): parse the XMLTV file into the staging
// table, swap it into `programmes` in one transaction, then free and checkpoint the WAL. All of it runs
// on the worker's own connection, so the main thread keeps serving reads. Must not import server.ts,
// routes, or anything that starts timers.
import { parentPort, workerData } from "node:worker_threads";
import type { Db } from "../db/index.js";
import { openWorkerConnection } from "../db/index.js";
import type { WorkerMessage } from "../lib/worker.js";
import { parseXmltvFile, type Programme } from "./xmltv.js";

export interface EpgJob {
  dbPath: string;
  file: string;
  /** Source mtime and size as the main thread saw them before the import; stored on success. */
  mtime: string;
  size: string;
  batchSize?: number;
}

export interface EpgResult {
  programmes: number;
  ms: number;
}

export const TEMP_TABLE = "programmes_new";
const DEFAULT_BATCH_SIZE = 5000;

const post = (m: WorkerMessage) => parentPort?.postMessage(m);
const setMeta = (db: Db, key: string, value: string | number) =>
  db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));

/** Drops the staging table. A dropped table returns its pages to the freelist in one step. */
function dropStaging(db: Db) {
  db.exec(`DROP TABLE IF EXISTS ${TEMP_TABLE}`);
}

/** Returns freed pages to the OS, only when auto_vacuum is INCREMENTAL (2). Default NONE is a no-op. */
function reclaimFreePages(db: Db) {
  const mode = db.pragma("auto_vacuum", { simple: true }) as number;
  if (mode === 2) db.exec("PRAGMA incremental_vacuum");
}

export async function runImport(job: EpgJob): Promise<EpgResult> {
  const db = openWorkerConnection(job.dbPath);
  try {
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
    const batchSize = job.batchSize ?? DEFAULT_BATCH_SIZE;
    let batch: Programme[] = [];
    let parsed = 0;
    try {
      parsed = await parseXmltvFile(job.file, (p) => {
        batch.push(p);
        if (batch.length >= batchSize) {
          flushBatch.immediate(batch);
          batch = [];
        }
      });
      if (batch.length) flushBatch.immediate(batch);
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
      setMeta(db, "programmes_count", n);
      setMeta(db, "last_epg_import", Math.floor(Date.now() / 1000));
      setMeta(db, "epg_file_mtime", job.mtime);
      setMeta(db, "epg_file_size", job.size);
    });
    swap.immediate();
    dropStaging(db);
    reclaimFreePages(db);
    // Runs here, not on the main thread: a TRUNCATE checkpoint over a large WAL takes long enough to stall it.
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* best effort */ }
    return { programmes: parsed, ms: Date.now() - t0 };
  } finally {
    db.close();
  }
}

if (parentPort) {
  runImport(workerData as EpgJob).then(
    (result) => post({ type: "done", result }),
    (e) => post({ type: "fail", error: (e as Error).message }),
  );
}
