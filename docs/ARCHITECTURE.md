# Architecture

## Services (Docker Compose)

| Service | Image / runtime | Port (internal) | Purpose |
|---------|-----------------|-----------------|---------|
| `web`   | Caddy 2 + static build of `apps/web` | 80/443 (published) | Serves the SPA; reverse-proxies `/api/*` → `api:3000` and `/proxy/*` → `proxy:3001`. Auto-HTTPS when `DOMAIN` is set. |
| `api`   | Node 22, Fastify, better-sqlite3 | 3000 | Downloads iptv-org datasets on a schedule, builds SQLite catalog (`/data/catalog.db`), serves JSON API, imports XMLTV from `/data/epg/guide.xml`, signs proxy URLs. |
| `proxy` | Node 22 | 3001 | HLS relay. Only accepts HMAC-signed URLs issued by `api`. Rewrites playlists; streams segments. Compose profile `proxy` (on by default via `COMPOSE_PROFILES=proxy`). |
| `epg`   | Node 22 + clone of iptv-org/epg | – | Cron-style loop: builds `channels.xml` from `guides.json`, runs the grabber, writes `/data/epg/guide.xml` atomically (write temp, rename). |

Volumes: `data` (shared by api + epg): `/data/catalog.db`, `/data/raw/*.json`, `/data/epg/guide.xml`.
`caddy_data` for certificates.

All images are multi-arch (amd64 + arm64) because the reference host is an ARM VM.

## Environment variables (`.env`)

| Var | Default | Used by | Meaning |
|-----|---------|---------|---------|
| `DOMAIN` | *(empty)* | web | If set, Caddy serves `https://$DOMAIN` with auto certs; if empty, plain `http://:80`. |
| `COMPOSE_PROFILES` | `proxy,epg` | compose | Drop `proxy` or `epg` to disable those containers. |
| `IPTV_API_BASE` | `https://iptv-org.github.io/api` | api, epg | Base URL for dataset JSON. Fallback mirror: `https://raw.githubusercontent.com/iptv-org/api/gh-pages`. |
| `INGEST_INTERVAL_HOURS` | `6` | api | Re-download datasets and rebuild catalog. |
| `HIDE_NSFW_DEFAULT` | `true` | api | API hides `is_nsfw` and blocklisted channels unless `nsfw=true` is requested. |
| `PROXY_ENABLED` | `true` | api | Whether api issues proxied stream URLs. |
| `PROXY_SECRET` | *(required)* | api, proxy | Shared HMAC key. `openssl rand -hex 32`. |
| `PROXY_PUBLIC_PATH` | `/proxy` | api, proxy | Public path prefix the browser uses to reach the proxy. |
| `PROXY_MAX_CONCURRENT` | `200` | proxy | Upstream connection cap. |
| `PUBLIC_URL` | *(empty)* | api | Public base URL (`https://tv.example.com`) for absolute URLs in M3U exports and Cast; derived from the request when empty. |
| `ADMIN_TOKEN` | *(empty)* | api | If set, `POST /api/admin/ingest` with `Authorization: Bearer` forces a re-ingest. |
| `EPG_FILE` | `/data/epg/guide.xml` | api, epg | XMLTV path. api polls its mtime every 60 s and re-imports on change. |
| `EPG_SITES` | `all` | epg | `all` or comma list of iptv-org/epg site names (e.g. `tvguide.com,bbc.co.uk`). |
| `EPG_DAYS` | `2` | epg | Days of schedule to grab. |
| `EPG_MAX_CONNECTIONS` | `10` | epg | Grabber concurrency. |
| `EPG_INTERVAL_HOURS` | `12` | epg | Time between grabs. |
| `EPG_RUN_ON_START` | `true` | epg | Grab immediately on container start. |
| `EPG_ONE_SITE_PER_CHANNEL` | `true` | epg | One guide source per channel (see apps/epg/README.md). |
| `EPG_EXCLUDE_SITES` | *(empty)* | epg | Sites to drop. |
| `EPG_POLL_SECONDS` | `60` | api | How often api checks `EPG_FILE` for changes. |
| `PROXY_MAX_BYTES` | `52428800` | proxy | Per-response byte cap. |
| `LOG_LEVEL` | `info` | api, proxy | Pino level / `silent`. |
| `PORT` | 3000 / 3001 | api / proxy | Listen port. |
| `DATA_DIR` | `/data` | api | Data root. |

