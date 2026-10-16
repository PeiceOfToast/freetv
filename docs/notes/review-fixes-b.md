# Review fixes B: relay URL expiry (review 2.2) and relay secret rotation (review 3.6)

## What changed

- **Payload** is now `{u, ua?, r?, exp}`, `exp` in unix seconds. Both copies of `makeProxyUrl` take `exp` as a required argument (`apps/api/src/lib/sign.ts`, `apps/proxy/src/sign.ts`).
- **api** signs channel and stream URLs with now + `PROXY_URL_TTL_SECONDS` (default 86400, 24 h). It signs M3U relay URLs with now + `PROXY_EXPORT_TTL_SECONDS` (default 604800, 7 d). Both are read in `apps/api/src/config.ts`.
- **proxy** rejects a payload with no `exp` (`403 {"error":"expired"}`) and one whose `exp` is more than 30 days ahead (`403 {"error":"invalid expiry"}`). A non-integer `exp` is `400 invalid payload`. Playlists are refused after `exp`. Segments also get a 600 s grace period (`checkExpiry` in `apps/proxy/src/sign.ts`).
- **Playlist rewriting** gives every child URL the parent's `exp`, so a session cannot extend itself (`apps/proxy/src/playlist.ts`, `server.ts`).
- **Upgrade effect**: relay URLs issued before this change have no `exp` and stop working. Clients get 403 and must re-open the channel or re-download the M3U. No grandfathering.

## Known gaps (need follow-up)

1. **M3U export still gets the 24 h TTL, not 7 d.** `apps/api/src/routes/export.ts` (not on the edit list) calls `proxyPathFor: (s) => proxyUrlFor(...)` and drops the `exp` that `export-m3u.ts` now passes. The fix is one line in `export.ts`:
   `proxyPathFor: (s, exp) => proxyUrlFor(s.url, s.userAgent, s.referrer, exp),`
   The route-level test for this is marked `todo` in `apps/api/test/export-playlist.test.ts` and will start passing with that change. The unit-level check in `apps/api/test/sign.test.ts` already passes.
2. **`apps/api/test/routes-catalog.test.ts` fails** at its `proxyUrl` assertion (around line 337). It still compares against a 5-argument `makeProxyUrl` with no `exp`. Fix: decode the payload, check `exp` is about now + 86400, and compare the signature over the same `exp`. This file was outside the edit list.
3. **The web Player does not re-fetch on a 403.** On a fatal hls.js error it moves to the next candidate (`Player.tsx`, `plan.ts`). All relay candidates for a stream share its `exp`, so a live session watched past its TTL, or a paused tab resumed after 24 h, ends in a playback failure. The 600 s segment grace covers in-flight segments only. Making the Player re-fetch the channel on a playlist 403 is the real fix, and it sits in the web track.

## Tests

- `apps/proxy`: 83/83 pass (was 70). Added `test/expiry.test.ts` with 9 integration cases (expired playlist, served within exp, segment grace, segment past grace, missing exp, far-future exp, non-integer exp, children inherit exp, expired parent gets no upstream request) and 4 unit cases for `checkExpiry` in `test/units.test.ts`.
- `apps/api`: my files pass (`routes-stream`, `export-playlist`, new `sign.test.ts`: 28 pass, 1 todo). The full suite has 8 failures outside this work:
  - `routes-catalog.test.ts` proxy assertion (gap 2 above).
  - `routes-catalog.test.ts` `sort=updated` test and the prober tests. These come from concurrent changes in `probe.ts`, `scheduler.ts`, `ssrf.ts` and other files that are not part of this work. The prober does not import the signing code.
  - `apps/api/src/lib/ssrf.ts` has a typecheck error (`connect.lookup` type) from the same concurrent work.
- `e2e`: 37 pass, 2 skipped (both pre-existing `test.fixme`). Run with `PROXY_SECRET=e2e-secret`, which exercises real relay playback.

## Docs

- `docs/API.md`: proxy contract (expiry, 403 bodies, TTLs, upgrade note) and the signing helper (new signature, `exp` required).
- `docs/ARCHITECTURE.md`: env rows for `PROXY_URL_TTL_SECONDS` and `PROXY_EXPORT_TTL_SECONDS`, request-flow step 4.
- `apps/proxy/README.md`: expiry checks in the limits order.
- `docs/OPERATIONS.md`: "Rotate the relay secret" (revokes all URLs at once; without rotation, URLs end at their `exp`).
- `.env.example` was not touched. It has concurrent changes from another track. Add the two new variables there.

## Notes

- `PROXY_URL_TTL_SECONDS` and `PROXY_EXPORT_TTL_SECONDS` must be positive, and at most 2592000 (30 d). The proxy rejects anything further ahead. The config reader does not validate this.
- Nothing is committed.
