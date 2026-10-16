# Design decisions

Short records of the choices that shape the project, with the alternatives we turned down.
Newest at the bottom. Raw per-track notes with verification logs are in [notes/](notes/).

## D1. One SQLite file, rebuilt in a transaction, instead of Postgres or a file swap
The catalog is ~30k rows of channels and ~200k of guides/programmes; SQLite with FTS5 answers every
query in tens of milliseconds and needs no extra container. Ingest deletes and refills the catalog
tables inside a single transaction (WAL mode) so readers never see a half-built catalog, and the
EPG `programmes` table is untouched by ingest. A file-swap design (`catalog.db.tmp` → rename) was
dropped because it would have thrown away the guide on every refresh.

## D2. The UI never talks to iptv-org directly
All datasets go through `api`, which caches them on disk with ETags. This keeps the browser bundle
small, lets us derive fields (quality rank, logo choice, counts), hides upstream outages, and means
a fork can point `IPTV_API_BASE` at a mirror or a private dataset.

## D3. Direct playback first, signed relay second
Many listed streams fail in browsers (CORS, http-on-https, referrer checks). We try the stream
directly, then through our relay. The relay only accepts URLs signed by `api` with an HMAC and
refuses private address ranges, so it is not an open proxy. Always-proxy was rejected (bandwidth,
hides nothing useful); direct-only was rejected (too many dead channels for visitors).

*Status:* the mechanism stands. The default changed: the relay is off unless the operator enables it (D13).

## D4. EPG: one guide site per channel by default
iptv-org maps some channels to dozens of guide sites (BBC News: 68). Grabbing all of them multiplies
requests ~3× and yields overlapping schedules. The generator picks one site per channel, preferring a
site in the channel's country (by domain), then the channel's main feed, then the largest site. The
importer still de-duplicates on `(channel, start)` as a safety net, and `EPG_ONE_SITE_PER_CHANNEL=false`
restores the exhaustive behaviour.

## D5. Guide data flows through a file, not an API call
The grabber writes XMLTV to a shared volume and the api imports it by polling the file's mtime. This
decouples the two containers completely (either can restart), keeps the grabber an unmodified
iptv-org/epg checkout, and gives operators a plain file they can inspect or replace with their own.

## D6. Caddy as the only edge
One container terminates TLS (automatic Let's Encrypt from `DOMAIN`), serves the static UI and
proxies `/api` and `/proxy`. nginx + certbot would have been two moving parts and a cron. The
Caddyfile is duplicated (`apps/web/Caddyfile` baked into the image, `infra/caddy/Caddyfile`
bind-mounted) so `git pull` can change routing without an image rebuild; CI fails if the two drift.

## D7. No accounts, no server-side state for viewers
Favorites, theme, TV settings live in the browser. It keeps the site privacy-neutral and the
operator free of user data. The cost: favorites do not sync across devices, and the guide/M3U export
take the favorite ids explicitly. Optional accounts are on the roadmap, behind a flag.

*Note (hub mode, D13):* the operator's presentation settings (site name, public URL, contact, notes, featured apps) are
now stored in the database and edited at `/admin`, not only in env vars. Viewers still have no accounts and no
server-side state: favorites, view mode and TV settings stay in their own browser.

## D8. Separate players for the site and for `/tv`
`Player.tsx` (site) carries touch/mobile behaviour, PiP, Media Session, controls; `TvPlayer.tsx` is
chrome-less and driven by the remote. Sharing one component would have meant a thicket of props for
two very different interaction models.

## D9. `/tv` uses plain CSS with a viewport-scaled unit
TV browsers lag years behind; `:has()`, container queries and `backdrop-filter` are avoided. All
measurements are in `--u` (1 px at 1920 wide, scaling with `vw`), so 720p, 1080p and 4K panels get the
same composition. Tailwind is still used for the main site.

## D10. Exports (M3U + XMLTV) as first-class
Many people already have a TV app they like. `GET /api/playlist.m3u` (filterable, optionally
relayed) and `GET /api/guide.xml` let TiviMate, Kodi, Plex, Jellyfin and VLC use a FreeTV instance
as a backend with two URLs. It is the cheapest "smart TV support" we could ship and will stay the
most robust one.

## D11. Blocklisted channels are excluded everywhere; NSFW hidden by default
Channels in iptv-org's blocklist (DMCA/NSFW reasons) are not listed, not playable and not exported.
`is_nsfw` channels are hidden unless the viewer opts in (`nsfw=true`, a toggle in the UI and TV settings).
Operators can flip the default with `HIDE_NSFW_DEFAULT`.

## D12. Contracts first, parallel tracks second
`docs/API.md`, `schema.sql` and the env-var table were written and frozen before any feature code,
and each service/page was built by an independent agent that owned a directory. This produced the
first working version in one afternoon; the integrator pass then fixed cross-track issues (bundle
splitting, touch targets, EPG overlap). `PARALLEL-WORK.md` keeps the ownership map for future rounds.

## D13. Hub mode by default: the site does not carry video unless the operator opts in
**Decision.** `.env.example` ships `COMPOSE_PROFILES=epg` and `PROXY_ENABLED=false`. The relay container does not run,
and the server never carries video. A channel plays in the viewer's browser when a stream allows it. Otherwise the
watch page offers **Open in app**, which hands the stream to a player on the viewer's device (a one-channel M3U from
`/api/channels/:id/playlist.m3u`). `/connect` gives everyone the site-wide playlist and guide URLs, with per-app steps.
The relay stays in the code as an opt-in profile (D3), with its limits and its cost written down in OPERATIONS.

**Why.**
- *Egress.* The free allowance is 10 TB a month, about 31 Mbit/s averaged. A relayed 1080p viewer costs about 2 GB an
  hour, so with the relay on the bill grows with the audience, and a popular site would reach the allowance quickly.
  In hub mode the server sends pages, the catalog, the guide and logos. Viewers' devices fetch the video directly.
- *Legal posture.* LEGAL.md separates listing and linking from carrying bytes. Carrying bytes depends on jurisdiction,
  on the host's acceptable-use policy and on geo-licensing. With the relay off by default, a stock deployment carries no
  stream, and the viewer's own device is the one that fetches it (so geo-restrictions apply to the viewer).
- *Apps do it better.* VLC, TiviMate, Kodi and the TV apps handle headers, buffering and retries, the TV guide, channel
  numbers and remote controls. Our browser player is good for the streams a browser can play, and a fallback elsewhere.

**Trade-offs.**
- Fewer channels play on the site itself. Streams that need CORS, headers or plain http on https pages do not, and the
  prober's `browserPlayable` flag shows how many of a channel's streams are affected.
- A viewer who wants a channel that does not play in the browser takes an extra step (an app, or the playlist from
  `/connect`). Casting from the browser is limited to streams the TV can fetch itself (TV.md).
- An operator who wants the relay must read the cost section of OPERATIONS and turn it on deliberately.

**Rejected.** *Relay on by default, with a cap:* a concurrency cap does not give a predictable monthly bill, and
viewers would not know they were being carried. *Removing the relay:* it costs nothing while off, and some operators on
larger hosts with their own bandwidth want it.

