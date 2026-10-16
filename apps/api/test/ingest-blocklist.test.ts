import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb, getDb } from "../src/db/index.js";
import { buildServer } from "../src/server.js";
import { runIngest } from "../src/ingest/index.js";
import { DATASETS } from "../src/ingest/build.js";

// End-to-end ingest against a local dataset server: first run downloads, later runs get 304 (datasets
// unchanged). The local blocklist must still take effect on those runs.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const BBC = "BBCNews.uk";

config.logLevel = "silent";

/** Serves fixtures/<name>.json with a stable ETag and answers If-None-Match with 304. */
function startDatasetServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const name = (req.url ?? "").replace(/^\//, "").replace(/\.json$/, "");
    const file = path.join(fixtures, `${name}.json`);
    if (!(DATASETS as readonly string[]).includes(name) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const etag = `"${name}-v1"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag }).end();
      return;
    }
    res.writeHead(200, { etag, "content-type": "application/json" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("local blocklist applies on ingest runs with unchanged upstream datasets", () => {
  let dir: string;
  let ds: { url: string; close: () => Promise<void> };
  let app: FastifyInstance;
  let savedDataDir: string;
  let savedBase: string;
  let savedMirror: string;
  let savedEnv: string | undefined;
  let savedToken: string;
  const blocklistFile = () => path.join(dir, "local-blocklist.json");

  const detail = (id: string) => app.inject({ method: "GET", url: `/api/channels/${encodeURIComponent(id)}` });
  const nameOf = (id: string) => (getDb().prepare("SELECT name FROM channels WHERE id = ?").get(id) as { name: string }).name;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-ingest-blocklist-"));
    ds = await startDatasetServer();
    savedDataDir = config.dataDir;
    savedBase = config.iptvApiBase;
    savedMirror = config.iptvApiMirror;
    savedEnv = process.env.LOCAL_BLOCKLIST;
    savedToken = config.adminToken;
    config.adminToken = "ingest-test-token";
    config.dataDir = dir;
    config.iptvApiBase = ds.url;
    config.iptvApiMirror = ds.url;
    process.env.LOCAL_BLOCKLIST = blocklistFile();
    openDb(path.join(dir, "catalog.db"));
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
    await ds.close();
    config.dataDir = savedDataDir;
    config.adminToken = savedToken;
    config.iptvApiBase = savedBase;
    config.iptvApiMirror = savedMirror;
    if (savedEnv === undefined) delete process.env.LOCAL_BLOCKLIST;
    else process.env.LOCAL_BLOCKLIST = savedEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("first run downloads and builds the catalog; BBC is visible", async () => {
    await runIngest();
    assert.equal((await detail(BBC)).statusCode, 200);
  });

  test("a scheduled run with unchanged datasets applies a new local blocklist entry", async () => {
    fs.writeFileSync(blocklistFile(), JSON.stringify([BBC]));
    await runIngest();
    assert.equal((await detail(BBC)).statusCode, 404);
  });

  test("removing the blocklist file on a later run unblocks the channel", async () => {
    fs.rmSync(blocklistFile());
    await runIngest();
    assert.equal((await detail(BBC)).statusCode, 200);
  });

  test("with nothing changed, a scheduled run does not rebuild", async () => {
    getDb().prepare("UPDATE channels SET name = 'TAMPERED' WHERE id = ?").run(BBC);
    await runIngest();
    assert.equal(nameOf(BBC), "TAMPERED");
  });

  test("a forced run rebuilds even when datasets and the blocklist are unchanged", async () => {
    await runIngest(undefined, { force: true });
    assert.notEqual(nameOf(BBC), "TAMPERED");
  });

  test("POST /api/admin/ingest rebuilds even when nothing changed", async () => {
    getDb().prepare("UPDATE channels SET name = 'TAMPERED' WHERE id = ?").run(BBC);
    const unauth = await app.inject({ method: "POST", url: "/api/admin/ingest" });
    assert.equal(unauth.statusCode, 401);
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/ingest",
      headers: { authorization: `Bearer ${config.adminToken}` },
    });
    assert.equal(res.statusCode, 202);
    await runIngest(); // queued behind the endpoint's run, so this resolves after it
    assert.notEqual(nameOf(BBC), "TAMPERED");
  });
});
