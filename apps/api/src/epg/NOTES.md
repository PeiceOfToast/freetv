# Track C (api/epg) notes

## Built
- `xmltv.ts`: `XmltvParser` (push-based, sax non-strict), `parseXmltvFile(path, onProgramme)` (streams 256 KB chunks, yields to the event loop between chunks), `parseXmltvString`, `parseXmltvTime`.
  - Time: `YYYYMMDD[HHmm[ss]]` with optional ` ±HHMM` / `±HH:MM` offset. No offset means UTC. Unparseable times, stop <= start, or a missing channel skip the programme.
  - Channel `ID@FEED` becomes `ID`. First `<title>`, `<desc>`, `<category>`, `<icon src>` only.
  - Truncated files are rejected: `end()` throws unless `</tv>` was seen.
- `importer.ts`: `importEpg({force}, log?)` is serialized through a promise chain. It stats `config.epgFile` (ENOENT logs and returns). It compares mtime and size with meta `epg_file_mtime`/`epg_file_size`. It streams into `programmes_new` in 5000-row transactions, then swaps in one transaction: DELETE programmes, INSERT SELECT, clear temp, set meta (`programmes_count`, `last_epg_import`, mtime, size). `startEpgWatcher(log)` imports at once, then every `EPG_POLL_SECONDS` (unref'd).
- `time.ts`: `nowSeconds()` plus `setNowFn(fn|null)` for tests.
- `routes/epg.ts`: `/api/channels/:id/epg`, `/api/epg/now`, `/api/epg/grid`, with 400s on bad input. Cache-Control `public, max-age=60` on successes only.

## Decisions to check
- Programmes with an empty or missing `<title>` are stored with title `''` (the column is NOT NULL). The UI may want to show a placeholder.
- `/api/channels/:id/epg` returns `items: []` for unknown channel ids (no 404). `/api/epg/grid` defaults to now-2h .. now+22h when from/to are omitted. The spec did not say what the defaults should be.
- `/api/epg/now` uses two queries: one for overlapping rows, one using ROW_NUMBER() per channel for the next programme. Both use the (channel, start_ts) index.
- `programmes_new` is created at runtime (schema.sql is frozen). It is a disk table, so memory stays flat, but the DB file briefly holds two copies of the guide during a swap. WAL also grows by the size of the swap transaction until the next checkpoint.
- Parse errors abort the import and keep the old guide. The error is logged on every poll (default 60 s) until the file is fixed or replaced.
- Tolerant sax mode means a malformed-but-closed document is accepted. Only a missing `</tv>` is rejected.

## Performance (sandbox, Node 22)
- sax is the bottleneck: about 9.5 MB/s. An 80 MB file with 300k programmes parses in about 8.5 s. The whole import (parse plus inserts plus swap) takes 12 to 14 s, about 21k to 24k rows/s.
- Peak RSS during a 300k-programme import was about 200 MB, against a 125 MB baseline for the test process. Memory does not grow with the file.
- A 300 MB guide would take roughly 40 to 50 s per import. If that is a real case, options are a faster parser (saxes or a hand scanner) or dropping and rebuilding the two `programmes` indexes around the bulk insert (schema.sql is frozen, so this needs the integrator).

## Requests for the integrator (outside my scope)
- None blocking. `server.ts` already calls `startEpgWatcher(app.log)` and `importEpg({force:true})`. The admin route and watcher both go through the serialized chain.
- Consider `PRAGMA wal_checkpoint(TRUNCATE)` after a large import so the WAL file shrinks.
