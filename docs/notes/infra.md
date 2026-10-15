# Infra notes (track H)

## Verified in this sandbox
- `apps/web` stage 1 (`npm ci && npm run build`) passes on a clean copy.
- `infra/caddy/Caddyfile` validates with Caddy 2.10.2 in both modes (`SITE_ADDRESS=:80` and a domain).
- `docker compose config` resolves with `.env.example` copied to `.env`. Variants checked: `DOMAIN`
  set or empty, profiles disabled, missing `PROXY_SECRET` (fails with a clear message).
- `gen-secret.sh` write, refuse-to-overwrite and `--force` paths checked in a scratch repo.
- The cloud-init YAML parses and its embedded bootstrap script passes `bash -n`.
- `ci.yml` and `cloud-init.yaml` parse as YAML.

## Not verified here
- **Docker image builds (`docker build -f apps/web/Dockerfile apps/web`) could not run.** The sandbox
  cannot reach registry-1.docker.io, ghcr.io or download.docker.com, and the Docker daemon has no
  local base images. Stage 1 was verified natively instead, and stage 2 is a stock `caddy:2-alpine`
  copy. Run `docker build -f apps/web/Dockerfile apps/web` on a machine with registry access.
- Oracle cloud-init has not been run on a real instance.
- GitHub Actions workflow not run (no runner here). `actionlint` was not available.

## Contract gaps and open items for the integrator
1. **Dockerfiles missing.** `apps/proxy/Dockerfile` and `apps/epg/Dockerfile` do not exist yet.
   Compose and CI reference both (CI builds all four images), so the images job fails until they land.
   Proxy needs `PORT=3001` and `/healthz`; epg is expected as a multi-stage node:22-bookworm-slim build.
2. **Lockfiles.** CI runs `npm ci` with `cache: npm`, which needs `apps/proxy/package-lock.json`.
   It is not in the repo yet. Track F must commit it.
3. **Caddy copy is duplicated on purpose.** `apps/web/Caddyfile` is the image default (the Docker
   build context is `apps/web`, so it cannot read `infra/`). `infra/caddy/Caddyfile` is the runtime
   copy, bind-mounted into `web`. CI runs `diff` on the two and fails on drift. Edit `infra/caddy/`
   and copy it over.
4. **Proxy path is hard-coded in Caddy.** `/proxy/*` is routed in the Caddyfile. Changing
   `PROXY_PUBLIC_PATH` requires a matching Caddyfile edit. `.env.example` says so.
5. **Proxy 502 instead of 503.** When the proxy profile is off, Caddy returns 502 (upstream does not
   resolve). The spec allowed this; the UI should treat any `/proxy` failure as unavailable.
6. **`PROXY_SECRET` placeholder.** `.env.example` ships `PROXY_SECRET=change-me-...`.
   Compose only checks that it is non-empty. `update.sh` refuses to run while it starts with
   `change-me`. The api and proxy do not check it, so a manual deploy could run with the placeholder.
   Consider the api refusing to start on a `change-me` prefix.
7. **Env vars the api reads but the table does not list:** `EPG_POLL_SECONDS` (default 60), `LOG_LEVEL`,
   `HOST`, `APP_VERSION`. Not set by compose; defaults apply. Add to ARCHITECTURE if they should be
   tunable.
