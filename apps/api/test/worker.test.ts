import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { runWorker, resolveWorkerEntry, type WorkerLog } from "../src/lib/worker.js";

describe("lib/worker", () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-worker-"));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const captureLog = () => {
    const lines: Array<{ level: string; msg: string }> = [];
    const log: WorkerLog = {
      info: (o, m) => lines.push({ level: "info", msg: String(m ?? o) }),
      warn: (o, m) => lines.push({ level: "warn", msg: String(m ?? o) }),
      error: (o, m) => lines.push({ level: "error", msg: String(m ?? o) }),
    };
    return { log, lines };
  };

  test("resolves the .ts sibling when only the .ts file exists (tsx layout)", () => {
    const js = new URL("../src/ingest/worker.js", import.meta.url);
    const r = resolveWorkerEntry(js);
    assert.equal(r.typescript, true);
    assert.equal(fileURLToPath(r.href), fileURLToPath(new URL("../src/ingest/worker.ts", import.meta.url)));
  });

  test("uses the .js file as is when it exists (compiled layout)", () => {
    const file = path.join(dir, "compiled.js");
    fs.writeFileSync(file, "export {};");
    const r = resolveWorkerEntry(pathToFileURL(file));
    assert.equal(r.typescript, false);
    assert.equal(r.href, pathToFileURL(file).href);
  });

  test("a missing entry is an error, not a hang", () => {
    assert.throws(() => resolveWorkerEntry(pathToFileURL(path.join(dir, "absent.js"))), /worker entry not found/);
  });

  test("resolves with the done result and forwards worker log messages", async () => {
    const file = path.join(dir, "echo.mjs");
    fs.writeFileSync(
      file,
      `import { parentPort, workerData } from "node:worker_threads";
       parentPort.postMessage({ type: "log", level: "info", msg: "started" });
       parentPort.postMessage({ type: "log", level: "warn", msg: "careful", data: { n: 1 } });
       parentPort.postMessage({ type: "done", result: { doubled: workerData.n * 2 } });`,
    );
    const { log, lines } = captureLog();
    const result = await runWorker<{ doubled: number }>(pathToFileURL(file), { n: 21 }, log);
    assert.deepEqual(result, { doubled: 42 });
    assert.deepEqual(lines, [
      { level: "info", msg: "started" },
      { level: "warn", msg: "careful" },
    ]);
  });

  test("a fail message rejects with its reason", async () => {
    const file = path.join(dir, "fails.mjs");
    fs.writeFileSync(file, `import { parentPort } from "node:worker_threads"; parentPort.postMessage({ type: "fail", error: "nope" });`);
    await assert.rejects(runWorker(pathToFileURL(file), {}), /nope/);
  });

  test("a worker that throws on load rejects; the process stays up", async () => {
    const file = path.join(dir, "throws.mjs");
    fs.writeFileSync(file, `throw new Error("boom at load");`);
    await assert.rejects(runWorker(pathToFileURL(file), {}), /boom at load/);
  });

  test("a worker that exits without a result rejects", async () => {
    const file = path.join(dir, "silent.mjs");
    fs.writeFileSync(file, `process.exit(3);`);
    await assert.rejects(runWorker(pathToFileURL(file), {}), /exited with code 3/);
  });
});
