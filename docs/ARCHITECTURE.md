# Architecture

## Services (Docker Compose)

| Service | Image / runtime | Port (internal) | Purpose |
|---------|-----------------|-----------------|---------|
| `web`   | Caddy 2 + static build of `apps/web` | 80/443 (published) | Serves the SPA; reverse-proxies `/api/*` → `api:3000` and `/proxy/*` → `proxy:3001`. Auto-HTTPS when `DOMAIN` is set. |
| `api`   | Node 22, Fastify, better-sqlite3 | 3000 | Downloads iptv-org datasets on a schedule, builds SQLite catalog (`/data/catalog.db`), serves JSON API, imports XMLTV from `/data/epg/guide.xml`, signs proxy URLs. |
| `proxy` | Node 22 | 3001 | HLS relay. Only accepts HMAC-signed URLs issued by `api`. Rewrites playlists; streams segments. Compose profile `proxy` (on by default via `COMPOSE_PROFILES=proxy`). |
| `epg`   | Node 22 + clone of iptv-org/epg pinned to `EPG_REF` | – | Cron-style loop: builds `channels.xml` from `guides.json`, runs the grabber, writes `/data/epg/guide.xml` atomically (write temp, rename). |

Volumes: `data` (shared by api + epg): `/data/catalog.db`, `/data/raw/*.json`, `/data/epg/guide.xml`,
`/data/logos`, `/data/local-blocklist.json`. `caddy_data` for certificates.

The api, proxy and epg images all run as the image user `node` (uid/gid 1000). The api image creates
`/data` owned by that user before the volume is declared, so a new volume is seeded with the right owner.
The `epg` image also owns `/data/epg`. A volume already owned by root must be re-owned once; see
`docs/TROUBLESHOOTING.md`.

