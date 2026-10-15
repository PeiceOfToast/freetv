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
