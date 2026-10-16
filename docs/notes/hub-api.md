# Hub mode: api track (notes)

Owns the browser-playability work in the prober, catalog fields and filter, the per-channel M3U, and the
settings endpoints. Suite: `npm run typecheck` clean, `npm test` 303/303 (251 existing, 52 new).

## What was built

- **Prober** (`prober/probe.ts`): `probeStream` returns `browserOk`. True when the final URL (after
  redirects) is https and `Access-Control-Allow-Origin` is exactly `*` (whitespace trimmed). `browserPlayableOf`
  is exported for tests. Null whenever the probe is offline, so a failed check keeps the stored value.
  - Choice: `*` only, not "any ACAO header". A specific origin matches only one site, and the prober cannot
    know the origin a player will run from. A `*` is what an anonymous fetch from any origin needs.
- **Scheduler** (`prober/scheduler.ts`):
  - `applyResults` writes `stream_health.browser_ok` (COALESCE, so null keeps the old value), mirrors it to
    every `streams` row with that URL, and recomputes `channels.browser_count` next to `online_count`.
  - Relay rule: a URL with a User-Agent or Referer on any stream row is always 0, including when the probe
    fails. `enforceRelayOnly(db)` runs at the end of each pass and fixes rows that were never probed or that
    got a stale 1 copied over by ingest.
- **Catalog** (`routes/catalog.ts`, `lib/views.ts`):
  - `ChannelSummary.browserPlayable`: true if `browser_count > 0`, false if any stream has `browser_ok` set
    and the count is 0, null otherwise.
  - Detail streams: `browserPlayable` from `browser_ok` (1 true, 0 false, NULL null).
- **Filter** (`lib/channel-query.ts`): `playable=browser|app|any`. `browser` is `browser_count > 0`. `app` is
  `has_stream = 1 AND browser_count = 0`. Anything else is a 400. Because exports reuse `planChannels`, the
  full M3U accepts it too.
- **Per-channel M3U** (`routes/export.ts`): `GET /api/channels/:id/playlist.m3u`. Loads via
  `loadExportChannels` with `favorites=<id>` and `nsfw=true` (no change to `export-query.ts`). Every stream,
  origin URLs only, `tvg-chno` from `channels.number` when set, `Content-Disposition: attachment;
  filename="<name>.m3u"` (sanitised by `safeFilename`, falls back to the id), `Cache-Control: public,
  max-age=300`. 404 for unknown or blocked. A channel with no streams gives a header-only playlist.
- **Settings** (`lib/settings.ts`, `routes/settings.ts`):
  - `getSettings()` merges stored over env defaults, cached per DB handle. `updateSettings()` validates,
    writes in one transaction, drops the cache and bumps `settingsGeneration()`.
  - `publicBase(req)`: stored `publicUrl`, else `PUBLIC_URL`, else the request origin (X-Forwarded-*).
  - `GET /api/settings` (public, `max-age=60`), `GET`/`PUT /api/admin/settings` (bearer, `no-store`).
  - `renderM3u` takes `siteName` and writes `#PLAYLIST:<siteName>` as line 2. Both exporters use
    `publicBase` for `x-tvg-url` and absolute URLs. The full-playlist memo key includes the settings
    generation, so a write shows up on the next request, not after the 60 s memo TTL.
- **Tests**: `prober-browser.test.ts`, `routes-catalog-browser.test.ts`, `settings.test.ts`,
  `export-channel.test.ts`. Edited `export-playlist.test.ts` (the empty-playlist line count now includes the
  `#PLAYLIST` line) and `routes-catalog.test.ts` (key set gains `browserPlayable`).

## Decisions and contract clarifications (for docs/API.md, which is frozen)

1. `browserPlayable` is true only when the final URL is https and ACAO is exactly `*`. That is more
   precise than "https + permissive CORS" in the current text.
2. `GET /api/admin/settings` returns each of the five keys as its stored value, or `null` when nothing is
   stored (an empty stored `publicUrl` means "use PUBLIC_URL"). Plus `defaults`, the env values.
3. `GET /api/settings` `publicUrl` is always the resolved absolute base, never empty.
4. `relayEnabled` = `PROXY_ENABLED && PROXY_SECRET set`, the same expression as `/api/meta.proxyEnabled`.
5. Per-channel playlist for a channel with no streams is a 200 with only the two header lines (the spec only
   names unknown and blocked as 404).

## Needs the integrator (outside this track's files)

- **`tvg-chno` is missing from the full `/api/playlist.m3u`.** `docs/API.md` promises it on every `#EXTINF`,
  but nothing emits it. The renderer now supports it (`M3uChannel.number`). The fix belongs in
  `lib/export-query.ts`, which is not on this track's list: select `c.number` in the channel query and add
  `number` to `ExportChannel`. Until then the full export has no `tvg-chno`, while the per-channel one does.
- Ingest needs nothing new. `build.ts` already copies `browser_ok` from `stream_health` and computes
  `browser_count`. The schema already has every column used here, so `SCHEMA_VERSION` is unchanged.
- The web admin page should read the settings shape in point 2 above.
- Known gap: the sweep and the apply path only see stream rows that exist. A relay URL whose probe has never
  run shows `browserPlayable: null` in the detail until the next pass. The channel-level filter treats it as
  app, which is the correct default.
