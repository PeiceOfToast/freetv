import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { openDb, closeDb, type Db } from "../src/db/index.js";
import { buildCatalogFromDir } from "../src/ingest/index.js";
import { buildServer } from "../src/server.js";
import { isProbeRunning, runProbe } from "../src/prober/index.js";
import { selectTargets, nextHealth, publishedStatus, TokenBucket } from "../src/prober/scheduler.js";
import { startFixtureServer, UA_REQUIRED, type FixtureServer } from "./prober-server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const BBC = "BBCNews.uk";

config.logLevel = "silent";
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.proxyPublicPath = "/proxy";
config.hideNsfwDefault = true;
config.probeRatePerSecond = 100;
config.probeConcurrency = 4;
config.probeTimeoutMs = 400;
config.probeIntervalHours = 6;

describe("stream prober: runs, hysteresis and routes", () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let srv: FixtureServer;
  // Seven BBC streams, one per scenario, in id order.
  const ids: number[] = [];
  const names = ["valid", "notFound", "slow", "master", "uaCheck", "flaky", "redirect"] as const;
  const scenario = (name: (typeof names)[number]) => ids[names.indexOf(name)];
  const healthOf = (url: string) =>
    db.prepare("SELECT status, fail_count, ok_count FROM stream_health WHERE url = ?").get(url) as
      | { status: string; fail_count: number; ok_count: number }
      | undefined;
  const streamStatus = (id: number) =>
    (db.prepare("SELECT status FROM streams WHERE id = ?").get(id) as { status: string | null }).status;
  const onlineCount = (channel: string) =>
    (db.prepare("SELECT online_count AS n FROM channels WHERE id = ?").get(channel) as { n: number }).n;
  const pass = (limit = 7) => runProbe(undefined, { channels: [BBC], limit });
  const get = (url: string) => app.inject({ method: "GET", url });
  const json = <T = any>(res: { body: string }) => JSON.parse(res.body) as T;

  before(async () => {
    srv = await startFixtureServer();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-prober-run-"));
    db = openDb(path.join(dir, "catalog.db"));
    buildCatalogFromDir(db, fixtures);

    const keep = (db.prepare("SELECT id FROM streams WHERE channel = ? ORDER BY id LIMIT 7").all(BBC) as Array<{ id: number }>).map(
      (r) => r.id,
    );
    ids.push(...keep);
    db.prepare(`DELETE FROM streams WHERE channel = ? AND id NOT IN (${keep.map(() => "?").join(",")})`).run(BBC, ...keep);

    const urls: Record<(typeof names)[number], string> = {
      valid: `${srv.base}/valid.m3u8`,
      notFound: `${srv.base}/not-found.m3u8`,
      slow: `${srv.base}/slow.m3u8`,
      master: `${srv.base}/master.m3u8`,
      uaCheck: `${srv.base}/ua-check.m3u8`,
      flaky: `${srv.base}/flaky.m3u8`,
      redirect: `${srv.base}/redirect.m3u8`,
    };
    names.forEach((n, i) => {
      db.prepare("UPDATE streams SET url = ? WHERE id = ?").run(urls[n], keep[i]);
    });
    db.prepare("UPDATE streams SET user_agent = ? WHERE id = ?").run(UA_REQUIRED, scenario("uaCheck"));

    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("first pass: one success publishes online, one failure stays unknown", async () => {
    const counts = await pass();
    assert.deepEqual(counts, { checked: 7, online: 5, offline: 2 });

    assert.equal(streamStatus(scenario("valid")), "online");
    assert.equal(streamStatus(scenario("master")), "online");
    assert.equal(streamStatus(scenario("uaCheck")), "online", "probed with the stream's own UA");
    assert.equal(streamStatus(scenario("redirect")), "online");
    assert.equal(streamStatus(scenario("flaky")), "online");
    assert.equal(streamStatus(scenario("notFound")), null, "one failure is not yet a published offline");
    assert.equal(streamStatus(scenario("slow")), null);

    const nf = healthOf(`${srv.base}/not-found.m3u8`);
    assert.deepEqual({ status: nf?.status, fail: nf?.fail_count }, { status: "offline", fail: 1 });
    assert.equal(onlineCount(BBC), 5);
  });

  test("second consecutive failure publishes offline", async () => {
    srv.setFlaky(true);
    const counts = await pass();
    assert.deepEqual(counts, { checked: 7, online: 4, offline: 3 });
    assert.equal(streamStatus(scenario("notFound")), "offline");
    assert.equal(streamStatus(scenario("slow")), "offline");
    assert.equal(streamStatus(scenario("valid")), "online");
  });

  test("hysteresis: one failure keeps an online stream online, the second flips it", async () => {
    const url = `${srv.base}/flaky.m3u8`;
    assert.equal(streamStatus(scenario("flaky")), "online", "still online after one failure");
    assert.equal(healthOf(url)?.fail_count, 1);
    assert.equal(onlineCount(BBC), 5);

    await pass();
    assert.equal(streamStatus(scenario("flaky")), "offline", "second consecutive failure");
    assert.equal(healthOf(url)?.fail_count, 2);
    assert.equal(onlineCount(BBC), 4, "channels.online_count follows the mirror");
  });

  test("one success brings an offline stream back online and resets the failure count", async () => {
    srv.setFlaky(false);
    await pass();
    assert.equal(streamStatus(scenario("flaky")), "online");
    const h = healthOf(`${srv.base}/flaky.m3u8`);
    assert.deepEqual({ fail: h?.fail_count, ok: h?.ok_count }, { fail: 0, ok: 1 });
    assert.equal(onlineCount(BBC), 5);
  });

  test("selection puts never-probed, then offline with few failures, then the rest first", () => {
    const now = Math.floor(Date.now() / 1000);
    const order = selectTargets(db, { channels: [BBC] }, now).map((t) => t.url);
    const offlineNow = [`${srv.base}/not-found.m3u8`, `${srv.base}/slow.m3u8`];
    assert.deepEqual(order.slice(0, 2).sort(), [...offlineNow].sort());
    assert.equal(order.length, 7);
  });

  test("dead streams (10+ failures) are skipped until 24 h have passed", async () => {
    const nf = `${srv.base}/not-found.m3u8`;
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE stream_health SET fail_count = 10, last_checked = ? WHERE url = ?").run(now, nf);
    const skipped = await pass();
    assert.equal(skipped.checked, 6, "the dead stream was not probed");

    db.prepare("UPDATE stream_health SET last_checked = ? WHERE url = ?").run(now - 86_401, nf);
    const retried = await pass();
    assert.equal(retried.checked, 7, "probed again after the backoff");
    assert.equal(healthOf(nf)?.fail_count, 11);
  });

  test("a second runProbe while one is running returns the same pass", async () => {
    const p1 = runProbe(undefined, { channels: [BBC], limit: 3 });
    const p2 = runProbe(undefined, { channels: [BBC], limit: 3 });
    assert.equal(p1, p2);
    assert.equal(isProbeRunning(), true);
    const counts = await p1;
    assert.equal(counts.checked, 3);
    assert.equal(isProbeRunning(), false);
  });

  test("meta keys record the last pass", () => {
    const meta = (k: string) => (db.prepare("SELECT value FROM meta WHERE key = ?").get(k) as { value: string } | undefined)?.value;
    assert.ok(Number(meta("last_probe")) > 0);
    assert.ok(Number(meta("last_probe_ms")) >= 0);
    const c = JSON.parse(meta("last_probe_counts") ?? "{}");
    assert.equal(typeof c.checked, "number");
    assert.equal(c.checked, c.online + c.offline);
  });

  test("channel detail orders online first, then unknown, then offline, and sets relayOnly", async () => {
    const res = await get(`/api/channels/${BBC}`);
    assert.equal(res.statusCode, 200);
    const streams = json(res).streams as Array<{ online: boolean | null; index: number; relayOnly: boolean; url: string }>;
    const rank = (o: boolean | null) => (o === true ? 0 : o === null ? 1 : 2);
    const ranks = streams.map((s) => rank(s.online));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "grouped online, null, offline");
    assert.equal(streams.filter((s) => s.online === true).length, 5);
    assert.equal(streams.at(-1)?.online, false);
    assert.equal(new Set(streams.map((s) => s.index)).size, streams.length, "index stays the stable catalog index");
    const ua = streams.find((s) => s.url === `${srv.base}/ua-check.m3u8`);
    assert.equal(ua?.relayOnly, true);
    assert.equal(streams.find((s) => s.url === `${srv.base}/valid.m3u8`)?.relayOnly, false);
  });

  test("online=true returns only channels with a healthy stream", async () => {
    const body = json(await get("/api/channels?online=true&limit=200"));
    assert.ok(body.items.some((i: { id: string }) => i.id === BBC));
    assert.ok(body.items.every((i: { online: boolean }) => i.online === true));
  });

  test("/api/meta reports the health summary", async () => {
    const m = json(await get("/api/meta"));
    const probed = (db.prepare("SELECT COUNT(*) AS n FROM streams WHERE status IS NOT NULL").get() as { n: number }).n;
    const online = (db.prepare("SELECT COUNT(*) AS n FROM streams WHERE status = 'online'").get() as { n: number }).n;
    assert.deepEqual(m.health, { probed, online, lastProbe: m.health.lastProbe });
    assert.equal(typeof m.health.lastProbe, "number");
  });

  test("a rebuilt catalog re-applies stored health onto streams by URL", async () => {
    const url = (db.prepare("SELECT url FROM streams WHERE channel = 'CNN.us' LIMIT 1").get() as { url: string }).url;
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "INSERT INTO stream_health (url, status, fail_count, ok_count, last_checked, last_online) VALUES (?, 'online', 0, 3, ?, ?)",
    ).run(url, now, now);
    buildCatalogFromDir(db, fixtures);
    const row = db.prepare("SELECT status, last_checked FROM streams WHERE url = ?").get(url) as {
      status: string | null;
      last_checked: number | null;
    };
    assert.equal(row.status, "online");
    assert.equal(row.last_checked, now);
  });
});

