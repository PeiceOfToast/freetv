# Review fixes F: item 3.1 (event-loop stalls on ingest and EPG)

Source: docs/notes/review-2026-10-16-full.md, item 3.1. Scope: apps/api only. Nothing committed.

## Problem

`buildCatalog` (2–7 s) and the EPG parse plus swap (1–10 s at all-sites scale) ran on the Fastify event
loop. Every request stalled, including the 5 s health check.

## What changed

**Workers** (new files)
- `apps/api/src/ingest/worker.ts`: opens its own connection (`openWorkerConnection`) to the catalog file and
  runs the existing `buildCatalog`. Posts `done` with the stats, or `fail` with the message.
- `apps/api/src/epg/worker.ts`: staging table, SAX parse in 5000-row batches, swap in one `IMMEDIATE`
  transaction, `DROP` of the staging table, `incremental_vacuum` when enabled, and `wal_checkpoint(TRUNCATE)`.
  Posts `done` with `{programmes, ms}`, or `fail`.
- `apps/api/src/lib/worker.ts`: `runWorker(entry, data, log)` spawns the worker, forwards its `log` messages to
  the Fastify logger, and resolves on `done`. It rejects on `fail`, on an uncaught error in the worker, or on an
  exit without a result. None of these take the process down.

**Main thread**
- `ingest/index.ts`: `ingestOnce` calls `buildCatalogInWorker` instead of `buildCatalog`, then sets the blocklist
  fingerprint and calls `resetMetaCache()`. `runIngest`, `scheduleIngest` and the run queue are unchanged.
- `epg/importer.ts`: `doImport` keeps the file stat and the mtime/size check. It calls the worker, then
  `resetMetaCache()`, logs, and writes `guide.xml.gz` (async, streamed). `importEpg`, `startEpgWatcher` and
  `guideGzPath` are unchanged.
- `ingest/build.ts`: `BuildStats` gains `writeMs`, the time the write lock was held. Nothing else changed.

**Database** (`db/index.ts`, additive)
- `openDb` sets `busy_timeout = 5000`.
- `openWorkerConnection(path)`: a second connection with `busy_timeout`, `synchronous = NORMAL` and
  `foreign_keys = OFF`. It does no schema work, because the main thread has already migrated the file.

**Build and packaging**
- No Dockerfile change was needed. `tsc` emits `dist/ingest/worker.js` and `dist/epg/worker.js`, and the
  Dockerfile already copies all of `dist/`. The workers do not read `schema.sql`.
- No `package.json` change.

## Decisions and deviations

- **Checkpoint runs in the worker, not on the main thread.** The brief asked for the main thread to run
  `wal_checkpoint`. A TRUNCATE checkpoint over a large WAL would block the event loop, which is the problem
  being fixed. The worker runs it on its own connection after the swap.
- **Tsx in the worker goes through a bootstrap.** Under tsx, `new Worker(src/*.ts)` loads the `.ts` file, but the
  worker does not map `.js` specifiers to `.ts`. Inherited `execArgv` does not change that. In tests and dev
  (`tsx watch`, the ingest CLI) the worker is started from a one-line eval bootstrap. It calls
  `register()` from `tsx/esm/api` and then imports the `.ts` entry. The compiled build spawns `dist/*.js`
  directly, and `tsx` is not loaded there.
- **Both swap and staging batches use `.immediate()` transactions.** A deferred transaction that reads before
  it writes can fail with SQLITE_BUSY_SNAPSHOT under WAL. An immediate transaction takes the write lock at
  BEGIN and waits under `busy_timeout`.
- **`resetMetaCache()` is called after both the catalog build and the EPG import.** Before this change nothing
  called it, so `/api/meta` could serve up to 15 s of stale counts.
- **No explicit refresh for search-aliases.** `aliasIndexFor` keys its cache on `meta.last_ingest` and reads that
  key on every call. The worker's commit is seen on the next search. Nothing to add.
- **`writeGzip` stays on the main thread.** It is async streaming (libuv thread pool), not CPU on the loop.
- `buildCatalogFromDir` and `buildCatalog` are unchanged and stay synchronous, so the existing tests still run
  in-thread.

