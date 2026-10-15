# Roadmap

What we would do next, roughly ordered by value for the effort. None of it is required to run the
site today. Items marked **(infra ready)** already have the schema, env or hooks in place.

## Make more channels actually play

1. **Stream health prober (infra ready).** A low-rate background job in `api` that HEADs/GETs each
   stream's playlist every few hours and writes `streams.status` / `last_checked`. The UI's "Only
   online" filter, the green dot and the `online` sort already read these columns. Order the probe by
   popularity so the first pass covers what people click. ~1 day.
2. **Smarter source ordering.** Use the prober's history (plus relay success/failure counts, which the
   proxy can log) to put the stream most likely to work first, instead of https-then-quality. ~½ day
   once the prober exists.
3. **Relay-aware player hints.** The api already knows when a stream has a `user_agent`/`referrer`
   (browsers can't set those), so mark those streams "relay only" and skip the doomed direct attempt. ~hours.

## Make it feel like a product

4. **Optional accounts with synced favorites** behind `ACCOUNTS_ENABLED=false`. Magic-link email or
   passkeys, favorites + "continue watching" in SQLite, and the M3U export gains `?token=` so TV apps
   get the user's list. Keep the anonymous mode the default. ~3 days.
5. **Channel numbers.** Stable numbers per instance (favorites first, then by country/category) so
   the TV mode's digit entry and the M3U `tvg-chno` tag mean something. ~½ day.
6. **Search quality.** FTS already does prefix matching; add synonym/alias handling for country names
   and languages ("german" → `deu`), and boost channels with streams and guides. ~½ day.
7. **Internationalisation.** The UI strings are few; `react-intl` or a tiny dictionary with the
   browser language as default, starting with es/pt/fr/de/ar since those are the largest catalogs. ~1 day plus translations.
8. **Logo caching proxy.** Serve logos via `/logo/<id>` with on-disk caching and resizing. Faster grid,
   no third-party requests from visitors' browsers (privacy), fixes hot-link-blocked logos. ~½ day.
9. **Radio.** iptv-org has a sibling radio database; the same pipeline would carry audio-only
   channels with a compact player. ~1–2 days.

## TV

10. **Custom Cast receiver.** The Default Media Receiver can't show our branding or a now-playing bar;
    a small receiver app (registered with Google, free) would also allow queueing and the guide on the TV. ~2 days + registration.
11. **Real-device pass.** Run the manual checklists in `docs/notes/web-cast.md` and `docs/TV.md` on a
    Chromecast, an Android TV, a Samsung and an LG, and fix what we find. The TWA for Android TV/Fire TV
    is the first to ship because it is pure config. ~1–2 days with devices in hand.
12. **Roku / tvOS.** Both need native shells (BrightScript channel; a Swift app wrapping the player);
    the M3U/XMLTV export already covers them through third-party apps. Later.

## Operations

13. **Admin page.** `/admin` behind `ADMIN_TOKEN`: ingest/EPG status, trigger buttons, prober stats,
    relay bandwidth, top channels. All the data is already in `meta`/`programmes`/logs. ~1 day.
14. **Prometheus `/metrics`** for api and proxy (request counts, relay bytes, ingest timings) and a
    sample Grafana dashboard. ~½ day.
15. **Rate limiting on the relay** per client IP (token bucket in the proxy, or Caddy's rate-limit
    plugin) so one viewer can't exhaust `PROXY_MAX_CONCURRENT`. ~hours.
16. **Playwright e2e in CI** against the fixture catalog (browse, watch fall-through with a local fake
    HLS server, TV keyboard navigation). The audit scripts in `docs/notes/web-devices.md` are a start. ~1 day.
17. **One-click deploys** for Fly.io, Railway, Hetzner and a Helm chart; the compose file is the source
    of truth, these are translations. ~½ day each.
18. **Automatic updates** via Watchtower or a weekly `update.sh` cron, documented as opt-in. ~hours.

## Nice to have

19. Shareable "channel packs" (a URL that encodes a list of ids) for sending someone a curated lineup.
20. Keyboard shortcut cheat-sheet (`?`) on the site and an on-TV help overlay.
21. Reduced-data mode: pick the lowest-quality stream first on cellular (`navigator.connection.saveData`).
22. Chapter/programme deep links: `/watch/:id?at=<ts>` opening the guide on that programme.
