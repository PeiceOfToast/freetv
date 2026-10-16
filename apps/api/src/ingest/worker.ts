// Worker thread entry for the catalog rebuild (see lib/worker.ts). Opens its own connection to the
// catalog file, so the main thread keeps serving reads while the transaction runs. Must not import
// server.ts or anything that starts timers or routes.
import { parentPort, workerData } from "node:worker_threads";
import { openWorkerConnection } from "../db/index.js";
import { buildCatalog, type BuildStats } from "./build.js";
import type { WorkerMessage } from "../lib/worker.js";

export interface IngestJob {
  dbPath: string;
  rawDir: string;
  now?: number;
}

const post = (m: WorkerMessage) => parentPort?.postMessage(m);
const info = (msg: string, data?: Record<string, unknown>) => post({ type: "log", level: "info", msg, data });

function run(job: IngestJob): BuildStats {
  const conn = openWorkerConnection(job.dbPath);
  try {
    info("ingest worker: rebuilding catalog", { dbPath: job.dbPath, rawDir: job.rawDir });
    return buildCatalog(conn, job.rawDir, job.now);
  } finally {
    conn.close();
  }
}

if (parentPort) {
  try {
    const result = run(workerData as IngestJob);
    post({ type: "done", result });
  } catch (e) {
    post({ type: "fail", error: (e as Error).message });
  }
}
