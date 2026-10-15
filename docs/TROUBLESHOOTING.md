# Troubleshooting

Symptom first, then the usual cause and the fix. Start every investigation with:

```sh
docker compose ps
docker compose logs --tail=100 api web proxy epg
curl -s http://127.0.0.1/api/health      # run on the VM; bypasses DNS/TLS
```

## Site does not load

**Browser times out.** Ports 80/443 are not reachable. Check the cloud firewall / security list
*and* the VM's own firewall (Oracle images ship with iptables rules that drop everything but 22).
`sudo iptables -L INPUT -n --line-numbers` should show ACCEPT for 80 and 443 above the REJECT line.

**`ERR_SSL_PROTOCOL_ERROR` or certificate warning.** Caddy could not get a certificate. Causes, in
order of likelihood: the DNS record does not point at this VM yet; port 80 is blocked (ACME HTTP
challenge needs it); `DOMAIN` has a typo; you hit Let's Encrypt's rate limit by recreating the
`caddy_data` volume many times. `docker compose logs web | grep -i acme` says which.

**Plain HTTP works, HTTPS does not.** `DOMAIN` is empty in `.env`. Set it and `docker compose up -d web`.

**502 from Caddy on every page.** `api` is down or still starting (first boot runs an ingest before
listening? No: it listens immediately, so a 502 means the container is restarting). `docker compose logs api`.

## Catalog problems

**`/api/meta` shows `channels: 0`.** The first ingest failed, usually no outbound internet from the
VM or a proxy in the way. Look for `ingest: ... failed` lines. The api retries at the next interval;
to retry now: `docker compose restart api`.

**Ingest fails with "fetch failed" for iptv-org.github.io but the mirror also fails.** Outbound HTTPS
is blocked. Check `curl -sI https://raw.githubusercontent.com` from inside the container:
`docker compose exec api node -e "fetch('https://raw.githubusercontent.com').then(r=>console.log(r.status))"`.

**Channel counts look wrong after an update.** The schema version changed and the catalog tables were
dropped on startup; the next ingest refills them within seconds. If it does not, force one via
`POST /api/admin/ingest`.

**Search finds nothing for a channel that exists.** The FTS index is rebuilt with each ingest. If
`channels_fts` is empty (`/api/channels?q=bbc` returns `total: 0` while `/api/channels` works),
force an ingest.

## Playback problems

**"Couldn't play this channel" for everything.** Check one stream manually from the VM:
`curl -sI <stream url from /api/channels/ID>`. If it works from the VM but not the browser, it is
CORS/mixed content and the relay should have caught it — see the next item. If it fails from the VM
too, the stream is dead or geo-blocked; nothing to fix.

**Relay URLs return 502.** The `proxy` container is not running (profile disabled) while
`PROXY_ENABLED=true` makes the api hand out relay URLs anyway. Either enable the profile or set
`PROXY_ENABLED=false` so the UI stops trying.

**Relay URLs return 403.** `PROXY_SECRET` differs between `api` and `proxy` (both read it from `.env`;
restart both after changing it), or the URL was built for a different `PROXY_PUBLIC_PATH`.

**Relay returns 403 for a stream whose host is an IP address.** The SSRF guard refuses private,
loopback and link-local ranges. Streams on public IPs are fine. For a LAN-only test instance set
`PROXY_ALLOW_PRIVATE=true` (never on the internet).

**Channel plays on desktop but not on iPhone.** iOS Safari uses native HLS, which is stricter about
playlists (e.g. missing `#EXT-X-VERSION`, mixed codecs). Try "Prefer relay" or another source in the
source picker; otherwise it is the stream.

**Playback stalls every few seconds through the relay.** The VM's upload bandwidth or
`PROXY_MAX_CONCURRENT` is saturated. `docker compose logs proxy` shows request timings. Consider
disabling the relay for the public or putting the site behind a CDN that does not cache video.

**A stream starts, then stops after ~10 s, then works again.** Some iptv-org streams are "Not 24/7"
(label visible on the channel page) and some rotate tokens; the player falls through to the next
source automatically. Nothing to fix.

## Guide (EPG) problems

