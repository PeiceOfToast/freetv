# Operations runbook

What a FreeTV instance does on its own, what you should do occasionally, and what to look at when
you are curious. For step-by-step fixes see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## The moving parts

| Container | What it does on its own | State it owns |
|-----------|-------------------------|---------------|
| `web` (Caddy) | Serves the UI, terminates TLS, renews certificates, reverse-proxies `/api` and `/proxy`. | `caddy_data` volume (certificates, ACME account). |
| `api` | Every `INGEST_INTERVAL_HOURS` (6): downloads the iptv-org datasets, rebuilds the SQLite catalog in one transaction. Every `EPG_POLL_SECONDS` (60): checks whether the guide file changed and re-imports it. Serves the JSON API and signs relay URLs. | `data` volume: `/data/catalog.db` (+ WAL), `/data/raw/*.json`, `/data/raw/etags.json`. |
| `proxy` | Relays HLS playlists/segments for signed URLs only. Stateless. | none |
| `epg` | On start and every `EPG_INTERVAL_HOURS` (12): regenerates `channels.xml`, runs iptv-org/epg's grabber, atomically replaces `/data/epg/guide.xml`. | `data` volume: `/data/epg/guide.xml`. |

All containers restart automatically (`restart: unless-stopped`) and have health checks.

## Daily glance (30 seconds)

```sh
docker compose ps                                  # all "Up (healthy)"
curl -s https://$DOMAIN/api/meta | jq '{channels, channelsWithStreams, lastIngest, lastEpgImport, programmes}'
```

Sanity values: `lastIngest` within the last ~6 h, `channelsWithStreams` around 10,000,
`programmes` in the hundreds of thousands once EPG has run at least once (`EPG_SITES=all`),
`lastEpgImport` within the last ~12 h.

## Logs

```sh
docker compose logs -f --tail=200 api       # ingest + epg import lines are prefixed "ingest:" / "epg:"
docker compose logs -f --tail=200 epg       # grabber progress (one line per site/channel)
docker compose logs -f --tail=200 proxy     # one line per relayed request: status, host, bytes, ms
docker compose logs -f --tail=200 web       # Caddy access/TLS
```

Every container logs with the json-file driver and rotates at 20 MB, keeping five files
(`x-logging` in `docker-compose.yml`, profiles included). The Oracle bootstrap also writes the same limits to
`/etc/docker/daemon.json`, which covers containers started outside compose.

`LOG_LEVEL` defaults to `warn` in compose. At that level the api hides its progress lines (catalog rebuilt, EPG
imported, probe pass); check `GET /api/meta` for those instead, or set `LOG_LEVEL=info` in `.env` while you debug.
The proxy only distinguishes `silent` from everything else, so it still logs one line per relayed request.

## Routine tasks

**Update to the latest code.** `infra/scripts/update.sh` pulls, rebuilds or pulls images, restarts,
reloads Caddy if its config changed, and prunes old images. It handles `web`, `api` and `proxy` first and `epg` last.
If the `epg` build fails, the guide container keeps its previous image. Zero-ish downtime: Caddy keeps serving while
`api` restarts (a few seconds); the catalog is on disk so there is no re-ingest.

