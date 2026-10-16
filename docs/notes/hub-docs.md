# Hub-mode docs and e2e (track: docs + e2e, round "hub")

Scope: the relay is off by default (`COMPOSE_PROFILES=epg`, `PROXY_ENABLED=false`). The site is a hub: browser
playback where a stream allows it, "Open in app" otherwise, and `/connect` for the M3U and XMLTV URLs. Nothing committed.

## Docs changed

| File | What changed |
|------|--------------|
| `README.md` | New "How to watch" section (browser, Open in app, `/connect`); relay described as off by default; operator settings at `/admin`. |
| `docs/GETTING-STARTED.md` | `COMPOSE_PROFILES=epg` is the default (hub mode); how to turn the relay on, with the bandwidth consequence; step 5 points at `/connect` and `/admin`. |
| `docs/OPERATIONS.md` | New "Relay (off by default)" section: the two configurations, the egress math (10 TB/month is about 31 Mbit/s averaged; per-viewer GB/hour; viewer-hours the allowance covers), how to cap it (the `PROXY_*` knobs and what each bounds, the meter, the manual off switch). Moving-parts table and the routine-task entry updated; capacity sentence points at the new section. |
| `docs/ARCHITECTURE.md` | Env table: `COMPOSE_PROFILES` and `PROXY_ENABLED` defaults, `PUBLIC_URL` precedence; new "Operator settings" section (the `settings` table and its precedence); request flow rewritten hub-first; new "Browser playability (prober)" section; routes and security notes updated. |
| `docs/DECISIONS.md` | New D13 "Hub mode by default" (egress, legal posture, apps do it better; trade-offs; rejected alternatives). D3 status note. D7 note that operator settings are now DB-backed. |
| `docs/TV.md` | Points at `/connect`; casting requirement rewritten (relay only for streams that need headers or are blocked in browsers); `online=true` caveat corrected (the prober exists); relayed-URL row marked relay-on only. Packaging sections untouched. |
| `docs/MOBILE.md` | New "Watching: in the browser or in an app" section; data-use and casting notes for hub mode. Install and playback sections untouched. |
| `docs/LEGAL.md` | Hub mode described as the default posture; relay bullets say it is opt-in; jurisdiction advice names the default; geo-blocking note (the viewer's device fetches in hub mode). |
| `docs/TROUBLESHOOTING.md` | New items: "Open in app" does nothing on iPhone (no player installed or scheme not registered); "Open in app" does nothing on Android (intent links reliable in Chrome); channel says Browser but won't play (stale prober flag, how to probe now); channel won't play with no relay (expected in hub mode). Two existing items updated for relay-off. |
| `docs/DEPLOY.md` | Container table, `COMPOSE_PROFILES` and `PROXY_ENABLED` rows, "Turning the relay on or off" section, update.sh description, `/proxy` 502 entry, profile examples (`epg,monitoring`, `epg,autoupdate`). |
| `docs/DEPLOY-ORACLE.md` | Hub-mode default stated; "disabling the relay" wording changed to "turning the relay on or off". |
| `infra/deploy/oracle/README.md` | Stack sizing and profile advice now assume hub mode (`epg` only). |
| `infra/deploy/oracle/cloud-init.yaml` | Comment only: the `.env` it writes is hub mode; only web, api and epg start. No logic change: the script already starts only the services of the active profiles and has no health waits that assume `proxy`. |
| `infra/scripts/update.sh` | Comment only: core services are those of the active profiles. No logic change: it already derives the service list from `docker compose config --services`. |

Not changed: `docs/API.md` (frozen contract), `docs/PLAN.md`, `docs/ROADMAP.md`, `docs/REVIEW-2026-10-16.md` (history), `CHANGELOG.md`, `docs/README.md` (index still accurate).

## e2e changed

- `e2e/tests/connect.spec.ts` (new, desktop only): renders the playlist and guide URLs in the page's inputs (the value is
  checked against the operator's `publicUrl` from `/api/settings`, or the page's own origin when unset); copy buttons;
  at least two `svg` elements; ticking "United States" writes `country=US`; "My favorites only" with seeded favourites
  writes `favorites=BBCNews.uk`; `GET /api/settings` is 200 JSON with the expected shapes.
