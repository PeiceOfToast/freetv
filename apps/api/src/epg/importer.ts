import fs from "node:fs";
import fsp from "node:fs/promises";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { getDb, getMeta } from "../db/index.js";
import { runWorker } from "../lib/worker.js";
import { resetMetaCache } from "../routes/catalog.js";
import type { EpgResult } from "./worker.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

/** Gzip copy written next to the source file; export-guide.ts serves it to gzip-capable clients. */
export const guideGzPath = (file: string) => `${file}.gz`;

/** Compiled dist/epg/worker.js, or src/epg/worker.ts under tsx. */
const EPG_WORKER_ENTRY = new URL("./worker.js", import.meta.url);

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

  // Parse, stage and swap run in a worker on its own connection; readers on this thread keep the old
  // guide until the swap commits. A failure rejects here and leaves the old guide in place.
  const { programmes, ms } = await runWorker<EpgResult>(
    EPG_WORKER_ENTRY,
    { dbPath: getDb().name, file, mtime, size },
    log,
  );
  resetMetaCache();

  log?.info({ file, programmes, ms }, "epg: import complete");
  await writeGzip(file, st, log);
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
