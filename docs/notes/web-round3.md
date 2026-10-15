# Web round 3 (track W)

## What changed

**Player** (`components/player/Player.tsx`, `order.ts`, `ReducedDataToggle.tsx`)
- Status line: "Trying source N of M…" until a manifest loads, then "Playing · direct" or "Playing · relay"
  with the quality when known ("Ready" instead of "Playing" while paused). The old bug was that the line
  only named the relay once every attempt was exhausted. The `e2e` status test is un-fixme'd; its text is
  now "Playing · relay".
- `relayOnly` streams skip the direct attempt and go straight to `proxyUrl`. A `relayOnly` stream with no
  proxy URL is dropped.
- Attempt keys use the catalog `index`, not the array position, so they stay stable when the order changes.
- Attempts keep the API order. Direct URLs are still all tried before any relay URL, as before.
- "Reduced data" (`lib/network.ts`, `localStorage` `freetv:save-data`; default is the browser's
  `navigator.connection.saveData`). When on, streams in the online and never-checked groups play lowest
  quality first; unknown quality goes last; offline streams keep API order. A badge shows in the status row.
  The switch is in the player's source row and in the watch page's Streams section. Toggling restarts the
  attempt sequence, and the watch page remounts the player so the new order starts from the top.
- Keyboard: `p` toggles picture-in-picture, in addition to space, `m`, `f` and the arrows.

**Browse** (`components/browse/*`, `pages/browse/BrowsePage.tsx`)
- Channel number: a muted prefix in list view ("995 ·"), outside the title link so the link text stays the
  channel name; a corner badge in grid view.
- Online dot: green for a passed last check, red for a failed one, nothing when never checked. Both have
  tooltips. (Before, failed was grey.)
- Toolbar: "n of m checked streams online" when `meta.health.probed > 0`, plus an "Only online" chip that
  shows as pressed when the filter is on.
- List row: number, name, country, streams, quality, dot and now-playing on one line on desktop; wraps on
  phones. Category tags are dropped from list view to keep the row to one line.
- Grid cards fill their grid cell, so a row keeps equal heights when one card has a programme line.
- `/` focuses search and `f` toggles favorites only (browse page only).
- Skipped per the brief: "sort by number" and the `#N` quick-jump, since the API cannot filter or sort by number.

**Shortcuts and header** (`lib/shortcuts.ts`, `components/layout/Layout.tsx`, `ShortcutsDialog.tsx`)
- `?` opens the cheat sheet; a "?" button in the header does the same. `g` opens the guide and `t` opens TV
  mode. Esc closes the dialog. All shortcuts are ignored while typing in a field, and when Ctrl, Meta or Alt is held.
- The cheat sheet's content is `SHORTCUT_GROUPS` in `lib/shortcuts.ts`. Keep it in step with the handlers.

**About** (`pages/about/AboutPage.tsx`)
- Adds "Streams checked" and "Checked online" tiles when health data exists, a note that channel numbers are
  stable per instance (and match the M3U `tvg-chno`), and an "Operator" section linking to `/admin`.

## Verification

- `npm run build` in `apps/web` passes, with zero TypeScript errors.
- e2e suite: 37 passed, 2 skipped. The skips are the existing `test.fixme` for BBC ranking, on desktop and mobile.
  The status-line test is no longer fixme.
- Reduced-data ordering was checked with a small script. For API order `1080p/on, sd/null, unknown/on, 720p/on,
  480p/off, 720p/null`, reduced order is `3, 0, 2, 1, 5, 4`, which is correct.
- Screenshots (taken against the real catalog in `apps/api/.data`, through the preview server): the health
  summary and online dots were mocked in the page, because no stream has been probed on this catalog yet.
  Streams in this sandbox cannot reach the internet, so the watch page shows "Trying source 16 of 40…".
  Files are in `/tmp/claude-0/-home-claude/a71a92df-0685-5acd-9194-6f3fd5c66155/scratchpad/`:
  `browse-grid-1280.png`, `browse-list-1280.png`, `browse-grid-390.png`, `browse-list-390.png`,
  `watch-1280.png`, `watch-390.png`, `shortcuts-1280.png`. The capture script is `shots.mjs` in the same folder.
  No horizontal scroll at either width.

## Open points for the integrator

- `App.tsx` has no `/admin` route. The About link assumes the reverse proxy serves the operator page at `/admin`;
  check that when the page is wired up.
- Health numbers only appear once the prober has run. On a fresh instance, `meta.health.probed` is 0 and the
  browse summary, the "Only online" chip and the About tiles stay hidden.
- `pages/tv/*` and `components/tv/*` belong to another track. Their TypeScript errors were seen during this
  track's build and were resolved by the time it passed; this track did not touch them.
