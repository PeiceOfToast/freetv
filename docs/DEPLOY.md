# Deploying FreeTV

FreeTV runs as a Docker Compose stack on any Linux host with Docker. Four containers:

| Service | Always on? | Role |
|---------|-----------|------|
| `web` | yes | Caddy: serves the SPA, reverse-proxies `/api` and `/proxy`, HTTPS when `DOMAIN` is set |
| `api` | yes | Catalog (SQLite), JSON API, EPG importer, proxy URL signing |
| `proxy` | profile `proxy` (off by default) | Optional HLS relay for streams that fail in the browser. Off in hub mode; see [OPERATIONS: Relay](OPERATIONS.md#relay-off-by-default) |
| `epg` | profile `epg` | TV guide grabber (iptv-org/epg), writes XMLTV into the shared `data` volume |

Only ports 80 and 443 are published. The api and proxy are reachable only through Caddy.

Oracle Cloud Always Free users: see [DEPLOY-ORACLE.md](DEPLOY-ORACLE.md) and `infra/deploy/oracle/`.

## Requirements

- Linux with Docker Engine 24+ and the Compose plugin (`docker compose version`).
- Ports 80 and 443 reachable from the internet (required for HTTPS certificates).
- For HTTPS: a domain whose DNS A (and optionally AAAA) record points at the host.
- Architecture: amd64 or arm64. All images are multi-arch.
- Memory: `api` is capped at 1 GB and `epg` at 4 GB. On a host with less than 6 GB, narrow `EPG_SITES` and set
  `EPG_SPLIT_BY_SITE=true`, or drop the `epg` profile.

## Install

```sh
git clone https://github.com/PeiceOfToast/freetv.git freetv && cd freetv   # or your fork's URL
cp .env.example .env
infra/scripts/gen-secret.sh --write      # sets PROXY_SECRET (required)
# edit .env: set DOMAIN=tv.example.com for automatic HTTPS
docker compose up -d --build              # or: docker compose pull && docker compose up -d
docker compose ps
```

Open `https://<DOMAIN>` (or `http://<host>` when `DOMAIN` is empty). The catalog is downloaded on
first start; channels appear within a few minutes.

`--build` builds the images from this checkout. The core services (`web` and `api`, plus `proxy` when its profile is on)
build and start first. `epg` builds last, on its own, because it downloads the grabber from the network. If that build
fails, the rest of the stack stays up and you see a warning. Retry it with `docker compose up -d --build epg`.

Pulling published images from GHCR (`ghcr.io/<GITHUB_REPOSITORY_OWNER>/freetv-<svc>:<FREETV_TAG>`) needs
`GITHUB_REPOSITORY_OWNER` set to the lowercase owner whose CI pushed them. Left empty (the default), the
namespace is `local`, which nothing is published to. Compose then builds locally, and `update.sh` never pulls.

## Configuration

All settings live in `.env`. The full list with comments is in `.env.example`; the meaning of
each variable is in `docs/ARCHITECTURE.md`. The ones you are most likely to change:

| Variable | Notes |
|----------|-------|
| `DOMAIN` | Empty = HTTP on port 80. Set it for automatic HTTPS. |
| `PROXY_SECRET` | Required. Regenerate with `infra/scripts/gen-secret.sh --write --force` only if you accept invalidating existing signed URLs. |
| `COMPOSE_PROFILES` | `epg` by default: hub mode, no relay. Add `proxy` to turn the relay on (with `PROXY_ENABLED=true`). Remove a name to disable that container. |
| `PROXY_ENABLED` | `false` in `.env.example`. Must match the `proxy` profile. The code and compose fall back to `true` when the variable is absent, so keep it in `.env`. |
| `EPG_SITES` | `all` grabs every guide source and is slow and CPU-heavy. Narrow it, e.g. `EPG_SITES=tvguide.com,bbc.co.uk`. On small hosts, also set `EPG_SPLIT_BY_SITE=true`. |
| `GITHUB_REPOSITORY_OWNER` | Empty builds locally. Set it to your lowercase GitHub owner only once your CI has pushed images. |
| `LOG_LEVEL` | `warn` by default for api and proxy. Logs rotate at 20 MB, five files per container. |
| `EPG_DAYS`, `EPG_INTERVAL_HOURS` | Schedule length and how often the grabber runs. |
| `ADMIN_TOKEN` | Enables `POST /api/admin/ingest` and `/api/admin/epg/import` with `Authorization: Bearer <token>`. |

After changing `.env`, apply it with `docker compose up -d`. Compose recreates only the containers
whose configuration changed.

### Narrowing the TV guide

Set `EPG_SITES` to a comma list of iptv-org/epg site names, then `docker compose up -d`. Guide data
is replaced atomically on each grab, so the site keeps serving the previous guide until the new one is ready.

`EPG_SITES=all` (the default) is the full guide and needs the 4 GB the `epg` container is allowed. On a host
with less memory, use a curated list and `EPG_SPLIT_BY_SITE=true`. Each site then runs on its own, so one slow
site cannot stall the run or take the whole guide down with it.

### Turning the relay on or off

The relay is off by default. Read [OPERATIONS: Relay](OPERATIONS.md#relay-off-by-default) first: it sets out what the
relay costs in bandwidth and how to cap it.

To turn it on, set `COMPOSE_PROFILES=proxy,epg` and `PROXY_ENABLED=true`, then `docker compose up -d --remove-orphans`.

To turn it off (the default state):

1. Remove `proxy` from `COMPOSE_PROFILES` in `.env` (`COMPOSE_PROFILES=epg`).
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

`update.sh` needs a git checkout and refuses to run while `PROXY_SECRET` is still the placeholder. It updates the
core services first (`web` and `api`, and `proxy` when its profile is on) and `epg` last. If the `epg` pull or build fails, it prints a warning and keeps the
running guide container. With an empty `GITHUB_REPOSITORY_OWNER` it builds and never pulls.

**Upgrading from an earlier release.** The api, proxy and epg images now run as uid 1000 (`node`). A data volume
created by the older api is owned by root and would block them. `update.sh` fixes the ownership once, automatically,
before it starts the services. If you update by hand with `docker compose up -d --build`, run the one-time fix first.
See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#eacces-on-data-after-an-update).

## Backups

All state is in two named volumes, both prefixed with the project name (`freetv`):

| Volume | Contents | Loss impact |
|--------|----------|-------------|
| `freetv_data` | `catalog.db`, raw datasets, `epg/guide.xml`, the local blocklist | The catalog is re-downloaded automatically. The guide is re-grabbed, but that takes hours. |
| `freetv_caddy_data` | TLS certificates and ACME account | Certificates are re-issued on start. Back it up to avoid Let's Encrypt rate limits. |

Run the backup script. Nothing is stopped, and the catalog is copied with SQLite's online backup, so the
snapshot is consistent even while the api is serving requests:

```sh
infra/scripts/backup.sh          # writes catalog-DATE.db, data-DATE.tgz and caddy-DATE.tgz into ./backups
```

Set `BACKUP_DIR=/path` to write elsewhere. The script keeps every run; delete old files yourself.
Keep `.env` in the backup too: it holds `PROXY_SECRET`. Copy the backups off the host.

Restore: stop the stack (`docker compose down`), put the `data-*.tgz` back with the same `tar` in reverse
(`docker run --rm -v freetv_data:/data -v "$PWD/backups:/backup" node:22-bookworm-slim tar -xzf /backup/data-DATE.tgz --owner=1000 --group=1000 -C /data`),
then start again. The catalog is rebuilt by the next ingest. Use `catalog-DATE.db` only if you need the
catalog back before that ingest can run.

## Operating

```sh
docker compose ps                  # status and health
docker compose logs -f api         # also: web, proxy, epg
docker compose restart web         # after editing infra/caddy/Caddyfile, or: docker compose exec web caddy reload --config /etc/caddy/Caddyfile
```

## Troubleshooting

**`/proxy` returns 502.** The relay is off (the default) or down. With the default, nothing should call `/proxy`; if
something does, `PROXY_ENABLED` is probably still `true`. If you turned the relay on, check that `COMPOSE_PROFILES`
includes `proxy`, then `docker compose logs proxy`. To switch it off, see the steps above.
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

**`epg` restarts with `EACCES` or does not start after an update.** The data volume has the wrong owner for uid 1000.
See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#eacces-on-data-after-an-update).

**Builds are slow on small hosts.** The first `--build` compiles every image on the box. Pulling
published images avoids that.

## Monitoring (optional)

The `monitoring` profile adds Prometheus (scrapes the api and proxy `/metrics` endpoints on the compose
network) and Grafana with one provisioned dashboard, **FreeTV**.

```sh
# .env
COMPOSE_PROFILES=epg,monitoring                   # add proxy if the relay is on
GRAFANA_ADMIN_PASSWORD=<a long random password>    # openssl rand -hex 24
```

```sh
docker compose up -d
ssh -L 3002:127.0.0.1:3002 <user>@<host>          # from your laptop
# then open http://localhost:3002 and log in as admin
```

- Grafana listens on `127.0.0.1:3002` only. It is not behind Caddy and has no public route. Reach it
  through the SSH tunnel above. If you want it public, put it behind your own authenticated proxy; that is out of scope here.
- Prometheus publishes no port and keeps 30 days of data (`PROMETHEUS_RETENTION`). Each container is capped
  at 512 MB.
- `update.sh` refuses to run with the monitoring profile enabled and the placeholder password.
- The dashboard panels map to the metrics listed under `GET /metrics` in [API.md](API.md). The proxy serves its
  own `/metrics` on port 3001 inside the compose network, which is what feeds the relay panels (`freetv_proxy_*`).
  Like the api's, that port is not published and Caddy does not route it.
- Disable: remove `monitoring` from `COMPOSE_PROFILES`, then `docker compose up -d --remove-orphans`.
  Data stays in the `prometheus_data` and `grafana_data` volumes until you remove them.
- The free uptime check on `/api/health` in [OPERATIONS.md](OPERATIONS.md) still works without this profile.

## Automatic updates (optional)

Two ways to update unattended. Pick one. Neither is on by default.

### A. Weekly systemd timer (recommended)

Runs `infra/scripts/update.sh` as the service user every Sunday at 04:00 (plus up to 30 minutes of random delay).
It does `git pull --ff-only`, pulls images or builds them, restarts, reloads Caddy if its config changed, and prunes.
It works for both deployment styles.

```sh
sudo infra/auto-update/install.sh                 # pull published images; build if missing
sudo infra/auto-update/install.sh --build         # always build from this checkout
sudo infra/auto-update/install.sh --dir /opt/freetv --user freetv
systemctl list-timers freetv-update.timer         # next run
journalctl -u freetv-update.service -n 200        # last run's output
sudo infra/auto-update/install.sh --uninstall
```

- The checkout must be a git clone owned by the service user, and that user must be in the `docker` group.
  The installer warns otherwise.
- A failed `git pull` (dirty tree, diverged branch) stops the run before anything is restarted. The stack
  keeps running the old code.
- Read the release notes before you accept an update. New env variables are not added to your `.env`
  automatically; `.env.example` lists them.

### B. Watchtower (`autoupdate` profile)

```sh
# .env
COMPOSE_PROFILES=epg,autoupdate                   # add proxy if the relay is on
WATCHTOWER_SCHEDULE=0 0 4 * * *                   # 6-field cron (seconds first), default 04:00 daily
```

Watchtower polls the registry once a day and recreates only the containers labelled
`com.centurylinklabs.watchtower.enable=true` (all FreeTV services are).

Trade-offs:

- It only helps when you **pull published images** from GHCR. A `--build` host gets no benefit, and Watchtower may
  replace a local build with whatever is on GHCR. Use option A there.
- It updates **images only**. It does not `git pull`, so changes to `docker-compose.yml`, `infra/caddy/Caddyfile`,
  `.env` or new env variables are not applied. You can end up running new images with an old checkout.
- It needs `/var/run/docker.sock`. Whoever controls that container controls the host. The image is pinned to
  `containrrr/watchtower:1.7.1`, not `latest`. That project is no longer maintained and can refuse to talk to newer
  Docker Engine versions. Test it on the host (`docker compose logs watchtower`) before you rely on it, and change
  the tag in `docker-compose.yml` if you move to a maintained fork.
- The Caddy reload that `update.sh` does is also not done. A Caddyfile change needs `docker compose restart web`.

## Other hosts (Fly, Hetzner, Kubernetes)

Compose on a single VM is still the supported path. These variants exist for other platforms. **None of them has
been deployed.** They are starting points.

| Target | Where | What it is |
|--------|-------|-----------|
| Hetzner Cloud | [infra/deploy/hetzner/README.md](../infra/deploy/hetzner/README.md) | cloud-init for Ubuntu 24.04 with ufw, plus an `hcloud` one-liner. Same stack as compose. |
| Fly.io | [infra/deploy/fly/README.md](../infra/deploy/fly/README.md) | One Fly app per service: web (public), api (private, one volume). No proxy or epg. |
| Kubernetes | `infra/deploy/helm/freetv/` | Helm chart: Deployments, Services, one PVC, and an Ingress routing `/api`, `/logo`, `/proxy` and `/`. Set `domain`, `secrets.proxySecret` and a ReadWriteMany storage class. |

Things to know before you pick one:

- **Fly** cannot run compose and cannot share a volume between apps, so `epg` does not fit. The guide is then
  empty unless you move it onto the api volume by hand.
- **Kubernetes** needs ReadWriteMany storage for the shared data volume (api and epg), or both pods pinned to one
  node. The api runs with one replica and the `Recreate` strategy because the catalog is SQLite.
- **Kubernetes:** run `helm lint` and `helm template` before you install. The chart has not been run through
  Helm in a cluster. Check the Ingress for `/logo` and `/proxy`, which the chart routes directly instead of through Caddy.
- Fly and Kubernetes skip the Caddy edge config. Check that `/logo/*` reaches the api in your setup, or logos break.
