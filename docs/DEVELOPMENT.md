# Development guide

## Repository layout

```
apps/
  api/        Node 22 + Fastify + better-sqlite3. Ingest, catalog API, EPG import, exports, URL signing.
    src/db/         schema.sql (the contract), db open/migrate
    src/ingest/     fetch datasets → build catalog (one transaction)
    src/routes/     catalog.ts, stream.ts, epg.ts, export.ts
    src/epg/        streaming XMLTV parser + importer
    src/lib/        query planner, http helpers, signing, quality ranks, M3U renderer
    test/           node:test suites + fixtures/ (real data slices, ~270 channels, + sample-guide.xml)
  web/        Vite + React 18 + TypeScript + Tailwind v4 + hls.js. PWA.
    src/lib/api.ts        the only module that knows API URLs (types mirror docs/API.md)
    src/pages/browse      grid, filters, search (URL params are the state)
    src/pages/watch       player page; components/player/Player.tsx is the hls.js wrapper
    src/pages/guide       timeline guide
    src/pages/tv          10-foot UI (/tv/*); components/tv/*; lib/spatial-nav.ts
    src/components/cast   Chromecast / AirPlay
  proxy/      Node 22, zero-framework HLS relay with HMAC-signed URLs and SSRF guard.
  epg/        Container around iptv-org/epg: channels.xml generator + scheduler.
  tv/         Packaging skeletons for Android TV (TWA), Tizen, webOS.
infra/        Caddyfile, deploy scripts, Oracle cloud-init.
docker-compose.yml, .env.example, .github/workflows/ci.yml
docs/         you are here
```

There is no monorepo tooling on purpose: each app has its own `package.json`, lockfile and
Dockerfile, and the ten-line signing helper is copied between `api` and `proxy` rather than shared.
That keeps each container's build context tiny and lets the apps be worked on independently.

## Running locally

Prerequisites: Node 22, npm 10, Docker (only for the containers and the epg grabber).

```sh
# API with the real catalog (first run downloads ~60 MB from iptv-org)
cd apps/api && npm i
DATA_DIR=$PWD/.data npm run ingest                      # one-shot catalog build
DATA_DIR=$PWD/.data PROXY_SECRET=dev-secret npm run dev # http://localhost:3000/api/meta

# Web UI (proxies /api → :3000 and /proxy → :3001)
cd apps/web && npm i && npm run dev                     # http://localhost:5173

# Relay (optional while developing)
cd apps/proxy && npm i && PROXY_SECRET=dev-secret npm run dev   # :3001

# Guide (optional): generate channels.xml offline from the ingested guides.json
cd apps/epg && GUIDES_FILE=../api/.data/raw/guides.json FEEDS_FILE=../api/.data/raw/feeds.json \
  EPG_SITES=tvguide.com node generate-channels.mjs --out /tmp/channels.xml
```

A quick fake guide for UI work: see the snippet in `docs/notes/api-epg.md` or write a small XMLTV
file to `apps/api/.data/epg/guide.xml` with programmes around "now"; the api imports it within 60 s
(`EPG_FILE=$PWD/.data/epg/guide.xml`).

The whole stack via Docker instead: `cp .env.example .env`, set `PROXY_SECRET`, then
`docker compose -f docker-compose.yml -f docker-compose.override.example.yml up --build`
(the override publishes api/proxy on localhost for curl).

## Tests

```sh
cd apps/api   && npm run typecheck && npm test     # 104 tests: ingest, routes, epg, exports
cd apps/proxy && npm run typecheck && npm test     # 40 tests incl. SSRF and playlist rewriting
cd apps/web   && npm run build                     # strict tsc + vite (no unit tests yet)
```

API tests build a catalog from `apps/api/test/fixtures/` (slices of real iptv-org data) into a temp
SQLite file and use Fastify's `inject()`, so they need no network. Routes that depend on "now" take
the clock from `src/epg/time.ts` so tests can freeze it. Keep fixtures small; regenerate them with the
Python snippet in `docs/notes/api-ingest.md` if the upstream shape changes.

UI checks are done with Playwright screenshots (see `docs/notes/web-devices.md` for the audit
script); adding Playwright e2e tests to CI is on the roadmap.

## Conventions

- TypeScript strict everywhere; no `any` without a comment.
- API responses are camelCase and nullable fields are `null`, never `undefined`. Shapes live in
  `docs/API.md`; change the doc in the same PR as the code and update `apps/web/src/lib/api.ts`.
- SQL only in `apps/api/src/lib/*` and routes, always prepared statements. Schema changes go in
  `schema.sql` and bump `SCHEMA_VERSION` in `src/db/index.ts` (catalog tables are dropped and
  re-ingested on next start; `programmes` and `meta` survive).
- Web: URL search params are the source of truth for browse state; `localStorage` only for
  per-device conveniences (favorites, theme, view, TV settings), always wrapped in try/catch.
- Tailwind for the site; plain CSS with the `--u` scale unit for `/tv` (old TV engines).
- No new runtime dependencies without a reason in the PR; the proxy in particular stays at one.
- Commit messages: imperative, one line, body for the why.

## Adding a feature: where things go

| Want to… | Touch |
|----------|-------|
| Add a filter to the channel list | `lib/channel-query.ts` (plan), `routes/catalog.ts` (param parsing), `docs/API.md`, `web/src/components/browse/state.ts` + `FilterPanel.tsx` |
| Add a derived channel field | `ingest/build.ts` (derive), `schema.sql` (+ bump version), `lib/views.ts` (serialize), `docs/API.md`, `web/src/lib/api.ts` |
| Change playback fallback logic | `web/src/components/player/Player.tsx` (site) and `components/tv/TvPlayer.tsx` (TV) — they are intentionally separate |
| Add a TV screen | `web/src/pages/tv/` + a route in `TvPage.tsx`; make every focusable element `data-nav tabIndex={0}` |
| Change what the relay accepts | `proxy/src/ssrf.ts`, `server.ts`; add a test in `proxy/test/` |
| Add an export format | `api/src/routes/export.ts` + `lib/export-*.ts` |

## Releasing

CI runs typecheck/tests/build on every push and PR. On `main` and on `v*` tags it builds multi-arch
images (amd64 + arm64) and pushes them to GHCR as `ghcr.io/<owner>/freetv-{web,api,proxy,epg}`
tagged `latest`, the commit SHA and the tag. To cut a release:

```sh
# update CHANGELOG.md, bump APP_VERSION default in apps/api/src/config.ts if you like
git tag v0.2.0 && git push origin main --tags
```

Operators then `infra/scripts/update.sh` (or set `FREETV_TAG=v0.2.0` in `.env` to pin).

## Pushing this repository to GitHub for the first time

```sh
cd freetv
git remote add origin git@github.com:<you>/freetv.git     # create the (private) repo on GitHub first, empty, no README
git push -u origin main
```

Then in the repo settings enable Actions (they are on by default) and, when you are ready, flip the
repo to public: the MIT license is already in place.