**Force a catalog refresh.** Set `ADMIN_TOKEN` in `.env` (then `docker compose up -d api`), and:

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://$DOMAIN/api/admin/ingest
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://$DOMAIN/api/admin/epg/import
```

**Force a guide grab.** `docker compose restart epg` (it grabs on start when `EPG_RUN_ON_START=true`).

**Narrow or widen the guide.** Edit `EPG_SITES` / `EPG_EXCLUDE_SITES` in `.env`,
`docker compose up -d epg`. Site names are the folder names in
[iptv-org/epg/sites](https://github.com/iptv-org/epg/tree/master/sites). On a host under 6 GB keep `EPG_SITES`
to a curated list and set `EPG_SPLIT_BY_SITE=true` (see [DEPLOY.md](DEPLOY.md#narrowing-the-tv-guide)).

**Rotate the relay secret.** `infra/scripts/gen-secret.sh --write --force` then
`docker compose up -d api proxy`. Rotation revokes every outstanding relay URL at once, including ones in
M3U playlists already downloaded. Players see 403 and must re-open the channel (or re-download the M3U) to get
new URLs. Without rotation, a relay URL stops working at its own `exp` (24 h for channel pages, 7 d for M3U
exports), so a URL copied out of the site is only good for that long. Use rotation after a leak or an abuse report.

**Turn the relay off/on.** Edit `COMPOSE_PROFILES` (remove or add `proxy`) and `PROXY_ENABLED`,
then `docker compose up -d --remove-orphans`.

### Stream health prober

The api checks stream playlists in the background. One pass runs two minutes after start, then every
`PROBE_INTERVAL_HOURS` (default 6). Each check fetches the playlist, reads only its first few KB, and follows
redirects. A stream is marked **offline** after two consecutive failures and back **online** after one success.
Failing streams are retried first, and streams that have failed ten times in a row are only checked once a day.

| Knob | Default | Effect |
|------|---------|--------|
| `PROBE_ENABLED` | `true` | `false` stops probing. Stream status then stays at its last known value. |
| `PROBE_INTERVAL_HOURS` | `6` | How often a pass starts. |
| `PROBE_RATE_PER_SECOND` | `5` | Global cap. About 16k streams at 5/s take roughly 53 minutes per pass, so the default interval has room. |
| `PROBE_CONCURRENCY` | `8` | In-flight checks. Raise it together with the rate, not on its own. |
| `PROBE_TIMEOUT_MS` | `10000` | Per-check timeout. |

**What to watch:** the *Stream probe age* and *Streams online* panels in Grafana, or `lastProbe` / `health` in
`GET /api/meta`. If a pass takes longer than the interval, raise `PROBE_INTERVAL_HOURS`. Raising the rate shortens passes too, but
it adds requests to the stream hosts, so check that they tolerate it first. If the online
count falls across many channels at once, check whether your server's IP is being blocked before believing the
streams have died: open one known stream from the server with `curl`. A probe pass can be triggered now with
`POST /api/admin/probe` (admin token).

### Logo cache

With `LOGO_CACHE_ENABLED=true` (default) channel logos are served from `/logo/<id>` on your own domain. The
first request fetches the upstream image, resizes it, and stores it under `LOGO_CACHE_DIR` (default
`/data/logos` in the data volume). Failed fetches are remembered for six hours. The cache is evicted
least-recently-used once it exceeds `LOGO_CACHE_MAX_MB` (default 500). `LOGO_MAX_SIZE` (default 512) caps the
largest edge served.

- Disk: check `logos.bytes` in `GET /api/admin/status` (admin token) against `LOGO_CACHE_MAX_MB`. Eviction keeps
  the cache under the limit, so the figure should not climb past it.
- A 404 for one channel usually means the upstream logo is missing or unreachable. Clients fall back to initials.
- If every logo shows as a broken image, the edge is not routing `/logo/*` to the api. The Caddy config must
  contain a `handle /logo/*` block that proxies to `api:3000`. Set `LOGO_CACHE_ENABLED=false` to fall back to the
  upstream URLs while you fix it.
- Caching headers come only from the api: 7 days for a logo, 5 minutes for a miss. The Caddy config adds none on
  `/logo/*`. If you add one, clients receive two `Cache-Control` values, and a failed fetch can be cached as missing for a week.

### Relay rate limits

The relay limits each client IP. A request over budget gets `429` with a `Retry-After` header and is counted in
`freetv_proxy_rate_limited_total`.

| Knob | Default | Effect |
|------|---------|--------|
| `PROXY_RATE_LIMIT_RPS` | `20` | Sustained requests per second per IP. A viewer fetches a segment every 2 to 6 s, so this covers several tabs. |
| `PROXY_RATE_LIMIT_BURST` | `60` | Short bursts above the sustained rate, for example when a player starts. |
| `PROXY_MAX_CONCURRENT_PER_IP` | `16` | Open upstream connections per IP. `0` disables the cap. |
| `PROXY_MAX_CONCURRENT` | `200` | Open upstream connections for the whole relay. |
| `PROXY_TRUST_PROXY` | `true` | Take the client IP from `X-Forwarded-For`, which Caddy sets. Keep it `true` in compose. With `false` every viewer appears as Caddy's address and shares one budget. |

Requests are only counted after their signature is checked, so random traffic cannot use up the budget.

**What to watch:** *Rate-limited requests*, *Relay in-flight requests* and *Relay bytes* in Grafana.
A few `429`s per hour is normal. A steady rate usually means a whole office or mobile carrier sits behind one IP,
which calls for a higher `PROXY_RATE_LIMIT_RPS` and `PROXY_MAX_CONCURRENT_PER_IP`. Raising the limits also raises
the egress cost, which is the real expense of the relay (see Capacity above).

### Blocking a channel

`infra/scripts/block-channel.sh <channel-id>` hides a channel on this instance, on top of iptv-org's own blocklist.
It appends the id to the api's `LOCAL_BLOCKLIST` file in the data volume (a JSON array) and, if `ADMIN_TOKEN` is set
in `.env`, asks the api to re-ingest so the change applies at once. Without the token the change applies at the
next scheduled ingest. Running it again for the same id changes nothing. Ids are letters, digits and `._@:+-` only.

## Backups

The state worth keeping is the `data` volume (the guide file represents hours of grabbing, and the local
blocklist is yours) and `caddy_data` (certificates, which Let's Encrypt rate-limits when re-issued). The catalog is
rebuilt from the internet anyway.

```sh
infra/scripts/backup.sh          # no downtime: catalog snapshot, data-DATE.tgz, caddy-DATE.tgz in ./backups
```

The catalog is copied with SQLite's online backup API, so the api keeps serving while it runs. Copy the
`backups/` directory off the host regularly. `.env` is part of the backup as well, because it holds
`PROXY_SECRET`. Losing that secret is harmless: players just re-fetch URLs.

Restore: see [DEPLOY.md](DEPLOY.md#backups). Put the data archive back into the `data` volume with the api
stopped, then start the stack again.

## Capacity and sizing

Measured on the catalog as of October 2026 (31.5k channels, 16k streams):

| Thing | Figure |
|-------|--------|
| Catalog rebuild | ~3.5 s, ~60 MB download when datasets changed (ETag skip otherwise) |
| `catalog.db` | ~120 MB with a full guide; WAL checkpointed after each import |
| API list queries | 7–40 ms server-side; `/api/playlist.m3u` for all channels ~0.4 s / 2.7 MB |
| XMLTV import | ~22k programmes/s, flat ~200 MB RSS regardless of file size |
| EPG grab, `EPG_SITES=all`, `EPG_DAYS=2` | ~25k HTTP requests to guide sites; hours per run; 2 CPU cores and a 4 GB RAM limit in compose |
| Relay | roughly 2–8 Mbit/s per concurrent viewer who needed the relay; bounded by `PROXY_MAX_CONCURRENT` (200) and `PROXY_MAX_BYTES` per response |
| Idle footprint | api ~120 MB RAM, proxy ~40 MB, web ~20 MB, epg ~150 MB between runs |

An Oracle Always-Free A1.Flex (4 OCPU / 12 GB) is comfortable: api ~150 MB, proxy ~40 MB, web ~20 MB, epg up to its 4 GB limit during a grab. A 1 vCPU / 1 GB VPS runs the site fine with
`epg` disabled or narrowed to a handful of sites. Bandwidth is the real cost: the relay re-serves
video, so watch your provider's egress allowance if the site gets popular (Oracle's free tier includes
10 TB/month).

## Security posture

- Only ports 80/443 are published. `api`, `proxy`, `epg` are reachable solely through Caddy on the
  compose network.
- The relay rejects anything not signed with `PROXY_SECRET`, and refuses private/loopback/link-local
  targets even when signed (SSRF). It strips upstream cookies and CORS headers.
- The api is read-only to the public; `/api/admin/*` requires `ADMIN_TOKEN` and is off when the token is empty.
- Caddy sets `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and a CSP with
  `frame-ancestors 'self'`. There is deliberately no `script-src`, because hls.js and the Cast SDK need blob/gstatic.
- Nothing here collects personal data: no accounts, no analytics, favorites stay in the viewer's browser.
- See [../SECURITY.md](../SECURITY.md) for reporting issues.

## Monitoring (optional)

A free uptime monitor hitting `https://$DOMAIN/api/health` every few minutes catches most outages.
For something richer, `GET /api/meta` is cheap and exposes the freshness numbers above; alert when
`lastIngest` is older than 24 h or `programmes` drops to 0 after having been populated.

### Grafana dashboard (monitoring profile)

Enable the profile as described in [DEPLOY.md](DEPLOY.md#monitoring-optional). The **FreeTV** dashboard has four
groups of panels, read top to bottom:

1. **Catalog:** channel and stream counts, and programme rows.
2. **Freshness:** seconds since the last catalog ingest, EPG import and probe pass. Orange and red thresholds are
   set for the default intervals. A red EPG panel usually means the `epg` container has stopped or failed.
3. **Relay:** request rate by status, bytes by direction, rate-limited requests, in-flight requests, upstream errors
   and p95 latency. These come from the proxy's `/metrics`.
4. **API:** p95 latency and request rate by status.

Prometheus keeps 30 days by default. Panels are read-only in the UI (provisioned from the repository), so change the
JSON in `infra/monitoring/grafana/dashboards/` and restart Grafana to change them.
