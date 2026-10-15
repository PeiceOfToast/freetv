# Track E (watch + guide) notes

## Built
- `components/player/Player.tsx`: HLS player (hls.js, or native HLS on Safari). Tries every direct `url` in order, then every `proxyUrl`. Each attempt fails on a fatal hls.js error, or after 8 s without a parsed manifest. Shows status ("Trying source n of m", "Playing via relay"), a source picker (Automatic or one specific direct/relay stream), and a "Couldn't play this channel" panel with Retry and the attempted list. Keyboard: space, m, f, ←/→ (±10 s within the seekable range). Volume is stored in localStorage under `freetv:volume`. Autoplay falls back to muted with an Unmute button.
- `pages/watch/WatchPage.tsx`: channel detail, favorite toggle, share (copies the URL), logo/name/flag/country, categories, languages, network, website, Now/Next with progress, "Schedule" (today's list, refreshed every 60 s), stream list with badges. Loading, 404 and error states. Sets `document.title` to the channel name.
- `pages/watch/Schedule.tsx`: presentational schedule list grouped by day, current item highlighted.
- `pages/guide/GuidePage.tsx`: timeline. Rows are the favorites from `lib/favorites`. Window is 3/6/12 h, starts snapped to half hours. Prev/next shift by half the window; "Now" jumps to 30 min before now. `api.epgGrid` runs in batches of 100 ids and refreshes every 5 min.
- `components/guide/TimelineGrid.tsx`, `ProgrammePopover.tsx`, `ChannelSearch.tsx`.

## Integrator needs
- Nothing in `lib/api.ts`, `App.tsx`, layout, or browse was changed. Routes `watch/:id` and `guide` already match.
- Build passes (`npm run build`, tsc strict, zero errors). Not yet exercised against a live API or a real browser.
- Guide rows are fetched with `api.channels({ favorites, hasStream: false, nsfw: true, limit: 200 })` to get names and logos. This relies on the API honouring `favorites` together with `hasStream=false` and `nsfw=true`. Ids the API does not return fall back to showing the raw id.
- Browsers cannot set User-Agent or Referer on hls.js requests. Streams that need those headers fail in the direct phase and succeed through `proxyUrl`, which carries them. This is intended, not a bug.
- The guide's "Add channel" search writes to favorites (localStorage). There is no separate guide list.
- The "now±" window option in the brief was read as the "Now" anchor. If a centred window was meant, it is a small change to `defaultStart`.
- Player is keyed by channel id in WatchPage so per-channel attempt state resets on navigation.
- Dev: `cd apps/web && npm run dev` (proxies /api to :3000 and /proxy to :3001).
