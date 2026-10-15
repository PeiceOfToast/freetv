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
- **Free-tier VM limits.** 4 OCPU / 24 GB ARM is generous; the relay is the only bandwidth hog. → Proxy is a compose profile and has a per-request byte budget / concurrency cap.
- **Legal.** We list and relay what iptv-org lists; blocklisted channels are excluded; NSFW hidden by default. README carries a clear takedown/contact note. Operators are responsible for their own jurisdiction.

## Hosting reference: Oracle Cloud Always Free

- VM.Standard.A1.Flex, 4 OCPU / 24 GB, Ubuntu 22.04/24.04 (ARM — all images are multi-arch).
- Open 80/443 in the VCN security list **and** in the instance's iptables (Oracle images ship a restrictive ruleset).
- `infra/deploy/oracle/cloud-init.yaml` installs Docker, clones the repo, writes `.env`, starts compose.
- Point an A record at the public IP; set `DOMAIN=tv.example.com`; Caddy gets a Let's Encrypt cert.
