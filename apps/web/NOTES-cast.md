# Cast / AirPlay track (notes)

## Built
- `src/lib/cast.ts`: Google Cast sender. Loads `cast_sender.js?loadCastFramework=1` lazily, only when `castSupported()` is true and only from the first watch-page component that calls `useCastState()`. Initialises CastContext with the Default Media Receiver (`chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID`) and `autoJoinPolicy: ORIGIN_SCOPED`. Exports `castSupported`, `ensureCast`, `castCandidates`, `castChannel`, `stopCasting`, `castPlayPause`, `useCastState`.
- `src/components/cast/cast-types.d.ts`: narrow ambient types for `cast.framework` and `chrome.cast`. Global script, no imports. No `@types` package added.
- `src/components/cast/CastButton.tsx`: Cast button. Idle shows "Cast"; connecting shows a spinner; connected shows the device name and opens a small menu ("Cast <channel>" if it is not already playing, "Stop casting").
- `src/components/cast/CastBar.tsx`: "Casting to <device> · <channel>" strip with Play/Pause and Stop. Shown only while CONNECTED.
- `src/components/cast/AirPlayButton.tsx`: Safari shows AirPlay, using `webkitShowPlaybackTargetPicker()` on the page `<video>`, once `webkitplaybacktargetavailabilitychanged` reports `available`. Android Chrome gets a "Cast" button backed by `video.remote.prompt()`, shown only when `watchAvailability` reports available.
- `src/components/cast/parts.tsx`: icons (Cast, AirPlay, spinner) and the shared button class.
- `src/pages/watch/WatchPage.tsx`: imports the three components. `<CastBar />` sits under `<Player>`. `<CastButton>` and `<AirPlayButton>` sit in the existing favorite/share row, which already wraps. Nothing else changed.
- Player.tsx and api.ts were not touched.

## Stream choice
- Cast uses one URL per stream, in the API's stream order: `new URL(proxyUrl, origin).href` when `proxyUrl` exists, otherwise the direct `url` only if it is `https://`. Streams with neither are skipped.
- A receiver error (a `loadMedia` rejection, or a media status of IDLE with `idleReason: ERROR`) moves to the next URL. At most 4 attempts. After that the bar shows an error.
- When the session is connected and the user opens another channel, the page casts that channel into the same session. This only happens if this page already started a cast. A fresh page load that re-joins an existing session (ORIGIN_SCOPED autojoin) does not restart playback.

## Constraints
- **CSP**: `apps/web/Caddyfile` and `infra/caddy/Caddyfile` set `Content-Security-Policy "frame-ancestors 'self'; media-src * blob:; connect-src *"`, with no `script-src`. The gstatic script loads without a change, so no Caddy change is needed.
- **HTTPS is required.** Cast needs a secure context (`window.isSecureContext`). Hosting over plain HTTP hides the button.
- **http:// streams cannot be cast from an https page.** A page on https cannot hand the receiver an `http://` URL (mixed content), so such a stream is skipped unless it has a relay URL.
- **The relay is what makes many channels castable.** Many iptv-org streams are `http://`, or lack the CORS headers the receiver needs. The relay fetches the upstream and serves it over https with CORS. With the proxy disabled, only streams that are already https with CORS can be cast.
- **Relay bandwidth.** Each cast session pulls the stream through the server (`proxy` service) at the stream's full bitrate. Rough guide, not measured: 2 to 8 Mbps for typical HD live HLS. That is the same cost as local playback through the relay, but it continues while the TV plays, even if this tab is closed, until the receiver stops. The Cast device fetches the relay URL itself, so the server must be reachable from the device's network.
- **Android Chrome** is excluded from the Cast SDK (`castSupported()` returns false there). It uses the Remote Playback API instead.
- **iOS** cannot use the Cast SDK. Safari gets AirPlay instead. iOS Chrome is also excluded because it is WebKit.
- **AirPlay on video**: Player.tsx does not set `x-webkit-airplay="allow"`, which some iOS Safari versions expect. It is not needed on macOS Safari. Player.tsx is owned by track E and was not edited. If iOS AirPlay does not appear, add that attribute to the Player `<video>`.
- **No `video` ref**: `AirPlayButton` finds the page's `<video>` with `document.querySelector('video')`. It is correct today because there is one player per page.

## Integrator needs
- Nothing in `lib/api.ts`, `App.tsx`, layout, Player or browse.
- `npm run build` passes (tsc strict, zero errors). Build output is in `apps/web/dist` (regenerated).
- Not yet exercised against a real Chromecast or Safari. See the checklist.

## Manual test checklist
1. **Desktop Chrome, https, not casting.** Open a watch page. A "Cast" button appears in the action row once the SDK loads. Open DevTools Network and confirm `cast_sender.js` loads only on the watch page and not on browse.
2. **Ad blocker on.** Block gstatic. No Cast button appears. The page otherwise works, with no console error beyond the blocked request.
3. **Picker cancelled.** Click Cast and dismiss the picker. Nothing changes and no error appears.
4. **Connect.** Pick a device. The state goes CONNECTING (spinner) then CONNECTED (device name shown). The CastBar appears under the player with "Casting to <device> · <channel>".
5. **Stream plays.** The TV plays the channel. Pause and Play on the bar change the TV. Stop ends the session, the bar disappears, and the button returns to "Cast".
6. **Fallback.** Use a channel whose first stream is dead, or a bad relay URL. The receiver reports an error and the next stream plays. After 4 failures the bar shows "could not play this channel".
7. **Navigate while casting.** With the TV playing, open another channel from the browse page or from the guide. The TV switches to the new channel without a click.
8. **Reload while connected.** Reload the watch page. The session re-joins, but the TV does not restart playback. The bar shows "nothing playing from this page" until Cast is clicked.
9. **Connected menu.** While connected, the button opens a menu. "Stop casting" works.
10. **http-only channel.** A channel whose streams are all http:// and have no proxy shows a disabled Cast button with the tooltip.
11. **Mobile width.** The action row wraps cleanly at 360px, and the CastBar text truncates without pushing the page sideways.
12. **Safari macOS, https.** AirPlay appears only once the video reports a target. Clicking it opens the system picker. Choosing a device plays the stream on the Apple TV.
13. **Safari iOS.** AirPlay appears when a target is available. If it does not, check whether `x-webkit-airplay="allow"` is needed (see Constraints).
14. **Chrome Android, https.** The "Cast" (Remote Playback) button appears when the device reports availability. Clicking it opens the native picker.
15. **Firefox and other browsers.** No Cast or AirPlay button appears. The page renders with no errors.
