# FreeTV

A self-hostable web TV player for the free, publicly listed channels aggregated by
[iptv-org](https://github.com/iptv-org/iptv). One site, pick a channel, press play.
Clean browse/search UI, categories, countries, languages, favorites, and a TV guide.

- **Deploy in one command:** `docker compose up -d`. Set `DOMAIN` and HTTPS is automatic.
- **Remix freely:** MIT licensed. Fork it, brand it, point your own domain at it.
- **No streams hosted here:** channel and stream lists are pulled from iptv-org on a schedule.
- **Hub, not relay, by default:** the site does not carry video. Viewers watch in the browser when a
  stream allows it, and otherwise send it to an app on their own device (see below).

**Documentation:** [docs/README.md](docs/README.md) is the index. Fastest path to a running site:
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md). Hosting on Oracle's free tier: [docs/DEPLOY-ORACLE.md](docs/DEPLOY-ORACLE.md).
Day-two: [OPERATIONS](docs/OPERATIONS.md) · [TROUBLESHOOTING](docs/TROUBLESHOOTING.md). Hacking: [DEVELOPMENT](docs/DEVELOPMENT.md).

## Quick start

```sh
git clone <repo-url> freetv && cd freetv
cp .env.example .env && infra/scripts/gen-secret.sh --write   # required: sets PROXY_SECRET
docker compose up -d --build                                   # then open http://localhost
```

Set `DOMAIN=tv.example.com` in `.env` for automatic HTTPS. Hosting guide: [docs/DEPLOY.md](docs/DEPLOY.md).

## How to watch

A channel can be watched three ways. Which one a viewer gets depends on the stream.

1. **In the browser.** If the stream plays in a browser, the watch page plays it directly from the
   original host. The site never handles the video.
2. **In an app on the device.** When a stream cannot play in a browser, the watch page offers
   **Open in app**. It hands the stream to a player on the viewer's device (VLC, a TV app, and so on),
   which fetches it directly.
3. **In a TV or phone app.** `/connect` gives everyone the playlist (M3U) and TV guide (XMLTV) URLs for the
   whole site, with steps for each common app and QR codes for TVs.

An optional HLS relay can carry browser-blocked streams through the server. It is **off by default**,
because it makes the server carry every relayed byte. Turning it on, and what it costs, is in
[OPERATIONS: Relay](docs/OPERATIONS.md#relay-off-by-default).

Operators set the site name, public URL and featured apps at `/admin`. Those settings are stored in the
database and take effect at once, with no restart.

## Phones and TVs

FreeTV installs to a phone's home screen and runs in the TV's browser at `/tv`. It can also be
cast or AirPlayed, packaged for Android TV, Tizen and webOS, or used as a playlist source for TV apps.
Open `/connect` on your site for the playlist and guide URLs, with per-app steps.

- [Phones: install and use FreeTV as an app](docs/MOBILE.md)
- [TVs: casting, TV browsers, packaged apps, and playlist export](docs/TV.md)

## Development

```
cd apps/api && npm i && npm run ingest && npm run dev      # API on :3000
cd apps/web && npm i && npm run dev                        # UI on :5173 (proxies /api)
cd apps/proxy && npm i && npm run dev                      # relay on :3001
```

## Legal

Longer version for operators: [docs/LEGAL.md](docs/LEGAL.md).


FreeTV only indexes and (optionally, and off by default) relays streams that are publicly listed in iptv-org's database.
Channels in iptv-org's blocklist are excluded and NSFW channels are hidden by default. If you operate
a copy, you are responsible for complying with the laws of your jurisdiction. Rights holders: please
open an issue at [iptv-org/iptv](https://github.com/iptv-org/iptv/issues) so the removal propagates to every copy.
