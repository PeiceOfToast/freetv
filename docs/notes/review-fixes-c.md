# Review fixes C (2026-10-16 review items 2.4, 2.7, 3.7, 4.1)

## 2.4 Player attempt planning (Player.tsx, TvPlayer.tsx, new player/plan.ts)
- `isMixedContent(url)`: on an https page, a plain `http:` URL gets no direct attempt. The stream is
  dropped when it has no relay URL. Both players use it. Player's source picker also omits these.
- Direct attempts time out after 5 s (`DIRECT_TIMEOUT_MS`). Relay attempts keep 8 s (`RELAY_TIMEOUT_MS`).
- The automatic plan is capped at 8 attempts (`MAX_ATTEMPTS`). Direct attempts come first, as before,
  and the cap keeps the first 8 in API order. Player's source picker still lists every candidate, and
  shows "Automatic tries 8 of N · and K more sources, choose one above" when the cap applies.
- Status strings are unchanged ("Trying source N of M…", "Playing · relay", "Ready · …").

## 2.7 First-visit empty state (BrowsePage.tsx, TV HomePage.tsx)
- BrowsePage reads `/api/meta` once through `loadMeta`, which feeds both the health line and `lastIngest`.
  When there are no channels and `lastIngest` is null, it shows "The channel catalog is still being
  downloaded — this takes about a minute on a fresh install" instead of the generic empty state.
- While that state is shown, the channel list and meta reload every 15 s.
- TV home: when the category list is empty and `lastIngest` is null, one message replaces the rails.
  The same 15 s re-check runs. Unknown or failed meta is not treated as pending.

## 3.7 Preload errors (main.tsx)
- `vite:preloadError` reloads the page. A sessionStorage stamp suppresses a second reload within 60 s,
  so a broken deploy cannot loop. If sessionStorage is unavailable, the handler does not reload.

## 4.1 Lazy TV category rails (pages/tv/HomePage.tsx)
- Favorites and Continue watching still load eagerly. The category list is fetched once, and each
  rail fetches its own channels when it comes within 150% of a viewport height (IntersectionObserver
  `rootMargin: "150% 0px"`). Without IntersectionObserver, rails load eagerly as before.
- A loading rail shows one focusable placeholder tile (`aria-disabled`, not `disabled`, so spatial
  navigation can still land on it). A failed rail shows "Couldn't load. Press OK to retry" and reloads
  on Enter.
- The hero still uses the first category's first channel, which loads first because it is at the top.

## Verification
- `apps/web`: `npm run build` (tsc -b + vite build) passes with zero errors.
- `e2e`: `npm test` passed in full on a second run (37 passed, 2 skipped; the skips are existing ones in
  the mobile TV project). The first full run had four relay-test failures (watch.spec.ts "CORS-blocked
  channel plays through the relay" and "status line reports the relay", desktop and mobile). The proxy
  log showed no relay request in that run. Re-running watch.spec.ts alone passed, and so did the
  second full run. The cause was not reproduced. The same spec passed on the original code.
- Not covered by e2e: the empty-catalog pending states (both browse and TV home) and the preload reload.
  Both were checked by reading the code only.
