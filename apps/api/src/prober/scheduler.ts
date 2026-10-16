// Selects streams to probe, runs them with a global rate limit, and writes results back in batches.
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { getDb, setMeta, type Db } from "../db/index.js";
import { placeholders } from "../lib/sql.js";
import { probeStream, type ProbeResult } from "./probe.js";

export type ProbeLog = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

export interface ProbeOpts {
  channels?: string[];
  limit?: number;
}

export interface ProbeCounts {
  checked: number;
  online: number;
  offline: number;
}

/** Results are written to the DB in transactions of this many. */
export const BATCH_SIZE = 50;
/** Offline streams with fewer consecutive failures than this are retried before healthy ones. */
export const RETRY_FIRST_FAILS = 5;
/** Streams with at least this many consecutive failures are dead: probed at most once per DEAD_BACKOFF_S. */
export const DEAD_FAIL_COUNT = 10;
export const DEAD_BACKOFF_S = 24 * 3600;

/**
 * Global token bucket: `ratePerSec` tokens per second, burst of up to one second's worth.
 * A rate <= 0 disables limiting.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.capacity = Math.max(1, ratePerSec);
    this.tokens = this.capacity;
    this.last = now();
  }

  async take(): Promise<void> {
    if (this.ratePerSec <= 0) return;
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000));
    }
  }
}

export interface Candidate {
  url: string;
  userAgent: string | null;
  referrer: string | null;
  /** 0 never probed, 1 offline with few failures, 2 everything else. */
  priority: number;
  lastChecked: number;
  /** Some stream row with this URL has a User-Agent or Referer: browsers cannot send those, so never browser-playable. */
  relayOnly: boolean;
}

interface SelectRow {
  url: string;
  user_agent: string | null;
  referrer: string | null;
  status: string | null;
  fail_count: number | null;
  last_checked: number | null;
}

/**
 * Every eligible distinct URL, in probe order: never probed, then offline with fewer than
 * RETRY_FIRST_FAILS failures, then oldest last check. Dead streams inside their backoff are skipped.
 * An empty or missing `channels` means all channels.
 */
export function selectTargets(db: Db, opts: ProbeOpts, now: number): Candidate[] {
  const params: unknown[] = [];
  let where = "";
  if (opts.channels && opts.channels.length > 0) {
    where = `WHERE s.channel IN (${placeholders(opts.channels.length)})`;
    params.push(...opts.channels);
  }
  const rows = db
    .prepare(
      `SELECT s.url AS url, s.user_agent AS user_agent, s.referrer AS referrer,
              h.status AS status, h.fail_count AS fail_count, h.last_checked AS last_checked
       FROM streams s LEFT JOIN stream_health h ON h.url = s.url ${where} ORDER BY s.id`,
    )
    .all(...params) as SelectRow[];

  // Several stream rows may share a URL; the first one (lowest id) supplies UA and Referer.
  const relayUrls = new Set(rows.filter((r) => r.user_agent || r.referrer).map((r) => r.url));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    const fails = r.fail_count ?? 0;
    const last = r.last_checked ?? 0;
    if (fails >= DEAD_FAIL_COUNT && last > now - DEAD_BACKOFF_S) continue;
    const priority = r.status === null ? 0 : r.status === "offline" && fails < RETRY_FIRST_FAILS ? 1 : 2;
    out.push({
      url: r.url,
      userAgent: r.user_agent,
      referrer: r.referrer,
      priority,
      lastChecked: last,
      relayOnly: relayUrls.has(r.url),
    });
  }
  out.sort((a, b) => a.priority - b.priority || a.lastChecked - b.lastChecked);
  return out;
}

export interface HealthState {
  status: "online" | "offline";
  fail_count: number;
  ok_count: number;
  last_online: number | null;
}

interface PrevHealth {
  status: string;
  fail_count: number;
  ok_count: number;
  last_online: number | null;
}

/**
 * Hysteresis. One success makes a stream online. A failure keeps a previously online stream online;
 * a second consecutive failure makes it offline. A stream never seen online with one failure is stored
 * as 'offline' with fail_count 1, which publishedStatus() reports as unknown (null).
 */
