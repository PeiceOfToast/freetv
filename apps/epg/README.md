# epg (EPG grabber container)

Produces `/data/epg/guide.xml`, an XMLTV file, on a schedule. The `api` container imports it
(`EPG_FILE`, polled by mtime). The container is a loop around the upstream grabber
[iptv-org/epg](https://github.com/iptv-org/epg) and runs as a non-root user.

## How it works

Each run:

1. **Refresh API data** (`fetch-api-data.mjs`). Downloads the iptv-org JSON the grabber reads from
   `/epg/temp/data` (logos, feed metadata). It tries `https://iptv-org.github.io/api` first and falls back to
   the raw GitHub mirror. A failure keeps the previous files. Skipped if `EPG_REFRESH_API_DATA=false`.
2. **Build the channel list** (`generate-channels.mjs`). Reads `guides.json` from `IPTV_API_BASE`
   (fallback: the raw mirror, or `GUIDES_FILE` locally). Keeps rows with a non-null `channel`, applies
   `EPG_SITES` / `EPG_EXCLUDE_SITES`, and drops sites that have no `sites/<site>/<site>.config.js` in the
   checkout. It writes one `<channel>` per `(channel, site)` into `/work/channels.xml`. When a channel has
   several feeds on one site, the main feed wins (from `feeds.json` if present), then feed `null`, then the
   first row.
3. **Grab** (`npm run grab` in `/epg`), with `--channels`, `--days`, `--maxConnections`, `--timeout` and
   `--output=/data/epg/guide.xml.tmp`. Output streams to the container log.
4. **Publish.** If the grabber exits 0 and the temp file contains at least one `<programme>`, it is renamed
   over `/data/epg/guide.xml`. The rename is atomic, so `api` never reads a half-written file. Otherwise the
   previous guide is kept and the reason is logged.
5. Sleep `EPG_INTERVAL_HOURS`, then repeat.

The grabber exits 0 even when every site request fails (for example, HTTP 403 from a blocked host). That is
why step 4 checks for `<programme>` and not just for a non-empty file.

`SIGTERM` and `SIGINT` stop the loop. A running grabber is killed with its whole process group, and no partial
output is published. The image runs under `tini`.

### Split-by-site mode (`EPG_SPLIT_BY_SITE=true`)

The grabber runs once per site, in sequence. Each site gets its own channels file built from `guides.json`
(not `--sites`, which would use the repo's bundled list instead). Each site's output is then concatenated
into one `<tv>` with only its `<programme>` elements.

- A grabber crash (for example, a site-specific bug that throws) fails a single-mode run and keeps the
  previous guide. In split mode the same crash costs only that site. Per-site logs also say which site
  is failing.
- Cost: one grabber start (npm, tsx, API JSON load) per site, about 210 for `all`. Runs take noticeably longer.
- Programmes from sites are not deduplicated against each other. See "Known issue" below.

## Environment variables

| Variable | Default | Used for |
|----------|---------|----------|
| `EPG_SITES` | `all` | `all` or a comma list of site names, e.g. `tvguide.com,bbc.co.uk`. Unknown names log a warning. |
| `EPG_EXCLUDE_SITES` | (none) | Comma list of sites to drop after `EPG_SITES`. |
| `EPG_DAYS` | `2` | Days of schedule per channel. Grabber requests = channels × days. |
| `EPG_MAX_CONNECTIONS` | `10` | Grabber concurrency. |
| `EPG_TIMEOUT_MS` | `30000` | Per-request timeout passed as `--timeout`. |
| `EPG_INTERVAL_HOURS` | `12` | Pause between runs (minimum one minute). |
| `EPG_RUN_ON_START` | `true` | `false` waits one interval before the first run. |
| `EPG_SPLIT_BY_SITE` | `false` | Per-site mode (see above). |
| `EPG_GRAB_ARGS` | (none) | Extra arguments appended to the grabber command (whitespace split, no quoting). |
| `EPG_REFRESH_API_DATA` | `true` | Refresh `/epg/temp/data` before each run. |
| `FEEDS_FILE` | auto | `feeds.json` for main-feed selection. Set automatically to `/epg/temp/data/feeds.json` when that file exists. |
| `EPG_SITES_DIR` | `$EPG_DIR/sites` | Checkout `sites/` directory, used to drop sites without a grabber config. |
| `IPTV_API_BASE` | `https://iptv-org.github.io/api` | Base URL for `guides.json`. |
| `GUIDES_FILE` | (none) | Local `guides.json` path. Skips the network. For offline testing. |
| `API_MIRROR_BASE` | raw GitHub mirror (set in the image) | Fallback for `guides.json` and the API data files. |
| `EPG_OUTPUT` | `/data/epg/guide.xml` | Published guide path. |
| `EPG_WORK_DIR` | `/work` | `channels.xml` and split-mode scratch files. |
| `EPG_DIR` | `/epg` | Upstream checkout. |

Build arguments: `EPG_REPO` (default `https://github.com/iptv-org/epg.git`), `EPG_REF` (branch or tag,
default `master`), `NODE_IMAGE` (default `node:22-bookworm-slim`; override to use a registry mirror).

## Sizing and expectations

- Full scope (`EPG_SITES=all`): about **24,900** channel entries across about **210** sites, which is about
  **49,800** grabber requests at `EPG_DAYS=2`. Expect hours per run, and most of that time is spent on
  network round trips. A run with `EPG_MAX_CONNECTIONS=10` to `20` is a reasonable starting point.
- Start small. Set `EPG_SITES` to a few sites, check the output, then widen it.
- Memory: in single mode the grabber keeps the whole run's programmes in memory (upstream behaviour).
  Split mode holds one site at a time. Keep `EPG_DAYS` and the site list modest on small VMs.
- Disk: the guide size at full scope was not measured here. Expect it to be large (hundreds of MB is a
  plausible estimate). While a run writes, the old guide and the temp file both exist, so budget for
  roughly twice the guide size.

## Checking progress

```sh
docker compose logs -f epg
```

The grabber prints one line per channel and day (`[i/total] site - channel - date (N programs)`) and
`ERR:` lines for failed requests. A run ends with `run finished` or `run did not publish`.

To check the output: `docker compose exec epg sh -c 'grep -c "<programme" /data/epg/guide.xml'`.

## Running locally

```sh
cd apps/epg
GUIDES_FILE=/path/to/guides.json EPG_SITES=tvguide.com node generate-channels.mjs --out /tmp/channels.xml
```

This prints the counts without needing the grabber. To run the loop against a checkout:

```sh
EPG_DIR=/path/to/epg EPG_WORK_DIR=/tmp/work EPG_OUTPUT=/tmp/out/guide.xml \
GUIDES_FILE=/path/to/guides.json EPG_SITES=tvguide.com node run.mjs
```

## Known issues

- **Overlapping schedules across sites.** `guides.json` maps about 5,300 channel ids to more than one
  site. For example, `BBCNews.uk` is on 68 sites. The grabber writes all of them under the same
  `channel` id, and the `api` importer has no unique key on programmes, so duplicate, overlapping rows
  are stored. See `NOTES.md`.
- **Blocked hosts.** Some sites are unreachable from restricted networks. The grabber logs `403` for each
  request and still exits 0, so the run is kept as "no programmes" and the previous guide stays in place.
  Find out which site is failing with `EPG_SPLIT_BY_SITE=true`.
