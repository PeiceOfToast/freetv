# TV mode notes (`/tv`)

Owned by the TV track. Files this track touched:

- `src/lib/spatial-nav.ts` focus manager, remote key mapping, Back stack, cursor auto-hide, `useSpatialNav`, `focusFirst`
- `src/pages/tv/` `TvPage` (router), `TvShell` (left rail), `HomePage`, `BrowsePage`, `WatchPage`, `GuidePage`, `SettingsPage`, `tv.css`
- `src/components/tv/` `TvPlayer` (hls.js direct, no chrome), `TvTile` (tile, logo, row), `OnScreenKeyboard`, `tvSettings` (settings, recents, current list)

Not touched: `Player.tsx`, `lib/api.ts`, `vite.config.ts`, `App.tsx`, `index.css`.

## Behaviour

- Navigation: arrows move to the geometrically nearest `[data-nav]` element. Candidates in the same row or column are preferred. Enter clicks. Back (keyCodes 8, 27, 461, 10009; keys `Escape`, `GoBack`, `BrowserBack`) pops the innermost Back handler, else history.
- Remote keys: ChannelUp/Down (427/428 Tizen; 33/34 PageUp/PageDown), play/pause (179/415/19), digits 0-9 and numpad, `Info`/`i`, `Guide`/`g`.
- Mouse: cursor hidden after 3 s idle (`html.tv-cursor-hidden`). Clicks still work.
- Focus ring: 4px white ring plus scale 1.05 on `[data-nav]:focus`.
- Settings are stored in `localStorage` under `freetv:tv-settings`. Recents are under `freetv:tv-recent`. The current zapping list is in `sessionStorage` under `freetv:tv-list`. All storage access is wrapped in try/catch.
- Hide NSFW: `nsfw` is passed to the API only when the user has set it. Otherwise the server default applies.
- Preferred quality reorders the streams the player tries. It does not filter channels.
- Prefer relay puts relay URLs ahead of direct URLs in the player's attempt order.

## Verification (2026-10-15)

- `cd apps/web && npm run build` passes with zero `tsc` errors.
- Ran against `vite preview` on port 4174 and the API on port 3000 at 1920x1080 using Playwright with keyboard input only:
  - `/tv`: ArrowRight x3, then ArrowDown, then ArrowLeft moves focus across the rows as expected. Screenshot taken.
  - `/tv/browse`: category chips, then the A-Z letters and country chips, then the grid. Screenshot taken.
  - `/tv/watch/BBCNews.uk`: the overlay appears on keypress (logo, Now/Next, progress bar, source, time). Digit `5` on a one-channel list shows "No channel 5 in this list". Enter opens the channel strip, Escape closes it, and a second Escape returns to `/tv`.
  - `/tv/guide`: ArrowRight x2 and ArrowDown move through programmes. Escape returns to `/tv`.
  - `/tv/browse?search=1`: the on-screen keyboard typed "bbc" and the results updated ("54 channels").
- `/tv/browse` at 1280x720: no horizontal overflow (`scrollWidth` equals `innerWidth`).
- Not tested on real hardware: Tizen, webOS, Android TV or Fire TV. The remote key codes are mapped from the list in the brief but have not been exercised on a device.
- Channel logos from external hosts fail in the sandbox (tunnel error), so the tiles fall back to initials. This is a sandbox limit, not an app bug.

## Known gaps

- On first load of `/tv`, focus lands on the first rail item, because the content rows load after the initial focus pass. Pressing Right enters the content.
- Backspace (keyCode 8) is mapped to Back, as the brief asks. With a physical keyboard, use the on-screen ⌫ key in Search to delete characters.
- The overlay's Now/Next time values refresh only when the overlay is shown again.
- Guide pans only when focus is already at the edge of a row. Panning is limited to what the EPG grid returns (max 24 h window, fetched per pan).
- The "No channel N" message sits under the strip when the strip is open.

## Build target for old TV browsers (not changed; vite.config.ts is owned elsewhere)

Set `build.target` to `es2017` (Tizen 5 is roughly Chrome 69 and webOS 4 is roughly Chrome 53). What else needs polyfilling or rewriting for those engines:

- Syntax transpiled by `es2017` target: optional chaining and nullish coalescing. Vite's default `esbuild` handles this when `target` is set.
- Library APIs used in the TV code that are missing before Chrome 66 or later:
  - `AbortController` (used by every API fetch in `HomePage`, `BrowsePage`, `WatchPage`, `GuidePage`, `SettingsPage`). Polyfill it.
  - `Promise.prototype.finally` (`BrowsePage`).
  - `Array.prototype.flatMap` (`OnScreenKeyboard`).
  - `Object.fromEntries` (`GuidePage`, programme map).
  - `Element.scrollIntoView({ block, inline })` options object (older engines ignore the options; the default alignment is still usable).
- CSS features that need fallbacks for webOS 4:
  - `inset` (in `tv.css`), which needs `top/right/bottom/left`.
  - `gap` on flexbox (Chrome 84+). Replace with margins or `:not(:first-child)` spacing.
  - CSS grid is used for the keyboard, the guide columns and the tile grid. Chrome 53 has grid only behind a flag, so these need a flexbox fallback.
- hls.js 1.5 requires MSE. Tizen 5 and webOS 4 have it, but the TvPlayer falls back to native HLS only where `canPlayType('application/vnd.apple.mpegurl')` is true. Test the relay path on the target device, because CORS is stricter there.
- `navigator.mediaSession` and `screen.orientation` are not used by the TV code, so no guard is needed there.

## Build warning

`vite build` warns that `hls.js` is both dynamically imported by `components/player/Player.tsx` and statically imported by `components/tv/TvPlayer.tsx`. The bundle still builds. The warning comes from the shared player code, so it is for the watch track to resolve. Either import `hls.js` statically in `Player.tsx` or drop the dynamic import.
