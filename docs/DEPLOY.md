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

## Monitoring (optional)

The `monitoring` profile adds Prometheus (scrapes the api and proxy `/metrics` endpoints on the compose
network) and Grafana with one provisioned dashboard, **FreeTV**.

```sh
# .env
COMPOSE_PROFILES=proxy,epg,monitoring
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
- The dashboard panels map to the metrics listed under `GET /metrics` in [API.md](API.md). The relay panels
  (`freetv_proxy_*`) need the proxy to expose `/metrics`. Until it does, the proxy target is down and those
  panels stay empty. Everything else still works.
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
COMPOSE_PROFILES=proxy,epg,autoupdate
WATCHTOWER_SCHEDULE=0 0 4 * * *                   # 6-field cron (seconds first), default 04:00 daily
```

Watchtower polls the registry once a day and recreates only the containers labelled
`com.centurylinklabs.watchtower.enable=true` (all FreeTV services are).

Trade-offs:

- It only helps when you **pull published images** from GHCR. A `--build` host gets no benefit, and Watchtower may
  replace a local build with whatever is on GHCR. Use option A there.
- It updates **images only**. It does not `git pull`, so changes to `docker-compose.yml`, `infra/caddy/Caddyfile`,
  `.env` or new env variables are not applied. You can end up running new images with an old checkout.
- It needs `/var/run/docker.sock`. Whoever controls that container controls the host. The image tag
  `nickfedor/watchtower:latest` is not pinned. Pin it to a version you have checked before enabling this.
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
