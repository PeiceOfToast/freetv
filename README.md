# FreeTV

A self-hostable web TV player for the free, publicly listed channels aggregated by
[iptv-org](https://github.com/iptv-org/iptv). One site, pick a channel, press play.
Clean browse/search UI, categories, countries, languages, favorites, and a TV guide.

- **Deploy in one command:** `docker compose up -d`. Set `DOMAIN` and HTTPS is automatic.
- **Remix freely:** MIT licensed. Fork it, brand it, point your own domain at it.
- **No streams hosted here:** channel and stream lists are pulled from iptv-org on a schedule.

See `docs/PLAN.md` for the project plan, `docs/ARCHITECTURE.md` for how it fits together,
`docs/API.md` for the HTTP contract and `docs/DEPLOY.md` for hosting (including Oracle Cloud's free tier).

<!-- DEPLOY-SECTION: filled in by infra track -->

## Development

```
cd apps/api && npm i && npm run ingest && npm run dev      # API on :3000
cd apps/web && npm i && npm run dev                        # UI on :5173 (proxies /api)
cd apps/proxy && npm i && npm run dev                      # relay on :3001
```

## Legal

FreeTV only indexes and (optionally) relays streams that are publicly listed in iptv-org's database.
Channels in iptv-org's blocklist are excluded and NSFW channels are hidden by default. If you operate
a copy, you are responsible for complying with the laws of your jurisdiction. Rights holders: please
open an issue at [iptv-org/iptv](https://github.com/iptv-org/iptv/issues) so the removal propagates to every copy.