**`programmes: 0` after hours.** Either the grab is still running (`docker compose logs -f epg` —
with `EPG_SITES=all` the first run takes hours), or every site failed (the log ends with a summary).
A grab that produced no programmes is discarded on purpose and the previous guide, if any, is kept.

**The grab finished but `lastEpgImport` did not change.** The api polls `EPG_FILE` every 60 s and
compares mtime/size. Check the file exists in the shared volume:
`docker compose exec api ls -la /data/epg/`. If `api` and `epg` mount different volumes (edited
compose), the api never sees it.

**Guide shows for some channels but not others.** Only channels that iptv-org has mapped to a guide
site get data (about 11,700 of the ~10,000 with streams overlap partially). The channel page shows
"No programme info" with `hasGuide: true` when a mapping exists but the grab for that site failed.

**Grab is too heavy for the VM.** Lower `EPG_MAX_CONNECTIONS` (10 → 4), reduce `EPG_DAYS` (2 → 1),
narrow `EPG_SITES`, or raise `EPG_INTERVAL_HOURS`. Or set `EPG_SPLIT_BY_SITE=true` so one slow site
cannot stall the whole run.

**Programme times are off by hours.** The guide stores UTC; the UI renders in the viewer's time zone.
If the times are wrong *and* consistent, the source site publishes a wrong offset; pick another site
for that channel by excluding the bad one with `EPG_EXCLUDE_SITES`.

## Build and deploy problems

**`docker compose up --build` fails compiling `better-sqlite3`.** Rare on Debian-slim images; usually
a transient npm registry failure. Re-run. If it persists on an exotic arch, prebuilt binaries may be
missing; the image falls back to compiling and needs `python3 make g++`, which the Dockerfile installs.

**`epg` image build fails at `npm install` in iptv-org/epg.** Their `postinstall` downloads API data.
Network at build time is required. Behind a corporate proxy set `HTTP_PROXY`/`HTTPS_PROXY` as build args.

**CI's image job fails with "manifest unknown" when pulling on the VM.** Your fork has not pushed
images yet (the job only pushes on `main`/tags), or `GITHUB_REPOSITORY_OWNER` in `.env` does not
match your GitHub user/org (it must be lowercase). Use `docker compose up -d --build` instead.

**`infra/scripts/update.sh` refuses to run.** `PROXY_SECRET` still starts with `change-me`. Run
`infra/scripts/gen-secret.sh --write`.

**Caddyfile edits are ignored.** Edit `infra/caddy/Caddyfile` (bind-mounted) and reload:
`docker compose exec web caddy reload --config /etc/caddy/Caddyfile`. `apps/web/Caddyfile` is only
the image default; CI requires the two to stay identical.

## Phone / TV problems

**The PWA install button never appears.** Chrome shows it only on HTTPS, after the service worker
registered, and only once per site unless dismissed; iOS has no install prompt at all (Share → Add to
Home Screen). `chrome://flags` does not need changing.

**App shows an old version after an update.** The service worker updates in the background and shows
a "Reload" toast on the next visit; force it by closing all tabs of the site, or Settings → Clear site data.

**Cast button missing.** It appears only on HTTPS, in Chrome/Edge desktop and Chrome on Android
(as the Remote Playback "cast" icon), after the Cast SDK loaded (ad blockers sometimes block gstatic).

**Cast starts and immediately stops.** The Chromecast fetches the stream itself and needs CORS, so it
uses the relay URL; if the relay is disabled, only CORS-friendly https streams can be cast. Also the
Chromecast must be able to reach `PUBLIC_URL` (a LAN-only instance with a private IP in `PUBLIC_URL`
works on the same Wi-Fi; a `localhost` instance does not).

**`/tv` keys do nothing on my TV.** The TV browser sends vendor key codes; `/tv` handles Samsung
(Tizen) and LG (webOS) codes plus standard arrows/Enter/Back. If a key is dead, open the browser's
console (or `docs/notes/web-tv.md` for the mapping) and file an issue with the TV model and key code.
Older TV browsers (Tizen ≤ 5, webOS ≤ 4) also need the build target lowered; see `docs/notes/web-tv.md`.
