# Review fixes D (2026-10-16 review, items 1.1–1.4, 2.3, 2.5, 2.6, 2.8 docs, 3.6 docs, 3.8 docs, 4.5)

Source: `docs/notes/review-2026-10-16-full.md`. Application source was not touched. Nothing is committed.

## EPG_REF used

`8c23cfe7396724ee5297f370415fc04d6fda058c`, the head of iptv-org/epg `master` (merge of PR #3292, 2026-10-07).
Checked with `git ls-remote https://github.com/iptv-org/epg master` on this date, and it matches the checkout at
`/tmp/claude-0/-home-claude/a71a92df-0685-5acd-9194-6f3fd5c66155/scratchpad/epgtest`.

That checkout has a large uncommitted working-tree diff (1330 files, mostly line-for-line changes). The image does not
use it: it fetches the committed sha only. The sha is the default in three places that must match:
`apps/epg/Dockerfile` (`ARG EPG_REF`), `docker-compose.yml` (`build.args`) and `.env.example`.

The image itself was not built: there is no registry access here, and the build was not run.

## Changes by item

**1.1 Shared-volume ownership.** Done.
- `apps/api/Dockerfile`: creates `/data/{epg,raw,logos}`, `chown -R node:node /data` before `VOLUME`, `USER node`.
- `apps/epg/Dockerfile`: uses the image's `node` user (uid/gid 1000) instead of creating uid 10001. `/epg`, `/work`, `/data` are owned by node.
- `apps/proxy/Dockerfile`: already `USER node`. Unchanged.
- `apps/epg/run.mjs`: after `mkdir`, `access(W_OK)` on the output directory. An unwritable directory fails once with a message pointing at docs/TROUBLESHOOTING.md. An existing directory owned by the same uid is accepted.
- `docker-compose.yml`: no `user:` key (the image decides). A comment explains this.
- `infra/scripts/update.sh`: before `up`, checks the owner of `/data` through the api image and runs a one-time `chown -R 1000:1000` if it is wrong. This covers installs upgraded by the timer.
- `docs/TROUBLESHOOTING.md`: "EACCES on /data after an update" with check and manual fix. `docs/DEPLOY.md` and `docs/ARCHITECTURE.md` point there.

**1.2 epg build isolated; EPG_REF pinned.** Done.
- `apps/epg/Dockerfile` fetches the ref with `git init` / `fetch --depth 1 origin <ref>` / `checkout FETCH_HEAD`. `git clone --branch` cannot take a sha. Branch, tag and sha all work.
- `docker-compose.yml`: `build.args.EPG_REF` defaults to the sha; `.env.example` exposes `EPG_REF`.
- `infra/deploy/oracle/cloud-init.yaml`: `compose config --services` lists the active services. Core (`web`, `api`, `proxy`) is built and started first. `epg` runs as a separate step, and a failure only logs a warning.
- `infra/scripts/update.sh`: pulls or builds core, updates the data-volume owner, restarts core, then does `epg` the same way and only warns on failure.
- `docs/GETTING-STARTED.md` and `docs/DEPLOY.md`: the two-step build and how to retry epg.

**1.3 epg sizing.** Done. `mem_limit: 4g`, `cpus: 2`. `.env.example` keeps `EPG_SITES=all` with a comment recommending a curated list on small VMs, and `EPG_SPLIT_BY_SITE=true`. Documented in DEPLOY, GETTING-STARTED, OPERATIONS and TROUBLESHOOTING. The memory need is still unverified (review item 1.3).

**1.4 Duplicate logo Cache-Control.** Done in both `infra/caddy/Caddyfile` and `apps/web/Caddyfile`. The `/logo/*` block is now `reverse_proxy` only, with a comment. `diff` is empty. Caddy validation was not run (no caddy binary here, and CI runs it).

**2.3 Log rotation and levels.** Done.
- `docker-compose.yml`: `x-logging` anchor (json-file, 20m, 5 files) applied to all seven services, profiles included.
- `LOG_LEVEL: ${LOG_LEVEL:-warn}` forwarded to api and proxy. `.env.example` has `LOG_LEVEL=warn`.
- `infra/deploy/oracle/cloud-init.yaml`: writes `/etc/docker/daemon.json` with the same limits before Docker is installed, only if the file is absent.
- Caveats, documented in OPERATIONS: at `warn`, the api hides its ingest and EPG progress lines. The proxy only checks for `silent`, so `warn` still gives it info-level logs. Making proxy `warn` real needs a proxy source change, which was out of scope.

**2.5 Default image namespace.** Done.
- `GITHUB_REPOSITORY_OWNER=` is empty in `.env.example`, with a comment.
- Compose image names are `ghcr.io/${GITHUB_REPOSITORY_OWNER:-local}/freetv-<svc>` (rendered as `ghcr.io/local/...`).
- `update.sh`: empty or `local` owner means build only, never pull.
- Residual risk: `local` is a valid GitHub user or org name, so `ghcr.io/local/...` could in theory exist. `update.sh` never pulls in that case, but a manual `docker compose pull` with an empty owner would try it. A name that cannot be a GitHub owner (for example `local.invalid`) would remove that risk. The spec said `local`, so it was used as written.
- The Fly templates (`infra/deploy/fly/*`) and `infra/deploy/helm` still reference `ghcr.io/freetv/...`. They are UNTESTED and their README says to replace `freetv`. Not changed.

**2.6 Env passthrough.**
- epg now gets `EPG_EXCLUDE_SITES`, `EPG_ONE_SITE_PER_CHANNEL`, `EPG_SPLIT_BY_SITE`, `EPG_TIMEOUT_MS`, `EPG_GRAB_ARGS`, `EPG_REFRESH_API_DATA` and `EPG_OUTPUT`. `EPG_FILE` was removed from the epg service.
- api gets `LOG_LEVEL`, `EPG_POLL_SECONDS`, `APP_VERSION`, `PROXY_URL_TTL_SECONDS` and `PROXY_EXPORT_TTL_SECONDS`. The TTL variables are read by the api track's current `config.ts` (defaults 86400 and 604800, the same as here). Empty values fall back to those defaults.
- proxy gets `LOG_LEVEL` and `PROXY_ALLOW_PRIVATE` (default false). The TTL variables are not passed to proxy, since it checks the signed `exp`.
- `docs/ARCHITECTURE.md` env table: `EPG_FILE` is api-only, `EPG_OUTPUT` is epg. New rows added. The api track's TTL rows were already there, so mine were removed to avoid duplicates.
- `infra/deploy/helm/freetv/values.yaml`: the epg env now uses `EPG_OUTPUT` (it had `EPG_FILE`).

**2.8 docs drift.** Done.
- `docs/DEPLOY.md`: the proxy does expose `/metrics` (port 3001, internal only). The paragraph that said otherwise was corrected.
- `docs/ARCHITECTURE.md`: `EPG_FILE` is listed for api only.
- The admin `lastIngestMs` code issue (`routes/admin.ts`) is not in this scope.

**3.6 Online backups (docs and script).** Done.
- `infra/scripts/backup.sh`: a snapshot of `catalog.db` through better-sqlite3's online backup, run inside the api container and copied out with `docker compose cp`. Also `data-DATE.tgz` (`epg/`, `local-blocklist.json`, only paths that exist) and `caddy-DATE.tgz`. Nothing is stopped.
- `docs/OPERATIONS.md` and `docs/DEPLOY.md` backup sections use the script. Restore is described.
- The relay-secret rotation paragraph in OPERATIONS was already updated on disk by the api/proxy track (it covers TTLs). It was kept as written.

**3.8 assetlinks.json.** Done in `docs/GETTING-STARTED.md`: the file is git-ignored and must be copied into `infra/caddy/` after each fresh clone. `docs/TV.md` and `apps/tv/README.md` are outside this task's file list and were not changed.

**4.5 Watchtower pin.** Done: `containrrr/watchtower:1.7.1`, as the instructions allowed. I could not confirm `nickfedor/watchtower` tags, so I did not use it. Caveat: containrrr is unmaintained, and 1.7.1 may refuse newer Docker Engine API minimums. DEPLOY says to test it on the host before relying on it. If a maintained fork is preferred, it needs a verified tag.

## Verification

- `docker compose config -q` with `.env.example` copied to `.env` and a dummy `PROXY_SECRET`, for profile sets: none, `proxy`, `epg`, `proxy,epg`, `proxy,epg,monitoring`, `proxy,epg,autoupdate`. All pass. `.env` removed afterwards.
- Rendered config: seven services have the logging anchor. epg `EPG_REF` is the sha. epg mem_limit is 4 GiB. Images are `ghcr.io/local/freetv-*:latest`.
- `diff apps/web/Caddyfile infra/caddy/Caddyfile`: empty.
- `bash -n` on `infra/scripts/*.sh` and `infra/auto-update/install.sh`: pass.
- `node --check apps/epg/run.mjs`: pass.
- cloud-init YAML parses. The embedded bootstrap script passes `bash -n`. The daemon.json content is valid JSON.
- Not run: Docker image builds, `update.sh` and `backup.sh` against a live stack, Caddy validation, and the Watchtower tag on a real Docker host. Those need a registry and a daemon with the images.

## Open items for the integrator

1. Proxy `LOG_LEVEL=warn` is accepted but only `silent` changes behaviour (`apps/proxy/src/config.ts`). Source change needed for quiet proxy logs.
2. TROUBLESHOOTING says relay URLs past their expiry return 403. That depends on the proxy track's response code, which was not confirmed.
3. `docs/notes/epg-container.md` still says uid 10001, and `docs/notes/infra.md` still names `nickfedor/watchtower:latest`. Both are notes outside this task's list. `apps/epg/README.md` mentions `EPG_FILE` for the epg container. Not changed.
4. Fly and Helm templates reference the `freetv` GHCR namespace (see 2.5).
5. `docs/TV.md` and `apps/tv/README.md` would benefit from the git-ignored assetlinks note (see 3.8).
