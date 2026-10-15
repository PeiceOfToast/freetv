// Starts the real stack for the e2e run, all on loopback and with no internet:
//   fake HLS origin  :HLS_PORT (4600)   fixture catalog + guide in a temp DATA_DIR
//   api              :3000  (vite preview forwards /api here)
//   proxy            :3001  (vite preview forwards /proxy here)
//   web              :4173  vite preview of the production build (sw.js included)
// global-teardown.ts stops every process group started here and removes the temp data.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { writeCatalogInput, writeGuide, HLS_PORT } from "./fixture-data.ts";
import { API_DIR, API_PORT, E2E_ROOT, LOG_DIR, PROXY_DIR, PROXY_PORT, PROXY_SECRET, STATE_ENV, WEB_DIR, WEB_PORT } from "./paths.ts";

interface RunState {
  runDir: string;
  pids: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startService(name: string, cwd: string, args: string[], env: Record<string, string>, pids: number[], children: ChildProcess[]): ChildProcess {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), "w");
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", log, log],
    // Own process group, so teardown can signal everything the service started.
    detached: true,
  });
  fs.closeSync(log);
  if (child.pid === undefined) throw new Error(`${name} failed to start`);
  pids.push(child.pid);
  children.push(child);
  return child;
}

async function waitFor(name: string, url: string, child: ChildProcess) {
  const deadline = Date.now() + 90_000;
  let last: unknown = "no response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited with code ${child.exitCode}; see ${path.join(LOG_DIR, `${name}.log`)}`);
    try {
      const res = await fetch(url);
      await res.body?.cancel();
      if (res.status < 500) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`${name} did not become ready at ${url}: ${String(last)}`);
}

export default async function globalSetup(_config: FullConfig) {
  if (!fs.existsSync(path.join(WEB_DIR, "dist", "index.html"))) {
    throw new Error("apps/web/dist is missing. Run `npm run build` in apps/web first (CI does this in the e2e job).");
  }

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-e2e-"));
  const dataDir = path.join(runDir, "data");
  const state: RunState = { runDir, pids: [] };
  process.env[STATE_ENV] = JSON.stringify(state);
  const children: ChildProcess[] = [];

  try {
    // 1. Catalog input (fixture copy with e2e stream lists) and the guide, both in DATA_DIR.
    const catalogInput = path.join(runDir, "catalog-input");
    writeCatalogInput(catalogInput);
    writeGuide(path.join(dataDir, "epg", "guide.xml"));
    execFileSync(process.execPath, ["--import", "tsx", "setup/build-catalog.ts"], {
      cwd: E2E_ROOT,
      env: { ...process.env, DATA_DIR: dataDir, E2E_CATALOG_SOURCE: catalogInput },
      stdio: "inherit",
    });

    // 2. Fake HLS origin.
    const hls = startService("hls-origin", E2E_ROOT, [path.join(E2E_ROOT, "fixtures/hls-origin.mjs")], { HLS_PORT: String(HLS_PORT) }, state.pids, children);
    await waitFor("hls-origin", `http://127.0.0.1:${HLS_PORT}/healthz`, hls);

    // 3. API. IPTV_API_BASE points nowhere and offline-fetch blocks the mirror, so the startup ingest
    //    fails and keeps the fixture catalog. PROBE_ENABLED=false keeps the prober away from the fixtures.
    const api = startService(
      "api",
      API_DIR,
      ["--import", "tsx", "--import", path.join(E2E_ROOT, "setup/offline-fetch.mjs"), "src/server.ts"],
      {
        DATA_DIR: dataDir,
        PORT: String(API_PORT),
        PROXY_SECRET,
        PROBE_ENABLED: "false",
        IPTV_API_BASE: "http://127.0.0.1:1",
        INGEST_INTERVAL_HOURS: "0",
        LOG_LEVEL: "info",
      },
      state.pids,
      children,
    );
    await waitFor("api", `http://127.0.0.1:${API_PORT}/api/health`, api);

    // 4. Relay. PROXY_ALLOW_PRIVATE lets it reach the loopback HLS origin (dev-only switch).
    const proxy = startService(
      "proxy",
      PROXY_DIR,
      ["--import", "tsx", "src/main.ts"],
      { PORT: String(PROXY_PORT), PROXY_SECRET, PROXY_ALLOW_PRIVATE: "true", LOG_LEVEL: "info" },
      state.pids,
      children,
    );
    await waitFor("proxy", `http://127.0.0.1:${PROXY_PORT}/healthz`, proxy);

    // 5. Web: production build served by vite preview. Its proxy config forwards /api and /proxy.
    const web = startService(
      "web",
      WEB_DIR,
      [path.join(WEB_DIR, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
      {},
      state.pids,
      children,
    );
    await waitFor("web", `http://127.0.0.1:${WEB_PORT}/`, web);
    await waitFor("web-proxy", `http://127.0.0.1:${WEB_PORT}/api/health`, web);
  } catch (err) {
    for (const pid of state.pids) {
      try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
    }
    fs.rmSync(runDir, { recursive: true, force: true });
    throw err;
  }
  process.env[STATE_ENV] = JSON.stringify(state);
}
