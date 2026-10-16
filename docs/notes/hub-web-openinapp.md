# Hub mode: web "open in app" track

Scope: the web side of "watch in your own app". When the relay is off, many channels cannot play in a
browser (plain http on https, no CORS, custom headers). They do play when the viewer's own device fetches
them in VLC or a TV app. This track adds the links, the watch-page avenues, and the browse badges and filter.

## What changed

| File | Change |
|------|--------|
| `apps/web/src/lib/open-in-app.ts` (new) | Platform detection, link builders, per-platform plan, `appStreamUrl`, `channelPlaylistAbsoluteUrl` |
| `apps/web/src/components/openinapp/OpenInAppMenu.tsx` (new) | "Open in app" button and menu; compact mode for the failure panel; stream picker |
| `apps/web/src/components/openinapp/PlayabilityBadge.tsx` (new) | "Browser" (green outline) / "App" (amber outline) / nothing when unknown |
| `apps/web/src/pages/watch/WatchPage.tsx` | Three avenues under the player; exhaustion makes "Open in app" primary; failure hint; badge per stream; `api.settings()` for relay copy |
| `apps/web/src/components/player/Player.tsx` | `failureHint?: ReactNode` prop, rendered in the failure panel. Failure panel scrolls on phones and the long explanation hides on phones when a hint is given. Status strings unchanged. |
| `apps/web/src/components/browse/ChannelCard.tsx` | Playability badge in the meta line |
| `apps/web/src/components/browse/FilterPanel.tsx` | "Plays in: Any / Browser / App" chips |
| `apps/web/src/components/browse/state.ts` | `playable` state, URL param `playable` (omitted when `any`), sent as `playable=` in the query, counted in active filters |
| `apps/web/src/pages/tv/WatchPage.tsx` | Failure overlay: "Doesn't play here — use channel <n> in your TV app (see /connect on a phone)" |

Not touched: `Toolbar.tsx` (count line unchanged), `lib/api.ts` (contract already had the types and `api.settings()`
and `api.channelPlaylistUrl()`), `TvPlayer.tsx`, `ConnectPage`, e2e specs.

## Schemes and their caveats

Stream URL `u` is the stream's direct `url`, or the absolute relay URL when the stream is `relayOnly` and has a
`proxyUrl`. Relay URLs expire after 24 h; direct URLs do not.

| Platform | Action | Link or file | Caveats |
|----------|--------|--------------|---------|
| iOS (incl. iPadOS) | Open in VLC (primary) | `vlc-x-callback://x-callback-url/stream?url=<encodeURIComponent(u)>` | Needs VLC 3 or later. Does nothing if VLC is not installed; the menu links to the App Store (`id650377962`). |
| iOS | Open in VLC (alternate) | `vlc://<u>` | Older form. Try it when the x-callback link does nothing. |
| Android | Open in app (primary) | `intent:<u>#Intent;type=video/*;action=android.intent.action.VIEW;end` | Shows the system chooser. Works in Chrome on Android only. A `#` inside `u` is read as an intent fragment, so such URLs break. |
| Android | Open in VLC | `intent://<host><path><search>#Intent;scheme=<scheme>;package=org.videolan.vlc;type=video/*;action=android.intent.action.VIEW;end` | Needs VLC for Android. Store fallback: `org.videolan.vlc` on Google Play. |
| macOS, Windows, Linux | Download .m3u (primary) | `GET /api/channels/:id/playlist.m3u` as attachment | Opens in VLC, IINA or MPV only if one of them is the default for `.m3u`. Nothing in a browser can launch them directly. |
| TV and other | Copy URL (primary) / .m3u | Copy and download | A TV cannot open these links; the hint points to the channel number in the TV app (`/connect`). |
| Everywhere | Copy URL | clipboard | If the clipboard is blocked, the menu shows the address in a read-only field. |

Things that do not work and are deliberately not offered: `vlc://` on desktop (not reliable across platforms),
`intent:` on iOS or in non-Chrome Android browsers (silently ignored), and any attempt to pass headers. Streams
that need a User-Agent or Referer go through the relay URL for that reason.

## Watch page layout

- Player, then three cards: "Watch here" (scrolls to the player), "Open in app" (the menu), "Get every channel
  in your app" (`/connect?channel=<number>`).
- If every stream has `browserPlayable === false`, or the player exhausts its plan, the "Open in app" button is
  filled (primary) and its card gets a dark border.
- The failure panel shows "This channel doesn't play in a browser. Open it in VLC or your TV app instead." (only
  when every stream is known unplayable; otherwise just the second sentence), the primary action as a link, and
  "More ways to open this channel", which scrolls to the full menu.
- e2e status strings (`Couldn't play this channel`, `Playing · relay`, and the rest) are unchanged.

## Data this relies on (contract, already in `docs/API.md`)

- `browserPlayable` on `ChannelSummary` and `StreamInfo`: `true`, `false` or `null`. Null hides the badge.
  As of this run the live API returns `null` for every stream, so no badge shows on real data until the prober
  sets it. Screenshots used simulated values (see below).
- `playable=browser|app|any` on `/api/channels`. Verified against the live API: it returns zero rows while all
  values are null, which is correct.
- `/api/channels/:id/playlist.m3u` and `/api/settings`: both answer 200 on the live API.

## Gaps for the integrator (outside this track's allowed paths)

1. **Clear all on the browse page does not reset `playable`.** `BrowsePage.tsx` `clearFilters` and `clearAll`
   list the fields they reset explicitly. Add `playable: "any"` to both (one line each).
2. **Active-filter chips do not show `playable`.** `ActiveFilters.tsx` renders no chip for it, so with only
   `playable` set the page shows a "Clear all" with no chip above it. Add a `Plays in: Browser|App` chip with
   `onRemove: () => onChange({ playable: "any" })`.
3. **e2e `connect.spec.ts` (2 tests) fail** on the Connect page. It is another track's in-progress work in this
   tree, not this track's. `watch`, `browse`, `tv`, `exports` and `pwa` pass.

## Verification

- `apps/web`: `npx tsc --noEmit -p .` clean; `npm run build` zero errors.
- `e2e`: full suite 46 passed, 2 failed (the Connect page tests in gap 3). Watch, browse, TV, exports and PWA
  specs green on desktop and mobile. Two runs earlier in the session had more failures that came from another
  track's `vite build` writing to `dist` during the run; a rerun was clean.
- Playwright screenshots (against the live catalog on `:3000` and vite preview on `:4173`, both stopped afterwards).
  Playability values were injected at the network layer because the live API has none yet:
  - `scratchpad/oia/desktop-1280-unplayable-menu.png`: watch page, cards, menu open (desktop UA: .m3u primary)
  - `scratchpad/oia/iphone-390-unplayable.png`: above the fold at 390 wide
  - `scratchpad/oia/iphone-390-unplayable-menu.png`: menu open, iOS UA (Open in VLC primary)
  - `scratchpad/oia/android-390-menu-v2.png`: menu open, Android UA (chooser primary)
  - `scratchpad/oia/desktop-1280-failure-v2.png` and `scratchpad/oia/iphone-390-failure-v3.png`: failure panel
  - `scratchpad/oia/browse-1280-badges.png`: card badges and "Plays in" filter in the sidebar
  The TV failure text is covered by the TV e2e spec but was not screenshotted.

Files are under `/tmp/claude-0/-home-claude/a71a92df-0685-5acd-9194-6f3fd5c66155/scratchpad/oia/`.
