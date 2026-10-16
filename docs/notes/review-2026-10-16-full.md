# FreeTV pre-launch review — full text (2026-10-16, independent Claude Fable 5.1 agent, read-only)

**What was verified by running:** `apps/api` tests 190/190, `apps/proxy` 70/70, `docker compose config` with `.env.example` valid, e2e last run passed. The api was run against a copy of the real catalog (31,587 channels / 16,050 streams): every list/search/detail endpoint 2–25 ms; full catalog rebuild **2.3 s of synchronous, event-loop-blocking work** (`buildCatalog`); a synthetic 300k-programme guide (106 MB XML) imported in 7.5 s with a **1.2 s blocking swap transaction** and grew `catalog.db` to 188 MB. The blocklist bug (2.1) was reproduced. Docker image builds and anything needing iptv-org/Docker Hub could not be exercised; items marked *unverified* say so.

## 1) Check on the real VM in the first hour

**1.1 (blocker-class) The `epg` container can crash-loop with EACCES on the shared `data` volume — ownership race.** `apps/epg/Dockerfile:27-31` runs the grabber as uid 10001 and relies on the image's `/data` ownership being copied into the named volume. `apps/api/Dockerfile:17` only declares `VOLUME ["/data"]` (root:root 755) and the api runs as root. Compose creates `api` and `epg` concurrently; whichever container is created first seeds the volume. If it is `api`, `apps/epg/run.mjs:289` (`mkdir /data/epg`) throws → fatal → restart loop, and there is never a guide. Check: `docker compose logs epg | head`, `docker compose exec api ls -ln /data`. Fix: same non-root uid in both images and let the api seed the volume: in `apps/api/Dockerfile` `RUN mkdir -p /data/epg /data/raw /data/logos && chown -R node:node /data` + `USER node` (uid 1000); in `apps/epg/Dockerfile` use uid 1000 instead of 10001. Emergency workaround: `docker compose exec api chown -R 10001:10001 /data/epg` then `docker compose restart epg`.

**1.2 (blocker-class) The `epg` image has never been built anywhere.** `docker compose up -d --build` builds all four images first; if the epg build fails (clones iptv-org/epg at `master` `apps/epg/Dockerfile:13`, `npm install` of its dep tree, then `fetch-api-data.mjs --strict` needs network at build time) the whole `up` aborts and nothing starts. Check: `/var/log/freetv-bootstrap.log`; `docker compose ps`. Fix: `docker compose up -d --build web api proxy` then `docker compose up -d --build epg`; pin `EPG_REF` to a tested tag/commit.

**1.3 (should-fix) `EPG_SITES=all` on the default 2 GB `mem_limit` is likely to OOM or never publish.** ~24.9k entries / 11.7k channels; 2 days ≈ 50k grabber requests and several hundred thousand programmes held in memory before one XML write. *Unverified.* Symptom: exit 137 or "grabber exited with N; keeping previous guide", `programmes` stays 0. Check: `docker compose logs epg | grep -E 'exited|published|no programmes'`, `docker stats epg`. Fix: curated `EPG_SITES` or `EPG_SPLIT_BY_SITE=true` (but see 2.6: compose does not pass it); raise `mem_limit` (the A1 host has 24 GB).

**1.4 (should-fix) Duplicate/conflicting `Cache-Control` on `/logo/*`.** `infra/caddy/Caddyfile:59-62` adds a 7-day header on top of the api's (7 d for hits, `max-age=300` for 404s). Caddy's `header` is non-deferred, so both are sent: a channel whose logo fetch failed once can be cached as missing for a week. Check: `curl -sI https://$DOMAIN/logo/NoSuchChannel.xx`. Fix: delete the Caddy header line (both Caddyfiles; CI diffs them).

