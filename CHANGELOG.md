# Changelog

All notable changes to FreeTV. Format follows Keep a Changelog; versions follow SemVer.

## [Unreleased]

### Added
- Stream health prober: background checks of every stream (rate-limited, hysteresis, DASH-aware), `online` filter/dots now populated, channel detail orders known-online streams first, `relayOnly` hint for streams needing UA/Referer; `POST /api/admin/probe`.
- Stable per-instance channel numbers (`number` on channel responses, `tvg-chno` in M3U, `GET /api/channels/number/:n`); TV mode digit entry jumps by number, channel up/down steps by number outside a list.
- Logo cache (`/logo/:id`, resized WebP/PNG, LRU on disk) so visitors never hit third-party image hosts.
- Search: bm25 weighting, exact/prefix boosts, language/country/category understanding ("spanish news", "germany", "4k"), safe query parsing.
- Relay: per-IP token-bucket rate limiting and concurrency cap, Prometheus `/metrics`, hashed client IPs in logs.
- API `/metrics` and `GET /api/admin/status`; `/admin` operator page (token-gated) with re-ingest / re-import / probe buttons.
- Site: correct "Playing · direct/relay" status, reduced-data mode, `?` keyboard cheat-sheet and global shortcuts, numbers and online dots in browse, health summary in the toolbar.
- Playwright e2e suite (`e2e/`, 37 tests incl. real HLS playback through the relay) running in CI.
- Infra: `monitoring` profile (Prometheus + Grafana dashboard), `autoupdate` profile (Watchtower) and a systemd timer alternative, Hetzner cloud-init, Fly and Helm skeletons, `block-channel.sh`.
- `LOCAL_BLOCKLIST`: per-instance channel blocklist file merged at ingest.

## [0.1.0] — 2026-10-15

First complete version.

### Added
- `api`: iptv-org ingest into SQLite/FTS5, catalog API with search/filter/sort, channel detail, signed
  relay URLs, streaming XMLTV importer, now/next and guide-grid endpoints, M3U + XMLTV exports,
  admin endpoints behind a token, schema versioning.
- `web`: browse grid with URL-synced filters, favorites, dark/light, watch page with hls.js player and
  direct→relay fall-through, timeline guide, about page; installable PWA with offline shell; mobile
  player behaviour (inline, fullscreen + landscape, PiP, wake lock, Media Session); Chromecast and
  AirPlay; `/tv` 10-foot mode with D-pad navigation, channel zapping, number entry, on-screen keyboard,
  cable-style guide and settings; responsive audit across phones, tablets and desktops.
- `proxy`: HMAC-signed HLS relay with playlist rewriting, Range passthrough, SSRF guard, byte and
  concurrency caps.
- `epg`: container around iptv-org/epg with channels.xml generation (one site per channel), scheduled
  grabs, atomic publish, split-by-site mode.
- Infra: Docker Compose with profiles, Caddy auto-HTTPS, Oracle Cloud cloud-init and guide, GitHub
  Actions CI building multi-arch images to GHCR, update/secret scripts.
- Docs: full packet under `docs/` (getting started, operations, troubleshooting, development,
  decisions, roadmap, TV, mobile, legal) plus per-track engineering notes.