8. **`PROXY_MAX_BYTES`** is in the spec but not in ARCHITECTURE. Compose defaults it to 52428800
   (the proxy's own default). Add it to ARCHITECTURE's table.
9. **`GITHUB_REPOSITORY_OWNER` default is `freetv`.** Forks must set it in `.env` to pull images
   from their own GHCR namespace. CI lowercases the owner for the image name.
10. **Cloud-init placeholders.** `__REPO_URL__` must be replaced before pasting. A placeholder `__DOMAIN__`
    falls back to plain HTTP silently, which is documented but easy to miss.
11. **Port 443/udp** is published for HTTP/3, but Caddy only serves HTTP/3 when it has TLS (`DOMAIN` set).
    Harmless when unused.
12. **Caddy directory mount.** Only `infra/caddy/` is mounted, so `git pull` changes are picked up
    after `caddy reload`. `update.sh` runs the reload when `infra/caddy` changed.

# Track I: infra extras

Scope: `infra/**`, `docker-compose.yml`, `.env.example`, `docs/DEPLOY.md`, `docs/OPERATIONS.md` (sections added only),
this file. `ci.yml` and the frozen contracts were not touched.

## What changed

- **docker-compose.yml**
  - api gets `PROBE_*`, `LOGO_*` and `LOCAL_BLOCKLIST`. proxy gets `PROXY_RATE_LIMIT_RPS`, `PROXY_RATE_LIMIT_BURST`,
    `PROXY_MAX_CONCURRENT_PER_IP` (default 16) and `PROXY_TRUST_PROXY`.
  - Optional services: `prometheus` and `grafana` (profile `monitoring`), `watchtower` (profile `autoupdate`).
  - Every FreeTV service carries the label `com.centurylinklabs.watchtower.enable=true`. One-time effect: the first `up`
    after pulling this recreates the containers, because their labels changed.
  - Compose interpolates every service even when its profile is off, so a `:?` on a monitoring-only variable breaks the
    default stack. Grafana therefore uses a placeholder default, and `update.sh` refuses it when `monitoring` is enabled.
- **.env.example**: new variables commented and grouped (Prober, Logo cache, Operator blocklist, Relay limits, Monitoring,
  Auto-updates).
- **infra/monitoring/**: Prometheus config (api:3000 and proxy:3001), Grafana datasource and dashboard provisioning, and the
  dashboard JSON `grafana/dashboards/freetv.json` (19 panels, 4 groups).
- **infra/auto-update/**: `freetv-update.service.in` (template), `freetv-update.timer` (Sunday 04:00, random delay up to 30 min),
  `install.sh` (`--build`, `--dir`, `--user`, `--uninstall`).
- **infra/scripts/update.sh**: refuses to run when `monitoring` is enabled with an unset or placeholder `GRAFANA_ADMIN_PASSWORD`.
- **infra/scripts/block-channel.sh**: validates the id, appends it to `LOCAL_BLOCKLIST` inside the api container, and calls
  `POST /api/admin/ingest` when `ADMIN_TOKEN` is set. The token is read inside the container, not passed on the command line.
- **infra/deploy/hetzner/**: cloud-init (ufw instead of iptables) and README with an `hcloud server create` line.
- **infra/deploy/fly/**: README, `web/` (Dockerfile, generated Caddyfile, fly.toml) and `api/fly.toml`.
- **infra/deploy/helm/freetv/**: chart with Deployments for web, api, proxy and epg, Services, one PVC, one Secret,
  and an Ingress that routes `/api`, `/logo`, `/proxy` and `/`.
- **docs/DEPLOY.md**: "Monitoring (optional)", "Automatic updates (optional)" (systemd timer and Watchtower trade-offs),
  "Other hosts (Fly, Hetzner, Kubernetes)".
- **docs/OPERATIONS.md**: "Stream health prober", "Logo cache", "Relay rate limits" and "Blocking a channel" under Routine
  tasks; "Grafana dashboard" at the end.

## Verified in this sandbox

- `docker compose config -q` with `.env.example` copied to `.env` (dummy `PROXY_SECRET`) for the profile sets: `proxy,epg`;
  empty; `proxy,epg,monitoring`; `proxy,epg,autoupdate`; `proxy,epg,monitoring,autoupdate`; `epg`; `monitoring`. Also with
  `GRAFANA_ADMIN_PASSWORD` set. `.env` removed afterwards.
- `bash -n` on every script under `infra/scripts` and `infra/auto-update`.
- `block-channel.sh` run end to end through a `docker` shim that executes the node snippet locally: first block, repeat block
  (no change), bad id rejected (exit 2), non-array file rejected, and the ingest call with a token (fake server saw
  `POST /api/admin/ingest` with the bearer token, HTTP 202).
- `update.sh` Grafana guard: unset and placeholder passwords refused, and the real password passes the guard.
- `systemd-analyze verify` on the rendered service and timer, with the real checkout path.
- YAML parses for the Prometheus config, Grafana provisioning, Hetzner cloud-init (and its embedded script passes `bash -n`).
  TOML parses for both Fly files. The dashboard JSON parses.
- Dashboard metric names checked against `apps/proxy/src/metrics.ts` (`freetv_proxy_requests_total{kind,status}`,
  `_bytes_total{direction}`, `_active_requests`, `_rate_limited_total`, `_upstream_errors_total{reason}`,
  `_request_duration_seconds` histogram) and `docs/API.md` (api metrics).
- Helm chart: no `helm` binary available (see below). Rendered with a stdlib `text/template` stand-in (Sprig stubs, `toYaml`
  as JSON) for three value sets. Results: default (proxy and epg on, RWX storage class), proxy and epg off with an existing
  Secret and no TLS, and an empty domain (fails with the `required` message). The rendered objects were checked for kinds,
  names, env, mounts, strategy, Ingress paths and the Secret.

## Not verified (blocked in this sandbox)

- **helm**: `get.helm.sh` returns 403 from the egress proxy. `go install` of helm could not reach the Go module proxy
  (`proxy.golang.org` does not resolve). Run `helm lint` and `helm template` before any real install.
- **promtool**: same reason (`go install` of the Prometheus module). The Prometheus config was checked with a YAML parse only.
- **Docker images**: no registry access, so Prometheus, Grafana and Watchtower were never pulled or started. The dashboard
  was not loaded in Grafana.
- **Caddy**: no caddy binary, so the generated Fly Caddyfile was not validated.
- **Fly, Hetzner, Kubernetes**: nothing deployed. Marked untested in each README.
- **install.sh**: not run as root, so nothing was installed on this host.

## Requests for the integrator (outside my paths)

1. **Logos are not routed at the edge (bug, default config).** `LOGO_CACHE_ENABLED` defaults to true, so channel logos
   are `/logo/<id>`. Caddy only proxies `/api/*`, so `/logo/*` falls through to the SPA `index.html`. Add this to
   `infra/caddy/Caddyfile` and to `apps/web/Caddyfile` (CI diffs the two, so both must change together), before the
   `# HLS relay.` block:
   ```
   	# Channel logos (LOGO_CACHE_ENABLED=true returns /logo/<id>). Not under /api, so route explicitly.
   	handle /logo/* {
   		reverse_proxy api:3000
   	}
   ```
   Then `docker compose restart web`. The Fly copy in `infra/deploy/fly/web/Caddyfile` already has it. I did not change
   `infra/caddy/Caddyfile` myself, because it would make CI's drift check fail until `apps/web/Caddyfile` changes too.
2. **ARCHITECTURE.md env table** is missing `PROXY_MAX_CONCURRENT_PER_IP` (default 16, 0 disables; the proxy reads it).
   Also missing: `GRAFANA_ADMIN_PASSWORD`, `PROMETHEUS_RETENTION` and `WATCHTOWER_SCHEDULE`, which are only used by the optional
   profiles. `LOGO_CACHE_DIR` defaults to `$DATA_DIR/logos` there, and compose passes `/data/logos` explicitly.
3. **docs/API.md `GET /metrics`** lists only api metrics. Add the proxy's (names above, as implemented in `metrics.ts`) so the
   contract matches the dashboard. The api's `/metrics` is still a stub in `routes/admin.ts`, so the api panels stay empty
   until that lands.
4. **ci.yml** runs `docker compose config` with defaults only. Consider a matrix that adds `monitoring` and `autoupdate`
   (the `GRAFANA_ADMIN_PASSWORD` placeholder keeps that working without a value). I did not edit ci.yml.
5. **Unverified image references**: `prom/prometheus:v3.5.0`, `grafana/grafana:11.6.0`, `nickfedor/watchtower:latest`.
   I could not pull any of them. Check the names and pin the Watchtower tag before anyone enables `autoupdate`.
   The Hetzner server types (`cax21`, `cx22`) are from memory and should be checked against `hcloud server-type list`.
6. **Fly Caddyfile drift**: `infra/deploy/fly/web/Caddyfile` is a generated copy of `infra/caddy/Caddyfile` with two changes
   (configurable upstreams, `/logo/*`). Regenerate it when the main Caddyfile changes. CI does not check it.

## Decisions to review

- The compose default for `PROXY_MAX_CONCURRENT_PER_IP` is 16. The task did not specify a value. The proxy's `config.ts`
  uses the same default.
- Grafana's password has a placeholder default (`change-me-grafana`) rather than a required variable, for the reason above.
  The guard in `update.sh` is the only check, so a host that runs compose directly can still start Grafana with the placeholder.
  The Grafana port is bound to loopback.
- Watchtower runs only with the `autoupdate` profile and needs the Docker socket. Documented as opt-in; the systemd timer
  is the recommended mechanism.
