# End-to-end tests (track E2E)

Playwright tests in `e2e/`. They run the real `api`, `proxy` and `web` build on loopback against a
fixture catalog and a fake HLS origin. Nothing goes to the internet.

## Run

```sh
(cd apps/web && npm run build)          # global setup serves apps/web/dist
cd e2e && npm ci
npx playwright install --with-deps chromium   # first time; CI does this
npm test                                # desktop (Desktop Chrome) + mobile (Pixel 7)
npm run test:headed                     # watch it run
npm run typecheck
```

The HTML report goes to `e2e/report`. Server logs for the run go to `e2e/test-results/server-logs/`
(`api.log`, `proxy.log`, `web.log`, `hls-origin.log`). Locally the sandbox is root, so `--no-sandbox`
is passed to Chromium automatically. Set `E2E_NO_SANDBOX=1` to force it.

## What starts (`e2e/setup/global-setup.ts`)

| Service | Port | Notes |
|---|---|---|
| fake HLS origin (`fixtures/hls-origin.mjs`) | 4600 (`HLS_PORT`) | CORS on `/live/*`, none on `/cors-blocked/*`, 404 on `/dead/*` |
| api (`apps/api`, `src/server.ts`) | 3000 | `DATA_DIR` is a temp dir, `PROBE_ENABLED=false`, `PROXY_SECRET=e2e-secret` |
| proxy (`apps/proxy`) | 3001 | `PROXY_ALLOW_PRIVATE=true` so it can reach the loopback origin |
| web (`vite preview` of `apps/web/dist`) | 4173 | The preview forwards `/api` and `/proxy` through `vite.config.ts`'s `server.proxy` |

Ports 3000, 3001 and 4173 are fixed because `vite.config.ts` hard-codes the api and proxy targets.
`global-teardown.ts` kills each service's process group and deletes the temp `DATA_DIR`.

### Catalog

- Input is a copy of `apps/api/test/fixtures` (270 channels, `sample-guide.xml`), built by the real
  `buildCatalogFromDir` (`setup/build-catalog.ts`, run as a child process so `DATA_DIR` is set before
  the api config loads). Only `streams.json` differs from the fixtures.
- Stream lists in the copy (`setup/fixture-data.ts`, `OVERRIDES`), in playback order:
  - `BBCNews.uk`: dead, cors-blocked, good. Playback tries direct URLs in order, so it must fall
    through twice.
  - `CNN.us`: cors-blocked only. Direct fails, so only the relay can play it.
  - `AlJazeera.qa`: good only. Plays direct on the first try.
- Rewriting the input JSON, not the SQLite rows, keeps `stream_count`, `best_quality`, `has_stream`
  and the `idx` order consistent. The ingest code derives all of them.
- The guide is `sample-guide.xml` with every programme shifted so the first one starts 30 minutes
  before the run. BBC News at Ten is then on air, and "Newsday" follows it.

### Why the startup ingest cannot touch the catalog

`apps/api/src/server.ts` runs an ingest at startup. It downloads from `IPTV_API_BASE`, then from a
mirror hard-coded in `apps/api/src/config.ts` (`raw.githubusercontent.com`). The mirror would work in
CI and replace the fixture catalog with real data. So the api runs with `--import
e2e/setup/offline-fetch.mjs`, which rejects every non-loopback `fetch`, and `IPTV_API_BASE` points at
`127.0.0.1:1`. The ingest fails and the fixture catalog stays. The api log shows this as
`ingest: ... failed`. That is expected.

## Deviations from the brief

- **Segments are fMP4 with VP9 and Opus, not MPEG-TS with H.264.** The Chromium that Playwright
  ships (141, revision 1194 here) has no H.264 or AAC decoder. `MediaSource.isTypeSupported` returns
  false for `video/mp2t` and for H.264 in both TS and MP4. VP9 and Opus in fMP4 play. The files are
  `fixtures/hls/{master,media}.m3u8`, `init.mp4` and `seg0..2.m4s` (18 KB total). The commands that
  made them are in the header of `fixtures/hls-origin.mjs`. The HLS paths the player and relay use are
  the same. The relay also has to rewrite `#EXT-X-MAP`, which it does.
