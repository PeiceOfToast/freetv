# Mobile / PWA track notes

## What changed

- **PWA** (`vite.config.ts`, `index.html`, `src/main.tsx`, `src/lib/pwa.ts`, `src/components/layout/UpdateToast.tsx`)
  - `vite-plugin-pwa@1.3.0` (2.0.0 was under two weeks old at build time), `registerType: autoUpdate`, `injectRegister: auto`.
    The worker is registered by `virtual:pwa-register` in `main.tsx`, which disables the plugin's injected script.
  - Manifest: FreeTV, standalone, orientation any, colours #09090b, start/scope `/`, icons 192/512 plus maskable 512.
  - Service worker precache: the app shell (JS, CSS, HTML, SVG, PNG, manifest). `hls-*.js` is excluded, so the lazy
    hls.js chunk is not downloaded on install.
  - Runtime routes, first match wins: `/proxy/*`, `.m3u8/.ts/.m4s/.mp4` and cross-origin `/api` paths are NetworkOnly.
    `/api/playlist.m3u`, `/api/guide.xml` and `/api/admin*` are NetworkOnly. Other `/api/*` is NetworkFirst with a
    10 s timeout and 1 h max age. Cross-origin `<img>` logos are CacheFirst for 7 days, max 500 entries, status 0 or 200 cached.
  - `navigateFallback` is `/index.html` with denylist `/^\/api\//` and `/^\/proxy\//`.
  - `UpdateToast` appears when the new worker has activated (`onNeedReload`). "Reload" applies it. The page is not
    reloaded automatically, because the open page still runs the previous build's chunks.
  - Install button (header) appears only after `beforeinstallprompt`. The event is captured at module load.
  - iOS Safari, not standalone: a one-time "Share, then Add to Home Screen" banner, dismissible. It is marked as shown in
    `localStorage` (`freetv:ios-install-hint-seen`).
- **Icons**: `scripts/gen-icons.mjs` (`npm run icons`) rasterises `public/favicon.svg` with sharp into `public/icons/`.
  Maskable and apple-touch icons use the mark at 80% on a full-bleed #18181b square.
- **Layout** (`Layout.tsx`, `index.css`): safe-area insets on the outer container, header top and footer bottom.
  Header fits at 320 px (logo hidden below 380 px, tighter link padding on phones). Touch targets are 44 px via
  `min-h-11`, reverting to compact sizes for `pointer-fine` (mouse) devices.
- **Player** (`components/player/Player.tsx`): only optional props were added (`title`, `subtitle`, `artwork`).
  - `playsInline`, `webkit-playsinline`, `x-webkit-airplay="allow"`.
  - hls.js is loaded with `import("hls.js")` only where MSE exists. iOS Safari without MSE uses native HLS, as before.
    The 8 s timeout and fall-through logic are unchanged, and the timeout now covers the chunk download too.
  - Fullscreen button and `f` key: `requestFullscreen` on the container, then `video.webkitEnterFullscreen()` on iOS.
    On phones (coarse pointer) it tries `screen.orientation.lock('landscape')` and unlocks on exit.
  - Double-tap in the picture area (not the bottom 56 px) toggles fullscreen.
  - Picture-in-Picture button when `document.pictureInPictureEnabled`.
  - Screen Wake Lock while playing. Released on pause, end and unmount. Re-acquired on visibility change if still playing.
  - Media Session (`lib/media-session.ts`): metadata from `title` (default "FreeTV"), `subtitle` as artist, `artwork`,
    and play/pause/stop handlers.
  - Volume and mute persistence unchanged.

## Bundle sizes (gzip, from `vite build`)

| | Before | After (my changes, TvPlayer stubbed) | After (current repo, see below) |
|---|---|---|---|
| main JS | 830.23 kB raw / 260.23 kB | 281.79 kB raw / 87.85 kB | 880.21 kB raw / 275.98 kB |
| hls.js chunk | inlined | 595.01 kB raw / 184.58 kB (lazy) | inlined |
| CSS | 44.96 kB / 8.15 kB | 56.08 kB / 10.31 kB | 56.08 kB / 10.31 kB |

**Blocker outside this track:** `components/tv/TvPlayer.tsx` imports `hls.js` statically, and `App.tsx` statically imports
`pages/tv/TvPage`. Vite therefore keeps hls.js in the main chunk, and the lazy split in `Player.tsx` has no effect.
Fix in the integrator's or TV track's code: lazy-load the TV route in `App.tsx` (`React.lazy`), or make `TvPlayer`
use `import("hls.js")`. Then the main chunk should drop to about 88 kB gzip.

## Checks run (Chromium headless, `vite preview`, API on :3000)

- `npm run build` passes (tsc and vite). `dist/` contains `manifest.webmanifest`, `sw.js`, `icons/*` and no
  `registerSW.js` script. `dist/sw.js` has the `/proxy/`, `/api/guide.xml` and `/api/admin` NetworkOnly routes and
  the `/api` and `/proxy` navigation denylist.
- Service worker activates at `/`. Manifest serves 200.
- Horizontal overflow, measured against a fixed viewport width:
  - Header: fits at 320, 390 and 844 landscape.
  - `/watch/BBCNews.uk`: no overflow at 320, 390 or 844x390.
  - `/` at 320 px: 4 px overflow, caused by the browse card titles (see below). Not fixed here (browse is not owned by this track).
- Player: video attributes present. On `/` hls.js is not requested. On the watch page it is, and playback attaches an MSE blob.
  Fullscreen button, double-tap fullscreen, PiP button, Media Session title and iOS hint (shown once, stays dismissed) all work.
- Screenshots (not in the repo, per track rules): `/tmp/claude-0/-home-claude/a71a92df-0685-5acd-9194-6f3fd5c66155/scratchpad/shots/`
  as `{home,watch-BBCNews}-{320x568,390x844,844x390}.png`.

Not verified (no device or sandbox support): the update toast (needs a second deployed build), a real
`beforeinstallprompt`, wake lock and orientation lock on a real phone, native iOS fullscreen, and PiP on iOS.

## Issues for other tracks (not edited here)

- **Browse (D):** at 320 px the channel card title links overflow the page by 4 px (right edge 324). Favourite
  hearts, Filters, sort and view buttons are 32 px tall. The card title link covers the whole card, so the card
  itself is a large target.
- **Watch page (E):** the breadcrumb "Channels" link is about 17 px tall. "Add to favorites" and "Share" are 34 px tall.
  Use `min-h-11` on touch screens. The Player's source select is already 44 px.
- **Caddy (H):** `.webmanifest` must be served as `application/manifest+json`. The preview serves it that way. Check the
  production Caddy output with `curl -I`. The CSP allows the worker and manifest.
- hls.js is not precached, so it is fetched on the first watch-page visit and then cached by the browser.
- No preload or preconnect links are added, because logo and stream hosts vary.
