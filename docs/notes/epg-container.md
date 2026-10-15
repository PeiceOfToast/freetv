# Track G (epg container) notes

## Status

| Piece | State |
|-------|-------|
| `generate-channels.mjs` | Done. Tested offline (`GUIDES_FILE`), network fallback, two-site filter, bad site name, sites-dir filter. |
| `fetch-api-data.mjs` | Done. 13/13 files fetched from the mirror in about 5 s (primary host denied by policy here). |
| `run.mjs` | Done. Tested with a fake grabber: publish, keep-previous on empty or failed grab, SIGTERM mid-grab (no leftovers, no partial publish), split mode with one failing site. Also run against the real upstream checkout (grabber accepts our `channels.xml`). |
| `Dockerfile` | Written, **not built**. See "Build not verified". |
| `README.md` | Done. |

## Build not verified

`docker build apps/epg` could not complete in this sandbox:

- `node:22-bookworm-slim` cannot be pulled. `registry-1.docker.io` does not resolve, and the agent proxy denies
  `auth.docker.io`, `mirror.gcr.io` and `public.ecr.aws`. No base image is cached.
- The host is Ubuntu 24.04. Debian apt mirrors (`deb.debian.org`) are unreachable, so `apt-get install git ca-certificates tini`
  cannot run here. `tini` is not installed on the host.
- The Docker daemon was not running. I started `dockerd` with sudo for these checks. It is still running.
- `docker buildx build --check` fails for the same reason (it needs the base image's metadata).

What I did instead: `ARG NODE_IMAGE=node:22-bookworm-slim` before `FROM` makes the base overridable for a registry
mirror. Everything after `FROM` was checked by running the same commands on the host, except the non-root
(`USER epg`) variant, which was not exercised. Run `docker build apps/epg` once on a host with registry access.
The ARM build is not checked. The grabber's dependencies look portable (JS plus `libxml2-wasm`, a WASM build),
but this is unverified.

## Findings that affect the integrator

1. **Cross-site overlap (needs a decision).** The contract says "one entry per (channel, site)". In guides.json,
   5,312 channel ids are on more than one site (`BBCNews.uk` on 68, `France24.fr` on 67). The grabber writes all
   of them under the same `channel` attribute. `programmes` in `apps/api/src/db/schema.sql` has no unique key, so
   the importer stores overlapping, conflicting rows for the same channel and time. Options:
   - (a) One site per channel, chosen by a priority list (for example, the order in `EPG_SITES`). This needs a
     contract change to ARCHITECTURE.md ("EPG pipeline").
   - (b) Keep all sites, and have the importer dedupe on `(channel, start_ts)` or keep the newest.
   Not implemented. The current output follows the contract.
2. **`postinstall` (`npm run api:load`) fails silently.** `scripts/api.ts` in iptv-org/epg uses `Promise.allSettled`,
   so the step exits 0 when downloads fail. The SDK hardcodes `https://iptv-org.github.io/api` (no env override).
   In this sandbox the proxy denies `iptv-org.github.io:443` (policy), and `temp/data` is never created. The grabber
   then runs with empty metadata and logs ENOENT stack traces. `fetch-api-data.mjs` fills `/epg/temp/data` from the
   raw mirror and fails the build under `--strict`.
3. **The grabber exits 0 when every request fails.** It printed `ERR: Request failed with status code 403` for every
   channel and wrote an empty `<tv>`. `run.mjs` therefore checks for at least one `<programme>` before publishing.
4. **A missing site config crashes the whole grab.** A channel whose site has no `sites/<site>/<site>.config.js`
   throws `ERR_MODULE_NOT_FOUND` and stops the run. `generate-channels.mjs` drops such sites (`EPG_SITES_DIR`,
   default `$EPG_DIR/sites`). Today all 210 mapped sites have configs at upstream master, so the filter drops nothing.
5. **Feed choice.** Only 230 of 31,551 mapped rows have `feed: null`, so "prefer null" rarely decides anything. With
   `FEEDS_FILE`, the generator uses `feeds.json` `is_main` (31,570 of 45,168 feeds are main). `run.mjs` sets this
   automatically after the API refresh. Note that `feeds.json` `id` is the feed name (e.g. `SD`), not `channel@feed`.
6. **Sandbox blocks.** `backend.tvguide.com` is denied by the proxy (policy 403), so no real programmes were fetched.
   `bbc.co.uk` has no rows in guides.json at all. Test programmes came from a fake grabber.
7. **Scale.** `EPG_SITES=all` gives 24,895 entries. At `EPG_DAYS=2` that is about 49,800 grabber requests (one per
   channel per day), so expect hours per run.

## Counts (guides.json at `apps/api/.data/raw/guides.json`)

- Rows: 180,681. Unmapped (`channel: null`): 149,130. Mapped: 31,551. Incomplete: 0.
- Mapped rows with `feed: null`: 230.
- Duplicates per (channel, site) dropped: 6,656.
- `EPG_SITES=all`: 24,895 entries, 210 sites, 11,723 channel ids.
- `EPG_SITES=tvguide.com,bbc.co.uk`: 153 entries, 1 site (`bbc.co.uk` has no rows, warning printed).
- `EPG_SITES=nope.example`: 0 entries, exit 2.

The brief estimated 153k unmapped and 27k mapped rows. The actual values are 149k and 31.5k.

## Deviations from the brief

- `npm install` is kept as specified (not `npm ci`). The Dockerfile uses `git clone --depth 1 --branch "$EPG_REF"`,
  so `EPG_REF` must be a branch or tag, not a commit SHA. Upstream master was `8c23cfe` when tested.
- Split mode runs each site with `--channels=<per-site file>`, not `--sites=<site>`. `--sites` would use the repo's
  bundled channel list, not the guides-derived list. Split mode concatenates only `<programme>` elements (the
  importer needs nothing else). Each per-site file is read whole, not byte-streamed.
- Additional env vars: `EPG_EXCLUDE_SITES`, `EPG_REFRESH_API_DATA`, `EPG_TIMEOUT_MS`, `FEEDS_FILE`, `EPG_SITES_DIR`,
  `EPG_WORK_DIR`, `EPG_OUTPUT`, `EPG_DIR`, `API_MIRROR_BASE`. The build args are `EPG_REPO`, `EPG_REF`, `NODE_IMAGE`.
  `ARCHITECTURE.md` lists only some `EPG_*` vars for the epg container. The others are optional and default safely,
  so the contract only needs updating if the integrator wants them documented there.
- The publish check requires `<programme>`, which is stricter than "non-empty file" in the brief.

## For the integrator

- The compose service `epg` needs the `data` volume mounted at `/data`. The image runs as uid 10001 (`epg`), so the
  volume must be writable by that uid. A named volume picks up the image's ownership on first use.
  Leave `IPTV_API_BASE` at its default. The mirror is the fallback.
- `run.mjs` does not depend on `api`. The `api` importer polls `EPG_FILE` mtime, so an atomic rename is enough.
- Decide finding 1 before the sprint ends. It changes what users see in the guide.
