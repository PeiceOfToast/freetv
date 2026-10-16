# Review fixes, track A (2026-10-16 review items 2.1, 2.8, 3.5, 4.2, 4.3)

Items come from `docs/REVIEW-2026-10-16.md`; full reasoning in `docs/notes/review-2026-10-16-full.md`.
Status column in REVIEW is for the integrator to flip. Nothing committed.

## What changed

**2.1 Local blocklist and forced ingest** (`apps/api/src/ingest/index.ts`, `server.ts`)
- `runIngest(log, { force })`. `force` rebuilds even when nothing changed. `POST /api/admin/ingest` passes `force: true`.
- The local blocklist's fingerprint (mtime and size, or `absent`) is stored in meta key `local_blocklist_fp` after each
  successful build. A scheduled run rebuilds when it differs, so a blocklist edit or delete applies at the next tick
  (`INGEST_INTERVAL_HOURS`) even if upstream is unchanged. The fingerprint is taken before the build, so an edit made
  during a build is picked up on the next run.
- Consequence on first boot after this deploy: the key is absent, so one extra rebuild (about 3 to 9 s). Expected.
- Reproduced first: `test/ingest-blocklist.test.ts` failed on the unfixed code (scheduled run with unchanged datasets left
  BBCNews.uk at 200). It uses a local dataset server that answers 304, so the "unchanged" path is real.
- The docs (`OPERATIONS.md` "Blocking a channel", `LEGAL.md`) already describe this behaviour, so no wording change was needed.
- `localBlocklistPath()` in index.ts duplicates the default path logic of `readLocalBlocklist()` in `ingest/build.ts`
  (not on my edit list). Keep the two in step.

**2.8 Admin status** (`routes/admin.ts`)
- `catalog.lastIngestMs` reads meta `last_ingest_ms` (the rebuild duration).
- `catalog.source` is unchanged: it comes from the ETag store (`raw/etags.json`, `channels.source`). Tested for primary, mirror and unknown.

**3.5 Admin token and shutdown** (`routes/admin.ts`, `server.ts`)
- `bearerTokenOk(header, token)` is exported from `routes/admin.ts` and used by both the status/metrics routes and the
  POST admin routes. It hashes both sides with SHA-256 before `timingSafeEqual`, so length does not leak. An empty token never matches.
  (The helper lives in routes/admin.ts, not lib/http.ts, because lib/http.ts is not on this track's edit list.)
- `installShutdown(app)` on SIGTERM and SIGINT: `app.close()` (drains in-flight requests), then `closeLogoCache()`
  (flushes the index, which in-flight logo requests may have updated), then `closeDb()`, then exit 0. Exit 1 if close fails.
  A repeated signal logs "ignored". Startup is otherwise unchanged (one added line).
- Not done here, by design: the Dockerfile `USER` change (another track).

**4.2 sort=updated** (`lib/channel-query.ts`, `prober/scheduler.ts`)
- `ORDER BY COALESCE(c.last_checked, 0)` replaces the correlated `MAX(streams.last_checked)` subquery.
- The prober's `applyResults` recount now also sets `channels.last_checked = MAX(streams.last_checked)`, the same
  denormalisation ingest does in `build.ts`.
- No index added: `schema.sql` is frozen. Measured on a synthetic 31k-channel catalog (16k with streams, default filters,
  scratch script in the session scratchpad): page 1 (limit 60) 31.2 ms old, 2.3 ms new; page 50 22.8 ms old, 13.5 ms new; full sort
  34.5 ms old, 16.1 ms new. Output identical. The new query is a temp B-tree sort over the filtered set, which is cheap at this size.

**4.3 Caching** (`routes/catalog.ts`, `routes/admin.ts`)
- `/api/meta` body cached 15 s (`META_TTL_MS`). `resetMetaCache()` exported for tests.
- `/metrics` gauge values cached 15 s (`GAUGE_TTL_MS`, `gaugeValues()`). `resetMetricsCache()` exported for tests.
  Only gauges are cached. The HTTP request counters and histograms stay live.
- Time-based only. Invalidation on ingest, EPG import or probe would have needed cross-module calls, so it was skipped.
  Freshness lag is up to 15 s.
- Tests that change config or DB under the cache now reset it first (`routes-catalog` proxyEnabled test, `prober-run` meta test).

## Tests added
- `test/ingest-blocklist.test.ts` (6): first run; scheduled run applies a new blocklist entry; removing the file unblocks;
  nothing changed means no rebuild; `force` rebuilds; `POST /api/admin/ingest` rebuilds, and 401 without token.
- `test/admin.test.ts` (+5): lastIngestMs equals the recorded meta value; source primary, mirror, unknown, missing;
  `bearerTokenOk` cases; gauge cache window with a mocked clock.
- `test/routes-catalog.test.ts` (+2): `/api/meta` cache window; `sort=updated` newest-first and asc (paged) order, NULL as 0.
- `test/prober-run.test.ts` (+1): `channels.last_checked` equals the newest stream check after probe passes.

## Verification
- `npm test` and `npm run typecheck` were run in a clean snapshot (`git archive HEAD apps/api` plus only this track's
  files). Result: typecheck clean; 204 of 204 pass (190 at baseline, +14 new).
- In the live working tree, other tracks' in-progress edits broke things outside this track. Their failures are not caused by this change:
  - `prober-run` fails because `prober/probe.ts` now calls `guardedFetch` (new `lib/ssrf.ts`, 3.4 track), which refuses the
    loopback fixture server. Every stream reads offline. Passes in the HEAD snapshot.
  - `logo` suites fail from `lib/logo-cache.ts` edits (other track).
  - `routes-catalog` "ChannelDetail ... signed proxy URLs" fails from `lib/sign.ts`/`views.ts` edits (other track). Passes in the snapshot.
  - Typecheck errors: `src/lib/ssrf.ts` (`lookup` on undici BuildOptions) and `src/routes/export.ts`, both other tracks.
- Shutdown checked by running the real server in the snapshot: SIGTERM exit 0, SIGINT exit 0, port closed, log line
  "SIGTERM: shutting down". A second signal sent back-to-back after the first produced no "ignored" log line (the process
  exited first), so the repeated-signal guard is in the code but I did not see it fire.

## Not in scope, noticed
- `docs/DEPLOY.md` says the proxy has no `/metrics` (it does). `docs/ARCHITECTURE.md` lists `EPG_FILE` for epg. Item 2.8 covers both; not on my list.
- `REVIEW-2026-10-16.md` status column is not updated here (integrator).
