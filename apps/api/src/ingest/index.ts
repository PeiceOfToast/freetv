import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { getDb, type Db } from "../db/index.js";
import { buildCatalog, type BuildStats } from "./build.js";
import { fetchDatasets } from "./fetch.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

export { buildCatalog as buildCatalogFromDir } from "./build.js";
export type { BuildStats } from "./build.js";

// Runs are chained so two ingests never overlap (the second waits for the first).
let queue: Promise<void> = Promise.resolve();

async function ingestOnce(log?: Log): Promise<void> {
  const db: Db = getDb();
  const started = Date.now();
  const changed = await fetchDatasets(config.rawDir, { log: log ? { info: (m) => log.info(m), warn: (m) => log.warn(m) } : undefined });
  const hasChannels = db.prepare("SELECT 1 FROM channels LIMIT 1").get() !== undefined;
  if (!changed && hasChannels) {
    log?.info("ingest: datasets unchanged, catalog not rebuilt");
    return;
  }
  const stats: BuildStats = buildCatalog(db, config.rawDir);
  log?.info(
    `ingest: catalog rebuilt in ${Date.now() - started} ms: ${stats.channels} channels ` +
      `(${stats.channelsWithStreams} with streams, ${stats.blockedChannels} blocked), ${stats.streams} streams ` +
      `(${stats.streamsSkipped} orphan skipped), ${stats.guides} guides`,
  );
}

/** Download datasets and rebuild the catalog if anything changed (or the catalog is empty). Requires openDb(). */
export function runIngest(log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">): Promise<void> {
  const run = queue.then(() => ingestOnce(log));
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