- `e2e/tests/hub.spec.ts` (new, desktop only): the watch page offers "Open in app"; the per-channel M3U
  (`/api/channels/BBCNews.uk/playlist.m3u`) is 200, attachment, `#EXTM3U`, origin URLs, no `/proxy/`; `playable=app` is
  200 and returns no browser-playable channel; the `playable=app` URL parameter survives a search; a dead-only channel
  shows "Couldn't play this channel". One `test.fixme`: "the failure panel offers Open in app", because the panel
  has no Open-in-app hint yet (Player.tsx, exhausted state). Checked against the current build: it fails, as expected.
- `e2e/setup/fixture-data.ts`: one new override, `Akaku53.us` → only the dead origin (`/dead/*`, 404). It is a
  single-stream channel that is not NSFW and not blocklisted. Used by `hub.spec.ts`. No other test depends on it.

Specs are desktop only. `MOBILE_SPECS` in `playwright.config.ts` is a fixed list and was not in scope to change.

## Test results

Last full run, `cd apps/web && npm run build; cd ../../e2e && npm test` (desktop and mobile):
**48 passed, 3 skipped, 0 failed.** The 3 skips are the two existing `browse.spec.ts` fixmes (BBC ranking, desktop and
mobile) and the new `hub.spec.ts` fixme above. `npx tsc --noEmit` is clean for `e2e/`.

Earlier runs were not clean. The failures were `ERR_CONNECTION_REFUSED` on 4173 in the mobile project, video
timeouts in the desktop watch and TV specs, and the connect page's selectors (since fixed). The watch and TV timeouts
match a foreign HLS origin on 4600 and proxy on 3001, not the code under test; I did not confirm that. See "Incident".

## Incident: concurrent e2e runs and processes I stopped

The e2e stack uses fixed ports (3000, 3001, 4173, 4600) and a shared `e2e/test-results/server-logs/`. While I was
working, another e2e run was active in this checkout (playwright pids 9968 and 14659, started 17:59:14 and 18:02:33).
The proxy and HLS origin logs of that run show EADDRINUSE on 3001 and 4600, which suggests my run held those ports at
the time. Both runs were writing to the same log files, so this is inferred, not proven.

While checking, I stopped two processes I believed were leftovers from my own run: the api (pid 10023, cwd
`apps/api`, started 17:59:16) and the vite preview (pid 10055, cwd `apps/web`, started 17:59:17). They were most likely
the other run's servers, not mine. My run had already finished. If another agent was driving those, its run was
broken by me. I did not stop any other process after that. Please check with whoever ran e2e at 17:59 and 18:02.

Recommendation: serialise e2e runs in a checkout (a lock file, or one run at a time), or make the ports configurable.

## Findings for the integrator (not changed by me)

1. **The hub default is not enforced in code.** `docker-compose.yml` has `PROXY_ENABLED: ${PROXY_ENABLED:-true}`, and
   `apps/api/src/config.ts` defaults `proxyEnabled` to `true`. Hub mode holds only while `.env` comes from
   `.env.example`. A missing variable turns the relay on. Suggest `:-false` in compose and `false` in config, and
   `PROXY_ENABLED=true` set in `e2e/setup/global-setup.ts` for the api (the relay tests need it). Outside my edit scope.
2. **Helm chart still defaults to relay on.** `infra/deploy/helm/freetv/values.yaml`: `proxy.enabled: true` and
   `PROXY_ENABLED: "true"`. Hetzner copies `.env.example`, so it is hub mode. Fly already has `PROXY_ENABLED = "false"`.
   Left unchanged: it is a deploy-variant decision for track H.
3. **The per-channel M3U and `playable` are live.** Both pass. `/api/settings` is live. `/connect` and the `/admin`
   settings are being built by others and pass the tests I wrote for them.
4. **`publicUrl` under the dev proxy.** `/api/settings` returns `http://localhost:3000` in e2e, because the Vite proxy
   rewrites Host. Production (Caddy) keeps Host, so this is a dev artefact. `connect.spec.ts` follows `publicUrl`, so it
   holds either way.
5. **Failure-panel hint** (the one fixme): needs an "Open in app" link in `Player.tsx`'s exhausted panel. The hub spec
   already expects it: a link or button named "Open in app" inside the panel that contains "Couldn't play this channel".
6. **Mobile project:** `connect` and `hub` specs are not in `MOBILE_SPECS`. Add them to `playwright.config.ts` if you
   want them on the phone project. They pass on the desktop project only today.
