# Deploying FreeTV

FreeTV runs as a Docker Compose stack on any Linux host with Docker. Four containers:

| Service | Always on? | Role |
|---------|-----------|------|
| `web` | yes | Caddy: serves the SPA, reverse-proxies `/api` and `/proxy`, HTTPS when `DOMAIN` is set |
| `api` | yes | Catalog (SQLite), JSON API, EPG importer, proxy URL signing |
| `proxy` | profile `proxy` | HLS relay for streams that fail in the browser directly |
| `epg` | profile `epg` | TV guide grabber (iptv-org/epg), writes XMLTV into the shared `data` volume |

Only ports 80 and 443 are published. The api and proxy are reachable only through Caddy.

Oracle Cloud Always Free users: see [DEPLOY-ORACLE.md](DEPLOY-ORACLE.md) and `infra/deploy/oracle/`.

## Requirements

- Linux with Docker Engine 24+ and the Compose plugin (`docker compose version`).
- Ports 80 and 443 reachable from the internet (required for HTTPS certificates).
- For HTTPS: a domain whose DNS A (and optionally AAAA) record points at the host.
- Architecture: amd64 or arm64. All images are multi-arch.
- Memory: `api` is capped at 1 GB and `epg` at 2 GB. A 2 GB host works if you narrow `EPG_SITES` or drop the `epg` profile.

## Install

```sh
git clone <repo-url> freetv && cd freetv
cp .env.example .env
infra/scripts/gen-secret.sh --write      # sets PROXY_SECRET (required)
# edit .env: set DOMAIN=tv.example.com for automatic HTTPS
docker compose up -d --build              # or: docker compose pull && docker compose up -d
docker compose ps
```

Open `https://<DOMAIN>` (or `http://<host>` when `DOMAIN` is empty). The catalog is downloaded on
first start; channels appear within a few minutes.

`--build` builds the four images from this checkout. Omit it to pull published images from GHCR
(`ghcr.io/<GITHUB_REPOSITORY_OWNER>/freetv-<svc>:<FREETV_TAG>`). Set `GITHUB_REPOSITORY_OWNER` to the
lowercase owner of the repo whose images you want.

## Configuration

All settings live in `.env`. The full list with comments is in `.env.example`; the meaning of
each variable is in `docs/ARCHITECTURE.md`. The ones you are most likely to change:

| Variable | Notes |
|----------|-------|
| `DOMAIN` | Empty = HTTP on port 80. Set it for automatic HTTPS. |
| `PROXY_SECRET` | Required. Regenerate with `infra/scripts/gen-secret.sh --write --force` only if you accept invalidating existing signed URLs. |
| `COMPOSE_PROFILES` | `proxy,epg` by default. Remove a name to disable that container. |
| `EPG_SITES` | `all` grabs every guide source and is slow and CPU-heavy. Narrow it, e.g. `EPG_SITES=tvguide.com,bbc.co.uk`. |
| `EPG_DAYS`, `EPG_INTERVAL_HOURS` | Schedule length and how often the grabber runs. |
| `ADMIN_TOKEN` | Enables `POST /api/admin/ingest` and `/api/admin/epg/import` with `Authorization: Bearer <token>`. |

After changing `.env`, apply it with `docker compose up -d`. Compose recreates only the containers
whose configuration changed.

### Narrowing the TV guide

Set `EPG_SITES` to a comma list of iptv-org/epg site names, then `docker compose up -d`. Guide data
is replaced atomically on each grab, so the site keeps serving the previous guide until the new one is ready.

### Disabling the relay (proxy)

1. Remove `proxy` from `COMPOSE_PROFILES` in `.env` (e.g. `COMPOSE_PROFILES=epg`).
2. Set `PROXY_ENABLED=false` so the api stops issuing proxied stream URLs.
3. `docker compose up -d --remove-orphans`.

Without step 2 the api still returns proxy URLs that point at a container that is not running.
Those URLs fail with 502, and the player treats them as unavailable.

### Disabling the guide

Remove `epg` from `COMPOSE_PROFILES`. The api keeps serving whatever guide file exists in the
`data` volume; the guide page shows nothing new once that data expires.

## Updating

```sh
infra/scripts/update.sh          # git pull, pull images (or build if missing), up -d, reload Caddy if needed, prune
FREETV_BUILD=1 infra/scripts/update.sh   # always build from this checkout
```

`update.sh` needs a git checkout and refuses to run while `PROXY_SECRET` is still the placeholder.

## Backups

All state is in two named volumes, both prefixed with the project name (`freetv`):

| Volume | Contents | Loss impact |
|--------|----------|-------------|
| `freetv_data` | `catalog.db`, raw datasets, `epg/guide.xml` | Re-downloaded or re-grabbed automatically. Back up to keep the guide and avoid a cold start. |
| `freetv_caddy_data` | TLS certificates and ACME account | Certificates are re-issued on start. Back it up to avoid Let's Encrypt rate limits. |

Stop the api while copying `freetv_data` so the SQLite files are consistent, then start it again:

```sh
mkdir -p backups
docker compose stop api
docker run --rm -v freetv_data:/data:ro -v "$PWD/backups:/backup" alpine \
  tar -czf "/backup/data-$(date +%F).tgz" -C /data .
docker compose start api
docker run --rm -v freetv_caddy_data:/data:ro -v "$PWD/backups:/backup" alpine \
  tar -czf "/backup/caddy-$(date +%F).tgz" -C /data .
```

Restore: stop the stack, extract into a fresh volume with the same `tar` pattern (reverse direction),
then start again. Keep `.env` in the backup too: it holds `PROXY_SECRET`.

## Operating

```sh
docker compose ps                  # status and health
docker compose logs -f api         # also: web, proxy, epg
docker compose restart web         # after editing infra/caddy/Caddyfile, or: docker compose exec web caddy reload --config /etc/caddy/Caddyfile
```

## Troubleshooting

**`/proxy` returns 502.** The relay is off or down. Check `COMPOSE_PROFILES` includes `proxy`, then
`docker compose logs proxy`. If you deliberately disabled it, set `PROXY_ENABLED=false` (see above).
Caddy returns 502 when the upstream container does not resolve or refuses connections, which is how
the UI learns that the relay is unavailable.

**`/api` returns 502.** The api container is not up yet (first start builds the catalog) or crashed:
`docker compose logs api`. The api has a healthcheck on `/api/health`.

**No HTTPS, or certificate errors.** Check that `DOMAIN` resolves to this host (`dig +short <DOMAIN>`),
that ports 80 and 443 are reachable from outside (not just locally), and that no other web server is
bound to them (`sudo ss -ltnp | grep -E ':(80|443) '`). `docker compose logs web` shows ACME attempts.
Let's Encrypt rate limits repeated failures; fix the cause before restarting repeatedly.

**Port already in use.** Another service owns 80 or 443. Stop it or move FreeTV by editing the
`ports:` entries of `web` in `docker-compose.yml` (for example `8080:80`). Then HTTPS needs a
reverse proxy in front of it.

**`no matching manifest for linux/arm64` (or amd64).** The published image tag is missing for your
architecture, usually because CI has not published that tag yet. Build locally with
`docker compose up -d --build`.

**`PROXY_SECRET ... required`.** `.env` is missing or still empty. Run `infra/scripts/gen-secret.sh --write`.


**Builds are slow on small hosts.** The first `--build` compiles every image on the box. Pulling
published images avoids that.
