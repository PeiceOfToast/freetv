# FreeTV — Project Plan

A self-hostable, containerized web TV player for the ~18,000 publicly listed streams
aggregated by [iptv-org/iptv](https://github.com/iptv-org/iptv). One website, pick a channel, press play.
Anyone can clone it, point a domain at a cheap VM, and run their own copy.

## Goals

1. **One-command deploy.** `docker compose up -d` on any Linux box (reference target: Oracle Cloud
   Always-Free ARM VM). Set `DOMAIN` and HTTPS is automatic.
2. **Clean, fast UI.** Browse ~30k channels with logos; filter by category, country, language,
   quality, "has a working stream"; full-text search; sort; favorites; shareable URLs; dark mode; mobile-friendly.
3. **TV guide.** Channel metadata for everything, plus a scheduled EPG grabber (iptv-org/epg) that
   fills "now / next" and a day-by-day schedule. Default config grabs *all* guide sources; the
   operator can narrow it.
4. **Plays as much as possible.** Direct HLS playback in the browser first; optional built-in,
   HMAC-signed relay for streams that fail on CORS / mixed content. The relay is not an open proxy.
5. **Replicable + remixable.** MIT license. No vendor lock-in: SQLite, static front end, Caddy.
   Nothing but Docker is required on the host.
6. **Parallel-friendly codebase.** Services are isolated directories with a written contract
   (`docs/API.md`, `apps/api/src/db/schema.sql`) so several agents/people can build concurrently.

## Non-goals (v1)

- User accounts, server-side favorites, comments.
- Transcoding. We relay bytes; we never re-encode.
- Hosting or mirroring streams. Stream URLs come from iptv-org at runtime and are refreshed on a schedule.
- DRM / paid channels. Only what iptv-org lists.

## Data source

iptv-org publishes a JSON API (built from `iptv-org/database`) at `https://iptv-org.github.io/api/`.
Datasets: `channels`, `feeds`, `streams`, `categories`, `countries`, `languages`, `guides`,
`logos`, `blocklist`. See `docs/DATA.md` for shapes. The API container downloads these on a timer
and rebuilds a SQLite catalog; the UI never talks to iptv-org directly.

## Architecture (summary — see ARCHITECTURE.md)

```
browser ──HTTPS──▶ web (Caddy: static UI + reverse proxy)
                     ├── /api/*    ──▶ api   (Node/Fastify + SQLite/FTS5)
                     └── /proxy/*  ──▶ proxy (Node HLS relay, HMAC-signed URLs)   [optional profile]
                                        epg   (iptv-org/epg grabber on a cron) ──▶ shared volume ──▶ api imports XMLTV
```

## Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| 0 | Contracts & scaffold | Repo builds, docs written, every service has a stub that starts. |
| 1 | Catalog | `api` ingests iptv-org data into SQLite; `/api/channels` search/filter/sort works. |
| 2 | Browse UI | Grid, filters, search, sort, favorites, URL state. |
| 3 | Playback | `/watch/:id` plays via hls.js; falls through streams; falls back to proxy. |
| 4 | Proxy | Signed relay rewrites playlists and streams segments. |
| 5 | EPG | Grabber container writes XMLTV; api imports; now/next in UI; guide page. |
| 6 | Deploy | Compose + Caddy auto-HTTPS; Oracle free-tier guide + cloud-init; CI builds images to GHCR. |
| 7 | Polish | Lighthouse-clean, keyboard nav, empty/error states, README quickstart. |

## Work breakdown (parallel tracks)

Each track owns a directory and must not edit files outside it (see `docs/PARALLEL-WORK.md`).

- **A. api/ingest** — `apps/api/src/ingest/**`: fetch datasets, build SQLite per `schema.sql`, FTS index, schedule.
- **B. api/routes** — `apps/api/src/routes/catalog.ts`, `routes/stream.ts`: endpoints per `docs/API.md`.
- **C. api/epg** — `apps/api/src/epg/**`, `routes/epg.ts`: XMLTV streaming importer + EPG endpoints.
- **D. web/browse** — `apps/web/src/pages/browse/**`, `components/browse/**`.
- **E. web/watch** — `apps/web/src/pages/watch/**`, `pages/guide/**`, `components/player/**`.
- **F. proxy** — `apps/proxy/**`.
- **G. epg container** — `apps/epg/**`.
- **H. infra** — `infra/**`, `apps/web/Dockerfile`, `.github/**`, deploy docs.
- **I. integration** — lead: wire, run with real data, fix, release.

## Risks & mitigations

- **Stream rot.** iptv-org streams go dead constantly. → Re-ingest every few hours; UI falls through all streams for a channel; optional health-probe job marks `status` so "only online" filtering works.
- **CORS / mixed content.** → Proxy profile; UI tries direct first, then proxied.
- **EPG cost.** Grabbing every site takes hours and real CPU. → Defaults: `EPG_DAYS=2`, bounded concurrency, runs on a cron, importer streams the XML so RAM stays flat. Operators can set `EPG_SITES` to a short list.
- **Free-tier VM limits.** 4 OCPU / 12 GB ARM is generous; the relay is the only bandwidth hog. → Proxy is a compose profile and has a per-request byte budget / concurrency cap.
- **Legal.** We list and relay what iptv-org lists; blocklisted channels are excluded; NSFW hidden by default. README carries a clear takedown/contact note. Operators are responsible for their own jurisdiction.

## Hosting reference: Oracle Cloud Always Free

- VM.Standard.A1.Flex, 4 OCPU / 12 GB (all of the Always-Free Arm allowance in one VM), Ubuntu 22.04/24.04 (ARM — all images are multi-arch).
- Open 80/443 in the VCN security list **and** in the instance's iptables (Oracle images ship a restrictive ruleset).
- `infra/deploy/oracle/cloud-init.yaml` installs Docker, clones the repo, writes `.env`, starts compose.
- Point an A record at the public IP; set `DOMAIN=tv.example.com`; Caddy gets a Let's Encrypt cert.

## Status (2026-10-15)

Milestones 0–6 are implemented and integrated. Verified in the build sandbox: api unit/route/EPG tests
(77), proxy tests (40), real ingest of the live iptv-org catalog (31,570 channels / 15,947 streams),
XMLTV import + now/next + guide grid, signed proxy URLs round-tripping api → proxy, web build, and
screenshots of every page at desktop and phone widths. Not yet verified (no registry access in the
sandbox): the four Docker image builds, a real EPG grab against guide sites, and actual playback of
third-party streams. CI (`.github/workflows/ci.yml`) builds the images on first push.

Open items worth doing next: a stream health prober (schema already has `streams.status`), server-side
favorites export/import, i18n, and a "channel numbers" mode for the guide.

## Round 2 — phones and TVs (2026-10-15)

Added: installable PWA (manifest, icons, service worker that caches the shell and API but never video),
iOS/Android player behaviour (inline playback, fullscreen + landscape lock, PiP, wake lock, lock-screen
controls), 44 px touch targets, Chromecast and AirPlay from the watch page, a 10-foot `/tv` mode driven
by a remote (D-pad, channel up/down, number entry, channel strip, cable-style guide, on-screen keyboard),
`/api/playlist.m3u` + `/api/guide.xml` exports for TiviMate/Kodi/Plex/Jellyfin/VLC, and packaging
skeletons plus guides for Android TV/Fire TV (TWA), Samsung Tizen and LG webOS (`apps/tv/`, `docs/TV.md`,
`docs/MOBILE.md`). Main JS bundle dropped from 276 kB to 68 kB gzipped by lazy-loading the player, guide
and TV routes. Verified headlessly at 320/390/844 px and 1920×1080 with keyboard-only navigation; not
yet verified on a real phone, Chromecast or TV.

## Round 3 — making more channels play, operations (2026-10-15)

Shipped the "would do next" list: stream health prober (schema `stream_health`, hysteresis, DASH), health-aware
stream ordering and relay-only hints, stable channel numbers (API, M3U, TV digit entry), logo cache, search
understanding, relay rate limits + metrics, api metrics + `/admin`, Playwright e2e in CI (37 tests, two real bugs
caught), monitoring/auto-update/deploy variants. Verified in the sandbox: api 190 tests, proxy 70, e2e 37; a
real probe pass ran end-to-end (every host blocked here, so results are "pending"). Still needs real hardware:
Chromecast/AirPlay/TV browsers, and a real probe cycle on an internet-connected VM.
