import fs from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { getDb, getMeta, setMeta, type Db } from "../db/index.js";
import type { BuildStats } from "./build.js";
import { fetchDatasets } from "./fetch.js";
import { runWorker, type WorkerLog } from "../lib/worker.js";
import { resetMetaCache } from "../routes/catalog.js";
import type { IngestJob } from "./worker.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

export { buildCatalog as buildCatalogFromDir } from "./build.js";
export type { IngestJob } from "./worker.js";
export type { BuildStats } from "./build.js";

export interface RunOptions {
  /** Rebuild the catalog even when no dataset and no local blocklist change is detected. */
  force?: boolean;
}

/** Compiled dist/ingest/worker.js, or src/ingest/worker.ts under tsx. */
const WORKER_ENTRY = new URL("./worker.js", import.meta.url);

/**
 * Rebuilds the catalog tables in a worker thread, on its own connection to the same file. The write
 * transaction commits atomically, so readers on the main thread see the old catalog until then.
 * Rejects if the worker fails; the caller decides what to log.
 */
export function buildCatalogInWorker(job: IngestJob, log?: WorkerLog): Promise<BuildStats> {
  return runWorker<BuildStats>(WORKER_ENTRY, job, log);
}

/** meta key holding the local blocklist fingerprint the current catalog was built from. */
const BLOCKLIST_FP_KEY = "local_blocklist_fp";

// Runs are chained so two ingests never overlap (the second waits for the first).
let queue: Promise<void> = Promise.resolve();

/** Same path readLocalBlocklist() reads (ingest/build.ts): LOCAL_BLOCKLIST, else $DATA_DIR/local-blocklist.json. */
export function localBlocklistPath(): string {
  return process.env.LOCAL_BLOCKLIST ?? path.join(process.env.DATA_DIR ?? "/data", "local-blocklist.json");
}

/** mtime and size of the local blocklist, or "absent". Changes on every write, create or delete. */
export function localBlocklistFingerprint(file: string = localBlocklistPath()): string {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "absent";
  }
}

async function ingestOnce(log: Log | undefined, opts: RunOptions): Promise<void> {
  const db: Db = getDb();
  const started = Date.now();
  // Taken before the build so an edit made during the build is seen as a change on the next run.
  const blocklistFp = localBlocklistFingerprint();
  const datasetsChanged = await fetchDatasets(config.rawDir, { log: log ? { info: (m) => log.info(m), warn: (m) => log.warn(m) } : undefined });
  const hasChannels = db.prepare("SELECT 1 FROM channels LIMIT 1").get() !== undefined;
  const blocklistChanged = getMeta(BLOCKLIST_FP_KEY) !== blocklistFp;
  if (!opts.force && !datasetsChanged && !blocklistChanged && hasChannels) {
    log?.info("ingest: datasets and local blocklist unchanged, catalog not rebuilt");
    return;
  }
  const reason = opts.force ? "forced" : !hasChannels ? "catalog empty" : datasetsChanged ? "datasets changed" : "local blocklist changed";
  const stats: BuildStats = await buildCatalogInWorker(
    { dbPath: db.name, rawDir: config.rawDir },
    log,
  );
  setMeta(BLOCKLIST_FP_KEY, blocklistFp);
  resetMetaCache();
  log?.info(
    `ingest: catalog rebuilt (${reason}) in ${Date.now() - started} ms (write lock ${stats.writeMs} ms): ${stats.channels} channels ` +
      `(${stats.channelsWithStreams} with streams, ${stats.blockedChannels} blocked), ${stats.streams} streams ` +
      `(${stats.streamsSkipped} orphan skipped), ${stats.guides} guides`,
  );
}

/**
 * Download datasets and rebuild the catalog when anything changed: an upstream dataset, the local
 * blocklist file (mtime or size), or an empty catalog. `force` always rebuilds. Requires openDb().
 */
export function runIngest(log?: Log, opts: RunOptions = {}): Promise<void> {
  const run = queue.then(() => ingestOnce(log, opts));
  queue = run.catch(() => undefined);
  return run;
}

/** Run now, then every config.ingestIntervalHours. Errors are logged, never thrown. */
export function scheduleIngest(log: Pick<FastifyBaseLogger, "info" | "warn" | "error">): void {
  const tick = () => {
    runIngest(log).catch((e) => log.error(e));
  };
  tick();
  const hours = config.ingestIntervalHours;
  if (hours > 0) {
    setInterval(tick, hours * 3_600_000).unref();
  }
}