## Concurrency and locking

- Readers on the main connection are never blocked. WAL keeps them on the last committed snapshot.
- The catalog write lock is held for the transaction only. Measured on the 31,587-channel catalog: 1.2–1.3 s
  (`writeMs` in the rebuild log). The rest of the rebuild, about 1 s, is JSON read and derivation, which
  happens before the transaction opens.
- The prober's writes are small transactions (`scheduler.ts`). Each waits at most `busy_timeout` (5 s) behind
  a worker transaction. The catalog write is about 1.3 s, well under that, so the prober should not time out. This is an
  inference: prober writes were not tested against a live rebuild. The EPG swap lock was not timed on its own.
- Ingest and EPG run concurrently on one file. The test `epg-worker.test.ts` covers this: both commit, and
  the counts are correct.

## Measurements

Method: a forced rebuild or import is triggered with `POST /api/admin/ingest` or `/api/admin/epg/import`. A
client loop hammers `/api/health` and `/api/meta` with no gaps until the status endpoint reports a new
`last_ingest` or `last_epg_import`. The data is a copy of `apps/api/.data`. Baseline is the unmodified code
built to `dist/`. The after runs use the same build layout, with `npm run build`, `dist/server.js` and
`DATA_DIR` pointing at the copy. The 300k-row guide is synthetic: 1,500 channels × 200 programmes, 85 MB.

| Scenario | Before: max `/api/health` | After: max `/api/health` | Before: max `/api/meta` | After: max `/api/meta` |
|---|---|---|---|---|
| Forced catalog rebuild, 31,587 channels | 2,158 ms | 17.8–23.0 ms | 2,158 ms | 19.9–20.4 ms |
| Forced EPG import, real guide, 23,600 rows (5 MB) | 111.5 ms | 8.6 ms (28.6 ms in a later run) | 110.2 ms | 9.7 ms (25.8 ms) |
| Forced EPG import, 300,000 rows (85 MB) | 1,074 ms | 25.7 ms | 1,074 ms | 88.5 ms |

Notes on the numbers:
- Total rebuild time went up slightly, from 2,470 ms to 2,733–3,108 ms, which includes worker startup and
  concurrent requests during the run. Each figure is one run on a single VM, so the spread is noisy.
- The 88.5 ms `/api/meta` maximum at 300k rows is one request. It is the cache miss on the first call after the
  import, when `meta()` runs `COUNT(*)` over `programmes` and `streams` on the main thread. The
  `resetMetaCache()` call makes this happen right after each import. Item 4.3 (denormalised counts) removes it.
- Import total time is unchanged: 7.3 s baseline, 7.0 s after.
- The tsx dev server (`tsx src/server.ts`) gave a max `/api/health` of 22.9 ms during a forced rebuild.
- Worker failure, live: a truncated guide (`head -c` of the 300k file) rejects with
  `epg import failed (old guide kept)`, is logged at error level, and leaves 23,600 programmes in place. The
  server kept answering `/api/health` and `/api/admin/status` throughout.

## Verification

- `npm run typecheck`: clean.
- `npm test`: 251 of 251 pass. New tests: `test/ingest-worker.test.ts` (4), `test/epg-worker.test.ts` (2),
  `test/worker.test.ts` (6). The existing ingest, EPG and admin suites run through the worker path, and all
  pass.
- Compiled build: `npm run build`, then `node dist/server.js` against a copy of the data. Forced rebuild and
  forced import, latency as in the table above.
- Measurement scripts are kept out of the repo, in the session scratchpad. The hammer is a Node script that
  takes base URL, token and job (`ingest` or `epg`), and prints p50, p99 and max per endpoint.

## Not done

- Item 4.3 (denormalised counts for `/api/meta`) is untouched, as the brief specified.
- SIGTERM during a rebuild exits the process, and the worker goes with it. SQLite rolls back the uncommitted
  transaction, so the catalog stays at the previous version. The next run rebuilds if it detects a change.
- Worker heap limits are the Node defaults. Memory peak was not measured separately.