**1.5 (check) Boot timeline.** Catalog: first ingest downloads ~50 MB then blocks the api 2–6 s; until then the browse page is empty, not broken. Prober: first pass starts 2 min after boot (`apps/api/src/prober/index.ts:11`), ~55 min at 5/s, and by design publishes no offline verdicts (hysteresis needs 2 failures), so health dots and known-online-first ordering appear after the second pass (~6–7 h). Guide: hours. Commands: `docker compose ps`, `docker compose logs web | grep -i acme`, `curl -s https://$DOMAIN/api/meta`, `curl -sI https://$DOMAIN/sw.js` (expect `no-cache`), `df -h`, `docker stats`.

**1.6 (check)** Caddy ≥2.5 replaces untrusted client `X-Forwarded-For`, so the proxy's last-entry logic is safe; confirm `/proxy` 429s aren't one shared bucket: `docker compose logs proxy | grep ' 429 '`.

## 2) Fix before launch

**2.1 (should-fix, correctness/legal) `block-channel.sh` and `POST /api/admin/ingest` do not apply a new local blocklist entry.** `apps/api/src/ingest/index.ts:19-22` skips the rebuild whenever upstream ETags are unchanged and the catalog is non-empty; the local blocklist is only read inside `buildCatalog`. Reproduced: added `BBCNews.uk`, ran ingest → "datasets unchanged, catalog not rebuilt", channel still 200. `docs/OPERATIONS.md`, `docs/LEGAL.md` and the script header promise "applies at once". Fix: `runIngest(log, { force })` rebuilds even when unchanged; admin route passes `force: true`; include the blocklist file's mtime in the changed decision.

**2.2 (should-fix, security/abuse) Signed relay URLs never expire.** `apps/api/src/lib/sign.ts:5` / `apps/proxy/src/server.ts:173` sign `{u, ua?, r?}` with no `exp`. Every channel response and `playlist.m3u?proxy=true` hands out permanent relay capabilities; a blocked/removed stream stays relayable; any third-party site can embed the relay (CORS `*`). Only rotating `PROXY_SECRET` revokes them. Fix: add `exp` (24 h UI, 7 d M3U), reject expired in the proxy, carry `exp` through `rewritePlaylist`.

**2.3 (should-fix, ops) Logs are unbounded and verbose.** Fastify logs 2 lines/request at `info`, the proxy one line per segment, no Docker log rotation in cloud-init, and compose doesn't forward `LOG_LEVEL`. Fix: `x-logging` anchor (json-file 20m×5) on every service; `LOG_LEVEL: ${LOG_LEVEL:-warn}` to api and proxy; daemon.json snippet in cloud-init.

**2.4 (should-fix, UX) The player wastes up to 8 s per stream on attempts that can never work.** `Player.tsx:98-115` tries every direct URL before any relay; 3,670 of 16,050 streams (23%) are plain `http://`, blocked as mixed content on https; until the prober's second pass nothing is health-ordered. Fix: skip direct when `location.protocol === "https:"` and the URL is `http:`; direct timeout ~5 s; cap ~8 attempts. Same in `TvPlayer.tsx`.

**2.5 (should-fix, supply chain) Default `GITHUB_REPOSITORY_OWNER=freetv`** tags local builds `ghcr.io/freetv/freetv-*:latest` and `update.sh` runs `pull` first. If that namespace exists on GHCR (unverifiable), the updater could replace local images with a stranger's. Fix: set your own owner; use `FREETV_BUILD=1` until your CI publishes.

**2.6 (should-fix, config/docs) Documented env vars not wired through compose.** epg: only `EPG_SITES/DAYS/MAX_CONNECTIONS/INTERVAL_HOURS/RUN_ON_START` are passed — not `EPG_EXCLUDE_SITES`, `EPG_ONE_SITE_PER_CHANNEL`, `EPG_SPLIT_BY_SITE`, `EPG_TIMEOUT_MS`, `EPG_GRAB_ARGS`; compose passes `EPG_FILE` but `run.mjs:30` reads `EPG_OUTPUT`. api: `LOG_LEVEL`, `EPG_POLL_SECONDS`, `APP_VERSION` not forwarded.