export function nextHealth(prev: PrevHealth | undefined, result: ProbeResult, now: number): HealthState {
  if (result.status === "online") {
    return { status: "online", fail_count: 0, ok_count: (prev?.ok_count ?? 0) + 1, last_online: now };
  }
  const fail_count = (prev?.fail_count ?? 0) + 1;
  const last_online = prev?.last_online ?? null;
  if (fail_count >= 2) return { status: "offline", fail_count, ok_count: 0, last_online };
  return { status: prev?.status === "online" ? "online" : "offline", fail_count, ok_count: 0, last_online };
}

/** What streams.status should say: online/offline once published, null while still unknown. */
export function publishedStatus(h: { status: string; fail_count: number }): "online" | "offline" | null {
  if (h.status === "online") return "online";
  return h.fail_count >= 2 ? "offline" : null;
}

/** Browser flag for a result: relay-only streams are always 0; otherwise null (keep the stored value) when the probe failed. */
function browserValue(relayOnly: boolean, browserOk: boolean | null): number | null {
  if (relayOnly) return 0;
  return browserOk === null ? null : browserOk ? 1 : 0;
}

export interface ApplyItem {
  url: string;
  result: ProbeResult;
  relayOnly?: boolean;
}

export function applyResults(db: Db, batch: ApplyItem[], now: number): void {
  const readPrev = db.prepare("SELECT status, fail_count, ok_count, last_online FROM stream_health WHERE url = ?");
  // A null browser value (failed probe) keeps the stored one: COALESCE picks the old value.
  const upsert = db.prepare(`
    INSERT INTO stream_health (url, status, http_status, latency_ms, fail_count, ok_count, last_checked, last_online, error, browser_ok)
    VALUES (@url, @status, @http, @latency, @fail, @ok, @now, @lastOnline, @error, @browser)
    ON CONFLICT(url) DO UPDATE SET status = excluded.status, http_status = excluded.http_status,
      latency_ms = excluded.latency_ms, fail_count = excluded.fail_count, ok_count = excluded.ok_count,
      last_checked = excluded.last_checked, last_online = excluded.last_online, error = excluded.error,
      browser_ok = COALESCE(excluded.browser_ok, stream_health.browser_ok)`);
  const mirror = db.prepare(
    `UPDATE streams SET status = @published, last_checked = @now,
       browser_ok = (SELECT h.browser_ok FROM stream_health h WHERE h.url = streams.url)
     WHERE url = @url`,
  );
  const channelsOf = db.prepare("SELECT DISTINCT channel FROM streams WHERE url = ?");
  // Same denormalisation as ingest (build.ts): channels.last_checked backs sort=updated, browser_count backs playable.
  const recount = db.prepare(
    `UPDATE channels SET online_count = (SELECT COUNT(*) FROM streams s WHERE s.channel = channels.id AND s.status = 'online'),
       last_checked = (SELECT MAX(s.last_checked) FROM streams s WHERE s.channel = channels.id),
       browser_count = (SELECT COUNT(*) FROM streams s WHERE s.channel = channels.id AND s.browser_ok = 1)
     WHERE id = ?`,
  );

  db.transaction(() => {
    const affected = new Set<string>();
    for (const { url, result, relayOnly = false } of batch) {
      const prev = readPrev.get(url) as PrevHealth | undefined;
      const next = nextHealth(prev, result, now);
      upsert.run({
        url,
        status: next.status,
        http: result.httpStatus,
        latency: result.latencyMs,
        fail: next.fail_count,
        ok: next.ok_count,
        now,
        lastOnline: next.last_online,
        error: result.error,
        browser: browserValue(relayOnly, result.browserOk),
      });
      mirror.run({ url, published: publishedStatus(next), now });
      for (const row of channelsOf.all(url) as Array<{ channel: string }>) affected.add(row.channel);
    }
    for (const id of affected) recount.run(id);
  }).immediate();
}

