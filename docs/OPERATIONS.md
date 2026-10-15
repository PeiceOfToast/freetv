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

Docker's default json-file driver does not rotate logs. Add to `/etc/docker/daemon.json` and
restart Docker:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
```

## Routine tasks

**Update to the latest code.** `infra/scripts/update.sh` — pulls, rebuilds or pulls images, restarts,
reloads Caddy if its config changed, prunes old images. Zero-ish downtime: Caddy keeps serving while
`api` restarts (a few seconds); the catalog is on disk so there is no re-ingest.

**Force a catalog refresh.** Set `ADMIN_TOKEN` in `.env` (then `docker compose up -d api`), and:

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://$DOMAIN/api/admin/ingest
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://$DOMAIN/api/admin/epg/import
```

**Force a guide grab.** `docker compose restart epg` (it grabs on start when `EPG_RUN_ON_START=true`).

**Narrow or widen the guide.** Edit `EPG_SITES` / `EPG_EXCLUDE_SITES` in `.env`,
`docker compose up -d epg`. Site names are the folder names in
[iptv-org/epg/sites](https://github.com/iptv-org/epg/tree/master/sites).

**Rotate the relay secret.** `infra/scripts/gen-secret.sh --write --force` then
`docker compose up -d api proxy`. Relay URLs already open in players stop working (they are re-fetched
on the next channel open); this is harmless.

**Turn the relay off/on.** Edit `COMPOSE_PROFILES` (remove or add `proxy`) and `PROXY_ENABLED`,
then `docker compose up -d --remove-orphans`.

## Backups

The only state worth keeping is the `data` volume (catalog is rebuilt from the internet anyway, but
the guide file represents hours of grabbing) and `caddy_data` (certificates; also re-creatable, but
Let's Encrypt rate-limits re-issuance).

```sh
docker compose stop api epg
docker run --rm -v freetv_data:/data -v $PWD:/backup alpine tar czf /backup/freetv-data.tgz -C / data
docker run --rm -v freetv_caddy_data:/data -v $PWD:/backup alpine tar czf /backup/freetv-caddy.tgz -C / data
docker compose start api epg
```

Restore by extracting into the volumes before the first `up`. `.env` is the other thing to keep
(it holds `PROXY_SECRET`; losing it is harmless, players just re-fetch URLs).

## Capacity and sizing

Measured on the catalog as of October 2026 (31.5k channels, 16k streams):

| Thing | Figure |
|-------|--------|
| Catalog rebuild | ~3.5 s, ~60 MB download when datasets changed (ETag skip otherwise) |
| `catalog.db` | ~120 MB with a full guide; WAL checkpointed after each import |
| API list queries | 7–40 ms server-side; `/api/playlist.m3u` for all channels ~0.4 s / 2.7 MB |
| XMLTV import | ~22k programmes/s, flat ~200 MB RSS regardless of file size |
| EPG grab, `EPG_SITES=all`, `EPG_DAYS=2` | ~25k HTTP requests to guide sites; hours per run; 1–2 CPU cores busy; 2 GB RAM limit in compose |
| Relay | roughly 2–8 Mbit/s per concurrent viewer who needed the relay; bounded by `PROXY_MAX_CONCURRENT` (200) and `PROXY_MAX_BYTES` per response |
| Idle footprint | api ~120 MB RAM, proxy ~40 MB, web ~20 MB, epg ~150 MB between runs |

An Oracle A1.Flex (4 OCPU / 24 GB) is comfortable. A 1 vCPU / 1 GB VPS runs the site fine with
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