Build-time variables: `EPG_REF` (the iptv-org/epg commit the `epg` image is built from, default in
`apps/epg/Dockerfile`, `docker-compose.yml` and `.env.example`). `GITHUB_REPOSITORY_OWNER` selects the image
namespace `ghcr.io/<owner>/freetv-<svc>`; empty means `local`, which is never pulled.

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
| `PROXY_URL_TTL_SECONDS` | `86400` | api | Lifetime of relay URLs in channel responses (24 h). The proxy refuses them after `exp`. Keep it at most 2592000 (30 d); the proxy rejects further ahead. |
| `PROXY_EXPORT_TTL_SECONDS` | `604800` | api | Lifetime of relay URLs in `playlist.m3u?proxy=true` (7 d). Same 30 d cap. |
| `PROXY_MAX_CONCURRENT` | `200` | proxy | Upstream connection cap. |
| `PROXY_ALLOW_PRIVATE` | `false` | proxy | Dev only. Lets the relay reach loopback and private ranges. Never on an internet-facing instance. |
| `GITHUB_REPOSITORY_OWNER` | *(empty)* | compose | Owner of `ghcr.io/<owner>/freetv-<svc>`. Empty means `local`: images are built on this host and never pulled. |
| `FREETV_TAG` | `latest` | compose | Tag used when pulling images. |
| `EPG_REF` | pinned commit sha | epg (build arg) | iptv-org/epg commit the `epg` image is built from. Changing it needs a rebuild. |
| `PUBLIC_URL` | *(empty)* | api | Public base URL (`https://tv.example.com`) for absolute URLs in M3U exports and Cast; derived from the request when empty. |
| `PROBE_ENABLED` | `true` | api | Run the stream health prober. |
| `PROBE_INTERVAL_HOURS` | `6` | api | Time to cycle through every stream once. |
| `PROBE_CONCURRENCY` | `8` | api | Parallel probes. |
| `PROBE_RATE_PER_SECOND` | `5` | api | Global probe rate cap (be polite to stream hosts). |
| `PROBE_TIMEOUT_MS` | `10000` | api | Per-probe timeout. |
| `LOGO_CACHE_ENABLED` | `true` | api | Serve logos from `/logo/:id` with a disk cache. |
| `LOGO_CACHE_DIR` | `$DATA_DIR/logos` | api | Cache location. |
| `LOGO_CACHE_MAX_MB` | `500` | api | LRU eviction threshold. |
| `LOGO_MAX_SIZE` | `512` | api | Largest edge served. |
| `LOGO_CONCURRENCY` | `6` | api | Concurrent logo encodes. A logo request that waits over 10 s for a slot gets `503` with `Retry-After: 5`. |
| `FETCH_ALLOW_PRIVATE` | `false` | api | `true` lets the prober and logo cache fetch private, loopback and link-local addresses (tests, LAN installs). Off applies the SSRF guard (`apps/api/src/lib/ssrf.ts`). |
| `PROXY_RATE_LIMIT_RPS` | `20` | proxy | Per-client-IP sustained requests/second (segments are ~1 req/2–6 s per viewer; 20 allows several tabs). |
| `PROXY_RATE_LIMIT_BURST` | `60` | proxy | Burst allowance. |
| `PROXY_MAX_CONCURRENT_PER_IP` | `16` | proxy | Concurrent relayed requests per client IP (0 disables). |
| `PROXY_TRUST_PROXY` | `true` | proxy | Use `X-Forwarded-For` (set by Caddy) for the client IP. |
| `GRAFANA_ADMIN_PASSWORD` | *(placeholder)* | monitoring profile | Grafana admin password (loopback-only UI on :3002). |
| `PROMETHEUS_RETENTION` | `15d` | monitoring profile | Metrics retention. |
| `WATCHTOWER_SCHEDULE` | daily | autoupdate profile | Cron for image auto-updates. |
| `LOCAL_BLOCKLIST` | `$DATA_DIR/local-blocklist.json` | api | Optional JSON array of channel ids (or `{channel}` objects) this instance should hide in addition to iptv-org's blocklist. |
| `ADMIN_TOKEN` | *(empty)* | api | If set, `POST /api/admin/ingest` with `Authorization: Bearer` forces a re-ingest. |
| `EPG_FILE` | `/data/epg/guide.xml` | api | XMLTV path the api imports. The api polls its mtime (`EPG_POLL_SECONDS`) and re-imports on change. |
| `EPG_SITES` | `all` | epg | `all` or comma list of iptv-org/epg site names (e.g. `tvguide.com,bbc.co.uk`). |
| `EPG_DAYS` | `2` | epg | Days of schedule to grab. |
| `EPG_MAX_CONNECTIONS` | `10` | epg | Grabber concurrency. |
| `EPG_INTERVAL_HOURS` | `12` | epg | Time between grabs. |
| `EPG_RUN_ON_START` | `true` | epg | Grab immediately on container start. |
| `EPG_ONE_SITE_PER_CHANNEL` | `true` | epg | One guide source per channel (see apps/epg/README.md). |
| `EPG_EXCLUDE_SITES` | *(empty)* | epg | Sites to drop. |
| `EPG_SPLIT_BY_SITE` | `false` | epg | One grabber run per site; a failing site loses only its own programmes. Recommended on small hosts. |
| `EPG_TIMEOUT_MS` | `30000` | epg | Per-request timeout for the grabber. |
| `EPG_GRAB_ARGS` | *(empty)* | epg | Extra grabber arguments, whitespace separated. |
| `EPG_REFRESH_API_DATA` | `true` | epg | Refresh the grabber's API data before each run. |
| `EPG_OUTPUT` | `/data/epg/guide.xml` | epg | Where the grabber output is published. This is the epg-side name; `EPG_FILE` is the api-side name. |
| `EPG_POLL_SECONDS` | `60` | api | How often api checks `EPG_FILE` for changes. |
| `PROXY_MAX_BYTES` | `52428800` | proxy | Per-response byte cap. |
| `LOG_LEVEL` | `warn` (compose), `info` (code) | api, proxy | api: Pino level. proxy: only `silent` changes anything; any other value logs at `info`, one line per relayed request. |
| `APP_VERSION` | `0.1.0` | api | Version string reported by `/api/meta`. |
| `PORT` | 3000 / 3001 | api / proxy | Listen port. |
| `DATA_DIR` | `/data` | api | Data root. |

## Request flow: playing a channel

1. UI opens `/watch/:id` → `GET /api/channels/:id` → channel + ordered `streams[]` + `now`/`next`.
2. For each stream (in order) the UI tries `stream.url` with hls.js (or native HLS on Safari).
   A stream that errors (network/CORS/manifest) within ~8 s is skipped.
3. If all direct attempts fail and `stream.proxyUrl` exists, the UI retries each with `proxyUrl`.
4. `proxyUrl` is `${PROXY_PUBLIC_PATH}/${sig}/${payload}` where
   `payload = base64url(JSON.stringify({u, ua?, r?, exp}))`, `exp` is unix seconds (now + `PROXY_URL_TTL_SECONDS`, 24 h), and
   `sig = base64url(HMAC_SHA256(PROXY_SECRET, payload))`.
   The proxy verifies the signature and `exp` (playlists must be within `exp`; segments also get a 10-minute grace period), fetches `u` (with optional User-Agent / Referer), and:
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