## Request flow: playing a channel

1. UI opens `/watch/:id` → `GET /api/channels/:id` → channel + ordered `streams[]` + `now`/`next`.
2. For each stream (in order) the UI tries `stream.url` with hls.js (or native HLS on Safari).
   A stream that errors (network/CORS/manifest) within ~8 s is skipped.
3. If all direct attempts fail and `stream.proxyUrl` exists, the UI retries each with `proxyUrl`.
4. `proxyUrl` is `${PROXY_PUBLIC_PATH}/${sig}/${payload}` where
   `payload = base64url(JSON.stringify({u, ua?, r?}))` and `sig = base64url(HMAC_SHA256(PROXY_SECRET, payload))`.
   The proxy verifies the signature, fetches `u` (with optional User-Agent / Referer), and:
   - if the response is an M3U8 playlist: rewrites every URI (absolute, relative, `URI="..."` inside `#EXT-X-KEY`/`#EXT-X-MAP`) into a signed proxy URL and returns it;
   - otherwise streams the body through (supports `Range`, passes `Content-Type`, strips upstream CORS headers, adds `Access-Control-Allow-Origin: *`).

## Catalog build (api/ingest)

1. Download the nine datasets to `/data/raw/` (ETag/If-Modified-Since where available; skip rebuild if nothing changed).
2. Inside ONE transaction on `/data/catalog.db`: delete all rows from the catalog tables (everything except `meta` and `programmes`), re-insert from the raw JSON, rebuild `channels_fts`. Readers (WAL mode) keep seeing the old catalog until commit. `programmes` (EPG) is never touched by ingest.
3. Derivations:
   - `channels.logo_url` ← first `logos` row for channel with `in_use` true (prefer `feed IS NULL`, then main feed).
   - `channels.languages` ← union of feed languages; `channels.broadcast_area` ← union of feed broadcast areas.
   - `channels.stream_count`, `has_stream`, `best_quality` ← from `streams`.
   - `channels.guide_count` ← rows in `guides`.
   - `channels.blocked` ← in `blocklist`.
   - `channels_fts` ← name, alt_names, network, owners, country name, id.
   - Only categories/countries/languages that have ≥1 channel get `channel_count` > 0.
4. Streams with `channel IS NULL` are kept in `streams` with a synthetic channel id `__orphan__:<title>`? **No** — v1 ignores orphan streams (no channel id). Documented limitation.

## EPG pipeline

- `epg` container: `generate-channels.mjs` reads `guides.json` (from `IPTV_API_BASE`), filters by `EPG_SITES`, and writes `channels.xml` in iptv-org/epg's format:
  `<channel site="SITE" lang="LANG" xmltv_id="CHANNEL_ID" site_id="SITE_ID">NAME</channel>`.
  By default one entry per channel (`EPG_ONE_SITE_PER_CHANNEL=true`); otherwise one per `(channel, site)`. Within a site, prefer the channel's main feed, else `feed: null`, else the first. The api importer keeps one programme per `(channel, start)` either way.
- Runs `npm run grab -- --channels=/work/channels.xml --days=$EPG_DAYS --maxConnections=$EPG_MAX_CONNECTIONS --output=/data/epg/guide.xml.tmp` then `mv` to `guide.xml`.
- `api/epg/importer.ts` polls mtime; on change, streams the XML with a SAX parser into a temp table, then swaps into `programmes` inside one transaction. `programme@channel` may be `ID` or `ID@FEED`; the part before `@` is the channel id.
- Times are stored as unix seconds UTC (`start_ts`, `stop_ts`). The UI renders in the viewer's local zone.

## Front end

Vite + React 18 + TypeScript + Tailwind v4 + react-router + hls.js. No global state library; URL search params are the source of truth for browse state; favorites in `localStorage`.
Routes: `/` (browse), `/watch/:id`, `/guide`, `/about`. API client in `src/lib/api.ts` is the only place that knows URLs.

## Security notes

- The proxy only relays URLs signed by the api, which only signs URLs that exist in the catalog. No open relay.
- api is read-only to the public except `/api/admin/*` behind `ADMIN_TOKEN`.
- Caddy sets sane headers; the SPA has no inline scripts.
