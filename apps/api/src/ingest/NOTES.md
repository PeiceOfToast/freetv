# Track A (api/ingest) notes

## Built
- `fetch.ts`: `fetchDatasets(rawDir, opts)` downloads the nine datasets with conditional GET (ETag stored in `${rawDir}/etags.json`, keyed by dataset and source). 304 means unchanged. Writes go to a temp file and are renamed. Falls back to `config.iptvApiMirror` on any failure. Once the primary fails at transport level, it is skipped for the rest of that run. A stale copy is kept if every source fails, and an error is thrown only when no copy exists.
- `build.ts`: `buildCatalog(db, rawDir, now?)` reads the JSON, derives all rows in pure code, then writes everything in one `db.transaction(...).immediate()`. It deletes the catalog tables (not `meta`, not `programmes`) and re-inserts them. It sets `meta.last_ingest` and `meta.counts`.
- `index.ts`: `runIngest(log?)` runs fetch, then rebuilds if anything changed or the DB has no channels. Runs are chained so they never overlap. `scheduleIngest(log)` runs immediately and then every `INGEST_INTERVAL_HOURS` (`unref`'d). `buildCatalogFromDir` is re-exported for tests. `runIngest` requires `openDb()` to have run first, since it uses `getDb()`.

## Decisions to check
- `guides.json` has 180,681 rows, but 153,547 have `channel: null` (EPG site mappings with no iptv-org channel id). `guides.channel` is NOT NULL in schema.sql, so only the 27,134 rows with a channel are stored. `guide_count` counts those. If the EPG track needs the null-channel rows, it should read `guides.json` directly.
- Streams and feeds, and guides, whose `channel` is not in channels.json are skipped. Streams with `channel: null` are dropped as orphans (v1 limitation in ARCHITECTURE.md): 2,075 in the real run.
- `meta.counts`: `channels` and `streams` are totals (including blocked). `channelsWithStreams` counts `has_stream = 1` over all channels, blocked included. Category, country and language `channel_count` and `stream_count` exclude blocked channels.
- Channel `best_quality` and `quality_rank` come from the highest-rank stream, first in file order on ties. `online_count` stays 0 because nothing probes streams yet.
- `name_sort` is `toLowerCase()` then NFD with `\p{M}` stripped.

## Requests for the integrator (outside my scope)
- `.gitignore`: the root `.gitignore` only ignores `*.db`, so `apps/api/.data/` (raw JSON, about 50 MB, and the DB) shows up as untracked. Please add `.data/` (or `apps/api/.data/`) to `.gitignore`. I did not edit it because it is outside my allowed paths.
- `server.ts` should call `openDb()` before `scheduleIngest(app.log)`. The admin route `POST /api/admin/ingest` can call `runIngest(app.log)`.

## Real run (sandbox)
- `iptv-org.github.io` fails from this sandbox, so every dataset came from the raw.githubusercontent mirror. A second run took the 304 path ("datasets unchanged").
- Rebuild took about 6 s. Counts: 31,570 channels (884 blocked, 374 NSFW, 10,214 with streams), 15,947 streams (12,330 https; 2,075 orphans dropped), 27,134 guides (8,843 channels with guides), 30,204 channels with a logo, 45,168 feeds, 30 categories (all with channels), 250 countries (231 with channels), 7,893 languages (300 with channels), 27,443 channel_categories, 35,865 channel_languages.