- **Playwright is pinned to 1.56.1.** Its bundled Chromium is revision 1194, which is the one
  preinstalled in this sandbox at `/opt/pw-browsers`. Newer releases such as 1.63.0 need revision 1243.
  1.56.1 was published long before the two-week cutoff.
- **tsx is pinned to 4.23.15.** tsx 4.19.2 pulls in esbuild with an advisory (GHSA-67mh-4wv8-2f99).
  4.23.15 was published 2026-09-20 and `npm audit` is clean.

## Tests

39 tests in 6 files. The desktop project runs all of them. The mobile project (Pixel 7) runs
`browse`, `watch`, `exports` and `pwa`. TV mode is a remote-control UI, and the guide is a wide
timeline, so both run on desktop only.

| File | Tests |
|---|---|
| `browse.spec.ts` | loads with a total; a category chip narrows it (sidebar, or the Filters drawer on phones); `bbc news` puts BBC News first; `bbc` includes BBC News; URL reflects category and search; back restores filters; favourite heart persists across reload; grid/list toggle persists; seeded favourites show as favourited |
| `watch.spec.ts` | BBC News falls through dead and CORS-blocked to direct good, with no relay used; CNN plays through the relay; Al Jazeera plays direct with no relay |
| `guide.spec.ts` | favourites get rows and the current programme block; the popover's Watch opens `/watch/BBCNews.uk` and it plays |
| `tv.spec.ts` | keyboard only: Tab in, arrows move focus, Tab to a channel tile, Enter opens it, Escape goes back; `/tv/watch/BBCNews.uk` shows the overlay and plays |
| `exports.spec.ts` | `/api/playlist.m3u?favorites=BBCNews.uk` has one EXTINF with `tvg-id`; `/api/guide.xml` is XML |
| `pwa.spec.ts` | `/manifest.webmanifest` is served; the service worker becomes active |

Four tests are `test.fixme`, two per project. Each one is a real product bug, documented in the file:

1. `watch.spec.ts`: "the status line reports the relay once it is playing". In
   `apps/web/src/components/player/Player.tsx`, the status shows "Playing via relay" only once every
   attempt is exhausted. After a successful relay it keeps saying "Trying source 2 of 2…".
2. `browse.spec.ts`: "searching for bbc puts BBC News first". `channel-query.ts` ranks prefix matches
   by bm25, and BBC Kids wins that for "bbc" in the fixtures. The API returns `BBCKids.us, BBCNews.uk`.
   "bbc news" does put BBC News first, and that is what the active test checks.

## Stability

Three full runs in a row on the final code: 35 passed, 4 fixme, 0 failures. A TV focus test was
flaky once. The Tab loop reached the favourites call-to-action tile, which opens `/tv/browse`,
before the first channel tile. The test now waits for a non-CTA tile and only focuses those.

## CI

`.github/workflows/ci.yml` has a new `e2e` job. Its steps are: `npm ci` in apps/api, apps/web,
apps/proxy and e2e; `npm run build` in apps/web; `npx playwright install --with-deps chromium`;
`npm test` in e2e. On failure it uploads `e2e/report` and `e2e/test-results`. The job needs no
ffmpeg, because the segments are committed. CI uses 2 workers and one retry, with trace on first
retry. Other jobs are unchanged.

## Files

- `e2e/playwright.config.ts`, `e2e/package.json`, `e2e/package-lock.json`, `e2e/tsconfig.json`, `e2e/.gitignore`
- `e2e/setup/` global-setup, global-teardown, build-catalog, fixture-data, paths, offline-fetch
- `e2e/fixtures/` hls-origin.mjs and the committed `hls/` segments
- `e2e/tests/` the specs and `support.ts`
