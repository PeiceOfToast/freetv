// Runs a CPU-bound job in a worker_threads Worker so the Fastify event loop keeps serving.
// Each entry is written once in TypeScript. Compiled builds spawn the sibling .js from dist/. Under tsx
// (dev, tests, the ingest CLI) the worker is started from a one-line bootstrap that registers tsx in
// the worker thread and then imports the .ts entry. Loader hooks are per thread, and inherited
// execArgv does not resolve the .js to .ts mapping inside the worker.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export interface WorkerLog {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

/** Messages a worker posts to its parent. */
export type WorkerMessage =
  | { type: "log"; level: "info" | "warn" | "error"; msg: string; data?: Record<string, unknown> }
  | { type: "done"; result: unknown }
  | { type: "fail"; error: string };

/**
 * Finds a worker entry given as the URL of its `.js` file (compiled layout). Falls back to the `.ts`
 * sibling when only that exists, which is the tsx layout under src/.
 */
export function resolveWorkerEntry(jsUrl: URL): { href: string; typescript: boolean } {
  const jsPath = fileURLToPath(jsUrl);
  if (fs.existsSync(jsPath)) return { href: jsUrl.href, typescript: false };
  const tsPath = jsPath.replace(/\.js$/, ".ts");
  if (fs.existsSync(tsPath)) return { href: pathToFileURL(tsPath).href, typescript: true };
  throw new Error(`worker entry not found: ${jsPath}`);
}

/** Starts a worker for a .ts entry: registers tsx in the worker thread, then imports the entry. */
function tsxBootstrap(entryHref: string, data: object): Worker {
  const code = `
    import(${JSON.stringify(import.meta.resolve("tsx/esm/api"))})
      .then(({ register }) => { register(); return import(${JSON.stringify(entryHref)}); });
  `;
  return new Worker(code, { eval: true, workerData: data });
}

/**
 * Spawns `entry` with `data` as workerData and resolves with the `result` of its "done" message.
 * A "fail" message, an uncaught error in the worker, or an exit without a result rejects the promise.
 * None of these take the process down. Worker "log" messages go to `log`.
 */
export function runWorker<T>(entry: URL, data: object, log?: WorkerLog): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    let worker: Worker;
    try {
      const target = resolveWorkerEntry(entry);
      worker = target.typescript ? tsxBootstrap(target.href, data) : new Worker(new URL(target.href), { workerData: data });
    } catch (e) {
      reject(e);
      return;
    }
    worker.on("message", (m: WorkerMessage) => {
      if (m.type === "log") {
        const obj = m.data ? { ...m.data } : undefined;
        if (obj) log?.[m.level](obj, m.msg);
        else log?.[m.level](m.msg);
      } else if (m.type === "done") {
        settle(() => resolve(m.result as T));
      } else if (m.type === "fail") {
        settle(() => reject(new Error(m.error)));
      }
    });
    worker.on("error", (e) => settle(() => reject(e)));
    worker.on("exit", (code) => settle(() => reject(new Error(`worker exited with code ${code} before reporting a result`))));
  });
}