**2.7 (should-fix, UX) First-visit empty state.** Before the first ingest, `/` shows an empty grid. Use `meta.lastIngest === null` to render "Catalog is being downloaded, refresh in a minute".

**2.8 (should-fix, docs drift)** `routes/admin.ts:94` hard-codes `lastIngestMs: null` though `build.ts` writes `last_ingest_ms`. `docs/DEPLOY.md` says the proxy has no `/metrics` (it does). `docs/ARCHITECTURE.md` lists `EPG_FILE` for epg.

## 3) Fix soon after launch

**3.1 (availability)** Synchronous rebuild (`build.ts:387-510`, 2.3 s here, 5–7 s on Ampere) and EPG swap (`importer.ts:80-95`, 1.2 s/300k rows, 4–10 s for all-sites) block every request incl. the 5 s health check. Move to a `worker_threads` worker with its own connection; WAL already isolates readers.

**3.2 (memory)** Logo cache `produce` has no concurrency cap and `limitInputPixels: 50_000_000`; cold cache × 60 cards × visitors → parallel decodes up to ~200 MB each in a 1 GB limit. Semaphore 4–8, 4 MP limit, `sharp.concurrency(2)`.

**3.3 (CPU)** `playlist.m3u` (2.7 MB/160 ms; `proxy=true&streams=all` 6 MB/300 ms incl. 16k HMACs) and `guide.xml` gzipped per request (`export.ts:77`, ~10 s/core for 300 MB). Memoize playlist 60 s by query; write `guide.xml.gz` at import.

**3.4 (security)** Prober (`probe.ts`) and logo cache (`logo-cache.ts:166`) fetch catalog URLs with no private-range check; 169.254.169.254 reachable on Oracle. Share `isBlockedAddress`/`guardedLookup` via an undici Agent lookup.

**3.5 (security)** Run api non-root; `server.ts:26` uses `===` for the admin token while `routes/admin.ts` uses `timingSafeEqual`; add SIGTERM → `closeLogoCache()` + `app.close()`.

**3.6 (ops)** Online backup: `node -e "require('better-sqlite3')('/data/catalog.db').backup('/data/backup.db')"` instead of stopping api; pair secret rotation with 2.2.

**3.7 (UX)** `window.addEventListener("vite:preloadError", () => location.reload())` in `main.tsx` so old tabs survive redeploys.

**3.8 (Android TV)** `assetlinks.json` is served from the git-ignored `/etc/caddy/assetlinks.json`; copy it after every fresh clone.

## 4) Optimizations

4.1 TV home fires ~30 `/api/channels?withNow=true` requests per open → batch or lazy rails. 4.2 `sort=updated` correlated subquery → denormalise `channels.last_checked`. 4.3 `/api/meta` and `/metrics` COUNT(*) per call → 15 s cache. 4.4 `programmes_new` staging table is permanent and index-less; DELETE leaves freelist pages (188 MB high-water) → DROP after swap or incremental vacuum. 4.5 Pin `nickfedor/watchtower:latest`. 4.6 Relay egress up to ~1 Gbps at 200 concurrent; watch `freetv_proxy_bytes_total`.

## Overall assessment

The code quality is well above what the "not a developer by trade" framing suggests: the API is fast on the real 31k-channel catalog, the relay's SSRF guard and limits are thoughtfully done, writes are atomic, and the test suites are real and green. The launch risk is concentrated in the parts nobody has run end-to-end: the Docker images (never built), the EPG grabber at `EPG_SITES=all` scale, and the shared-volume permission race, any of which can turn a first boot into "nothing starts" or "no guide, ever". Beyond that, the two things not to go live without are the broken takedown path (2.1) and permanent relay signatures (2.2). With 1.1–1.4 checked on the box and 2.1–2.5 fixed, this is a safe soft launch; the section-3 items are the ones that will page you in the first month (event-loop stalls on ingest/EPG, logo-cache memory, log growth).
