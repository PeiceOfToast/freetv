# Track P: stream health prober (notes)

Owns `apps/api/src/prober/**`, `apps/api/test/prober*.test.ts`, `apps/api/test/prober-server.ts`, and
the prober parts of `routes/catalog.ts` (detail ordering, `relayOnly`, `/api/meta` health).

## What was built

- `src/prober/probe.ts`: `probeStream(url, {userAgent, referrer, timeoutMs})` returns
  `{status, httpStatus, latencyMs, error}`. GET (no Range), UA/Referer from the stream row, up to 5
  redirects followed manually, 64 KB read then cancel, one overall timeout (default 10 s). Never throws.
  Online = 2xx and `#EXTM3U` body (for `.m3u8` URLs), or for other URLs a media content type
  (`video/mp2t`, `video/mp4`, `*mpegurl*`, `application/octet-stream`) with at least one byte. A master
  playlist with `#EXT-X-STREAM-INF` and zero variant lines is offline. Only http/https is probed.
- `src/prober/scheduler.ts`: target selection, token bucket, hysteresis, batched writes, meta keys.
  - Order: never probed, then offline with fewer than 5 consecutive failures, then oldest `last_checked`.
    Several `streams` rows can share a URL; they are probed once, with the lowest id's UA/Referer.
  - Dead streams (fail_count >= 10) are skipped unless `last_checked` is more than 24 h old.
  - Default limit = `PROBE_RATE_PER_SECOND * 3600 * PROBE_INTERVAL_HOURS` (108,000 at defaults), capped
    at the eligible count. The whole catalog (about 16k streams) fits in one interval at the default rate.
  - Global token bucket at `PROBE_RATE_PER_SECOND` (burst of one second's worth), `PROBE_CONCURRENCY`
    workers. Results are written every 50 in one transaction.
  - Single flight: `runProbe` during a pass returns the same promise. `isProbeRunning()` reports it.
  - Meta keys: `last_probe` (unix s), `last_probe_ms`, `last_probe_counts` (`{checked, online, offline}`,
    probe verdicts for that pass).
- `src/prober/index.ts`: keeps the stub's exports (`runProbe`, `startProber`, `Log`) and adds
  `isProbeRunning`, `probeStream`. `startProber` waits 2 minutes after boot, runs, then repeats every
  `PROBE_INTERVAL_HOURS`, all timers unref'd. Does nothing when `PROBE_ENABLED` is false.
- `routes/catalog.ts`: detail streams are ordered in SQL by status (online, unknown, offline), then
  https before http, then `quality_rank` desc, then `idx`. `index` stays the catalog `idx`.
  `relayOnly = relayOnlyOf(user_agent, referrer)`. `/api/meta` gains
  `health: {probed, online, lastProbe}`.

## Hysteresis and the "unknown" state

`stream_health.status` is NOT NULL, so it cannot say "unknown". A stream never seen online that fails
once is stored as `status='offline', fail_count=1`. It is published to `streams.status` as NULL
(`publishedStatus()`), so the API shows unknown. The published offline state needs `fail_count >= 2`.
A previously online stream stores `status='online'` through its first failure. This keeps the spec's
"one failure keeps online, two flip it" rule.

Published invariant: `published = online` if status = 'online'; `offline` if status = 'offline' and
fail_count >= 2; NULL otherwise.

## REQUIRED integrator changes (outside this track)

1. `src/ingest/build.ts`, the end-of-transaction re-apply, copies `h.status` raw. After the next ingest,
   every pending row (status 'offline', fail_count 1) would show as offline on `streams`, and
   `/api/meta` would count it as probed. Use the same rule there:
   ```sql
   UPDATE streams SET
     status = (SELECT CASE WHEN h.status = 'offline' AND h.fail_count < 2 THEN NULL ELSE h.status END
               FROM stream_health h WHERE h.url = streams.url),
     last_checked = (SELECT h.last_checked FROM stream_health h WHERE h.url = streams.url)
   WHERE url IN (SELECT url FROM stream_health);
   ```
   The `schema.sql` comment on `stream_health.status` should say the same. Schema is frozen, so this
   needs a sign-off.
2. No test change is needed in `test/routes-catalog.test.ts`. The index-equals-position assertion still
   holds, because `idx` already sorts https, then quality, then file order, which matches the new SQL
   order when every status is NULL. Full suite: 134 of 134 pass.
3. `docs/API.md` says the stream is probed "reading only the first few KB" and is "most-popular first".
   The implementation reads at most 64 KB and orders by never-probed, then retry, then oldest check, with
   no popularity signal. Update the text or accept the difference.

## Findings to decide on

- DASH: 221 of 16,042 streams (1.4%) are `.mpd`. Under the spec's rule (content type only), they are
  offline even when healthy, and BBC News has several. Suggest a spec amendment: a body containing
  `<MPD` counts as online for `.mpd` URLs. Not implemented, because the spec does not allow it.
- 976 streams have a UA or Referer. They are probed with them. Browsers cannot send these, so the detail
  route marks them `relayOnly`.
- Rate: at 5/s a full catalog pass (16,042 streams) takes about 53 minutes, plus timeouts for slow
  hosts. Repeats every 6 hours at default settings.

## Real pass (sandbox, `DATA_DIR=apps/api/.data`, limit 40)

- `runProbe(console, {limit: 40})`: checked 40, online 0, offline 40, wall time 16,993 ms (rate 5/s,
  concurrency 8). Starts are spaced by the bucket. The 17 s includes the last 10 s timeouts.
- Error kinds: `fetch failed` (DNS or refused) 33, `HTTP 403` 4, `timeout after 10000 ms` 3.
- `stream_health` gained 40 rows. All are pending (fail_count 1), so no `streams.status` changed. That
  is the hysteresis working as designed. The second pass will publish them.

## Test coverage

- `test/prober-probe.test.ts` (16 tests): unit tests against each fixture endpoint in `prober-server.ts`
  (valid, master with variants, empty master, 404, 503, slow, redirect, redirect loop, UA check, Referer,
  media bytes, empty media, HTML login page, refused, bad schemes, DNS).
- `test/prober-run.test.ts` (14 tests): the BBC fixture channel with seven rewritten URLs. It covers
  pending then published offline, online kept through one failure and flipped by the second, recovery,
  selection order, dead-stream backoff, single flight, meta keys, detail ordering and `relayOnly`,
  `online=true`, `/api/meta` health, rebuild re-applying health by URL, and the token bucket and
  hysteresis functions directly.
- `npm run typecheck` clean. `npm test`: 134 of 134.
