# Legal notes for operators

This is a plain-language description of what FreeTV does, written so an operator can make an informed
decision. It is not legal advice; laws differ by country and change over time.

## What the software does

- It downloads the public channel, stream and guide databases maintained by the iptv-org community
  and shows them in a website, the same way the iptv-org repository and many players already do.
- It plays streams **from their original hosts** in the visitor's browser. FreeTV does not host, copy,
  record, transcode or store any video.
- With the relay profile enabled, the server **passes stream bytes through** for streams the browser
  cannot load directly. Bytes are forwarded, not stored. The relay only works for URLs the api signed,
  i.e. streams that are in the catalog, and it refuses private networks.
- It (optionally) **scrapes programme listings** from public TV-guide websites using iptv-org/epg's
  scrapers, on a schedule you control.

## What it deliberately does not do

- It excludes every channel on iptv-org's blocklist (DMCA and NSFW reasons) from listing, playback
  and export, and hides channels flagged NSFW unless the viewer opts in.
- It collects no personal data: no accounts, no analytics, no cookies beyond what the browser needs.
- It does not add, edit or crowd-source stream URLs. Adding a stream means contributing it upstream.

## Things an operator should think about

- **Jurisdiction.** Relaying a stream can be treated differently from linking to it. If you are unsure,
  run with the relay disabled (`COMPOSE_PROFILES=epg`, `PROXY_ENABLED=false`); the site still works for
  every stream that plays directly.
- **Geo-blocking.** Some streams are licensed for one country. The relay would make them appear to
  come from your server's country. That is a reason some operators keep the relay off or restrict the
  instance to a region.
- **Guide sites' terms.** Scraping public listings for personal use is common; running a large grab
  every 12 hours from a public server is heavier. Narrow `EPG_SITES` to what your audience needs and
  keep `EPG_MAX_CONNECTIONS` modest.
- **Bandwidth agreements.** Your hosting provider's acceptable-use policy may say something about
  relaying video. Oracle's free tier allows 10 TB/month egress at the time of writing.

## Takedowns

Rights holders should open an issue at https://github.com/iptv-org/iptv/issues ; removals there
propagate to every FreeTV instance within `INGEST_INTERVAL_HOURS`. An operator who wants to remove
something immediately on their own instance can add the channel id to a local blocklist: create
`local-blocklist.json` in the `data` volume (`docker compose exec api sh -c 'echo \'["SomeChannel.us"]\' > /data/local-blocklist.json'`)
and trigger an ingest (or wait for the next one). The path is configurable with `LOCAL_BLOCKLIST`. The About page tells
visitors where to send takedown requests; customise it for your instance.
