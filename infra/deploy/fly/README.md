# Deploying FreeTV on Fly.io (untested)

**Status: untested.** The files here were written against the Fly docs and the published images, but
no Fly deploy has been run. Treat them as a starting point and expect to adjust app names and flags.

## Why this is not a compose deploy

Fly runs OCI images as separate **apps**. It has no compose runtime, and a Fly volume cannot be shared
between apps. The compose stack's shape therefore becomes:

| Compose service | Fly app | Notes |
|-----------------|---------|-------|
| `web` (Caddy + SPA) | `freetv-web`, public HTTP service | Fly terminates TLS. `API_UPSTREAM` points at the api over private DNS. |
| `api` | `freetv-api`, private only | One machine, one Fly volume `freetv_data` mounted at `/data`. |
| `proxy` | not deployed | `PROXY_ENABLED=false`. Streams that need the relay will not play. |
| `epg` | not deployed | It writes `/data/epg/guide.xml` on the same volume as the api, which Fly cannot share across apps. Options: run it on a separate host and copy the guide file into the api volume, or accept no guide. |

Service names change too. Compose uses `api:3000`. Fly uses `<app>.internal:3000`. The
`infra/deploy/fly/web/Caddyfile` reads that from `API_UPSTREAM`. It is a generated copy of
`infra/caddy/Caddyfile` with the upstream made configurable and the `/logo/*` route added.

## Steps

1. Install `flyctl` and log in: `fly auth login`.
2. Pick unique app names. Edit `api/fly.toml` and `web/fly.toml` if you do not use `freetv-api` and `freetv-web`.
   If you rename the api app, change `API_UPSTREAM` in `web/fly.toml` to match.
3. Create the api app and its volume (one machine, so the volume stays on one host):
   ```sh
   fly apps create freetv-api
   fly volumes create freetv_data --app freetv-api --region ams --size 3
   fly secrets set --app freetv-api PROXY_SECRET="$(openssl rand -hex 32)" ADMIN_TOKEN="$(openssl rand -hex 24)"
   cd infra/deploy/fly/api && fly deploy --config fly.toml
   ```
4. Deploy the web app:
   ```sh
   cd infra/deploy/fly/web && fly launch --no-deploy --config fly.toml && fly deploy
   ```
5. Add your domain with `fly certs add tv.example.com --app freetv-web` and a CNAME to the web app.
6. Check it: `fly logs --app freetv-api` should show the first ingest. Then `curl https://<host>/api/health`.

## Gotchas

- **Scaling:** keep the api at one machine. Two machines would be two SQLite writers on two volumes.
- **Secrets:** `PROXY_SECRET` is required by the api even with the relay off. Set it with `fly secrets`, not in `fly.toml`.
- **Images:** the `[build] image` lines default to `ghcr.io/peiceoftoast/freetv-<svc>`. Forks: replace `peiceoftoast` with your lowercase GHCR owner
  (the one in `GITHUB_REPOSITORY_OWNER`) in `api/fly.toml` (e.g. `sed -i 's#ghcr.io/peiceoftoast/#ghcr.io/<owner>/#' infra/deploy/fly/api/fly.toml`),
  and pass `--build-arg FREETV_OWNER=<owner>` to `fly deploy` in `web/`. The GHCR packages (`freetv-api`, `freetv-web`)
  must be public, or Fly cannot pull them. GHCR packages are private by default on first publish: on GitHub open
  Packages > the package > Package settings > Change visibility > Public. Public status was not verified from here.
- **Cost and sleep:** the web app has `auto_stop_machines = "off"`. Scale-to-zero would drop the first request
  after idle and interrupt the ingest schedule.
- **Volumes are not backed up.** Use `fly volumes snapshots` or copy `/data` out before risky changes.
- **The `/proxy` route** returns 502 on Fly. Expect the player to fall back to "unavailable" for relayed streams.

## Files

- `web/Dockerfile`, `web/Caddyfile`, `web/fly.toml`: edge app.
- `api/fly.toml`: api app with its volume.