/**
 * Enforces the relay rule across the whole catalog: a URL with a User-Agent or Referer on any stream row
 * is browser_ok = 0 in stream_health (which ingest copies back to streams) and in streams, and the
 * affected channels' browser_count is recomputed. Covers rows that were never probed, e.g. after an ingest.
 */
export function enforceRelayOnly(db: Db): void {
  const relayUrls = "SELECT url FROM streams WHERE user_agent IS NOT NULL OR referrer IS NOT NULL";
  const stale = "(browser_ok IS NULL OR browser_ok != 0)";
  db.transaction(() => {
    const channels = db
      .prepare(`SELECT DISTINCT channel FROM streams WHERE url IN (${relayUrls}) AND ${stale}`)
      .all() as Array<{ channel: string }>;
    if (channels.length === 0) return;
    db.prepare(`UPDATE stream_health SET browser_ok = 0 WHERE url IN (${relayUrls}) AND (browser_ok IS NULL OR browser_ok != 0)`).run();
    db.prepare(`UPDATE streams SET browser_ok = 0 WHERE url IN (${relayUrls}) AND ${stale}`).run();
    const recount = db.prepare(
      "UPDATE channels SET browser_count = (SELECT COUNT(*) FROM streams s WHERE s.channel = channels.id AND s.browser_ok = 1) WHERE id = ?",
    );
    for (const { channel } of channels) recount.run(channel);
  }).immediate();
}

/** Streams to probe this run when no explicit limit is given: what fits in one interval at the configured rate. */
export function defaultBudget(rate: number, intervalHours: number): number {
  return rate > 0 && intervalHours > 0 ? Math.floor(rate * 3600 * intervalHours) : Number.POSITIVE_INFINITY;
}

let inflight: Promise<ProbeCounts> | null = null;

export function isProbeRunning(): boolean {
  return inflight !== null;
}

/** Runs one probe pass. A call while a pass is running returns that pass's promise. */
export function runProbe(log?: ProbeLog, opts: ProbeOpts = {}): Promise<ProbeCounts> {
  if (inflight) return inflight;
  inflight = execute(log, opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function execute(log: ProbeLog | undefined, opts: ProbeOpts): Promise<ProbeCounts> {
  const db = getDb();
  const started = Date.now();
  const nowSec = Math.floor(started / 1000);
  const rate = config.probeRatePerSecond;
  const eligible = selectTargets(db, opts, nowSec);
  const budget = defaultBudget(rate, config.probeIntervalHours);
  const requested = opts.limit && opts.limit > 0 ? opts.limit : budget;
  const targets = eligible.slice(0, Math.min(eligible.length, requested));

  const counts: ProbeCounts = { checked: 0, online: 0, offline: 0 };
  const bucket = new TokenBucket(rate);
  let cursor = 0;
  let pending: ApplyItem[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    applyResults(db, pending, Math.floor(Date.now() / 1000));
    pending = [];
  };

  const worker = async () => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      await bucket.take();
      const row = await probeOne(target);
      counts.checked++;
      if (row.status === "online") counts.online++;
      else counts.offline++;
      pending.push({ url: target.url, result: row, relayOnly: target.relayOnly });
      if (pending.length >= BATCH_SIZE) flush();
    }
  };
  const workers = Math.max(1, Math.min(config.probeConcurrency, targets.length));
  await Promise.all(Array.from({ length: workers }, worker));
  flush();
  enforceRelayOnly(db);

  const finished = Date.now();
  const elapsedMs = finished - started;
  setMeta("last_probe", Math.floor(finished / 1000));
  setMeta("last_probe_ms", elapsedMs);
  setMeta("last_probe_counts", JSON.stringify(counts));
  log?.info(
    `prober: checked ${counts.checked} of ${eligible.length} eligible streams in ${elapsedMs} ms ` +
      `(${counts.online} online, ${counts.offline} offline; rate ${rate}/s, concurrency ${workers})`,
  );
  return counts;
}

function probeOne(t: Candidate): Promise<ProbeResult> {
  return probeStream(t.url, { userAgent: t.userAgent, referrer: t.referrer, timeoutMs: config.probeTimeoutMs });
}