describe("prober building blocks", () => {
  test("token bucket allows a burst of one second's rate, then spaces calls", async () => {
    const bucket = new TokenBucket(20);
    const started = Date.now();
    for (let i = 0; i < 30; i++) await bucket.take();
    const took = Date.now() - started;
    assert.ok(took >= 400, `30 takes at 20/s with a burst of 20 finished in ${took} ms`);
    assert.ok(took < 2000, `took ${took} ms`);
  });

  test("hysteresis: first failure is unknown, two failures are offline, success is online", () => {
    const fail = { status: "online", fail_count: 0, ok_count: 0, last_online: null } as const;
    const pending = nextHealth(undefined, { status: "offline", httpStatus: 404, latencyMs: 1, error: "x" }, 100);
    assert.equal(publishedStatus(pending), null);
    const offline = nextHealth(pending, { status: "offline", httpStatus: 404, latencyMs: 1, error: "x" }, 200);
    assert.equal(publishedStatus(offline), "offline");
    const back = nextHealth(offline, { status: "online", httpStatus: 200, latencyMs: 1, error: null }, 300);
    assert.equal(publishedStatus(back), "online");
    assert.equal(back.last_online, 300);
    const kept = nextHealth(fail, { status: "offline", httpStatus: 500, latencyMs: 1, error: "x" }, 400);
    assert.equal(publishedStatus(kept), "online");
  });
});
