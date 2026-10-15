# HTTP API contract (`api` service)

All responses are JSON, UTF-8, `Cache-Control: public, max-age=60` unless noted. Errors:
`{ "error": "message" }` with 4xx/5xx. All list endpoints accept `limit` (default 60, max 200) and `page` (1-based).
Boolean query params accept `true|false|1|0`.

Times are unix seconds (UTC). IDs are iptv-org channel ids, e.g. `BBCNews.uk`.

## `GET /api/health`
`{ "ok": true }` — 200 if the DB is open.

## `GET /api/meta`
```json
{
  "channels": 31570, "streams": 18022, "channelsWithStreams": 9000,
  "lastIngest": 1760500000, "lastEpgImport": 1760500000, "programmes": 1234567,
  "proxyEnabled": true, "hideNsfwDefault": true, "version": "0.1.0"
}
```

## `GET /api/categories` · `GET /api/countries` · `GET /api/languages`
Arrays, sorted by `name`, only entries with `channelCount > 0`.
```json
[{ "id": "news", "name": "News", "description": "...", "channelCount": 812 }]
[{ "code": "US", "name": "United States", "flag": "🇺🇸", "channelCount": 2200 }]
[{ "code": "eng", "name": "English", "channelCount": 5000 }]
```
Optional `?withStreams=true` counts only channels that have ≥1 stream.

## `GET /api/channels`
Query params (all optional):

| param | type | meaning |
|-------|------|---------|
| `q` | string | Full-text search over name, alt names, network, owners, country name, id. Prefix matching on the last token. |
| `category` | string | category id; comma list = OR |
| `country` | string | ISO-3166 alpha-2; comma list = OR |
| `language` | string | ISO-639-3; comma list = OR |
| `hasStream` | bool (default `true`) | only channels with ≥1 stream |
| `online` | bool (default `false`) | only channels with ≥1 stream whose last health check was `online` (if health data exists; otherwise ignored) |
| `nsfw` | bool (default = `!HIDE_NSFW_DEFAULT`) | include NSFW/blocklisted channels |
| `quality` | string | minimum quality: `sd`, `720p`, `1080p`, `2160p` (compares `best_quality`) |
| `favorites` | comma list of ids | restrict to these ids (UI passes localStorage favorites) |
| `sort` | `relevance` (default when `q`), `name` (default otherwise), `country`, `streams`, `quality`, `updated` | |
| `order` | `asc` / `desc` | default `asc`, except `streams`/`quality`/`updated` default `desc` |
| `page`, `limit` | | |

Response:
```json
{
  "total": 812, "page": 1, "limit": 60,
  "items": [ChannelSummary]
}
```
`ChannelSummary`:
```json
{
  "id": "BBCNews.uk", "number": 995, "name": "BBC News", "country": "GB", "countryName": "United Kingdom", "flag": "🇬🇧",
  "categories": ["news"], "languages": ["eng"], "network": "BBC", "isNsfw": false,
  "logo": "https://.../logo.png", "streamCount": 3, "bestQuality": "1080p",
  "online": null,
  "hasGuide": true,
  "now": { "title": "Newsday", "start": 1760500000, "stop": 1760503600 }
}
```
`number` is this instance's stable channel number (null for channels without streams). `now` is included only when `withNow=true` (costs one extra query per page) — the browse grid requests it; `online` is `true|false|null` (null = never probed).

## `GET /api/channels/:id`
404 if unknown. Returns `ChannelDetail`:
```json
{
  "id": "BBCNews.uk", "name": "BBC News", "altNames": [], "network": "BBC", "owners": ["BBC"],
  "country": "GB", "countryName": "United Kingdom", "flag": "🇬🇧",
  "categories": [{ "id": "news", "name": "News" }],
  "languages": [{ "code": "eng", "name": "English" }],
  "broadcastArea": ["c/GB"], "isNsfw": false, "launched": "1997-11-09", "closed": null, "replacedBy": null,
  "website": "https://www.bbc.co.uk/news", "logo": "https://...", "number": 995,
  "streams": [
    { "index": 0, "url": "https://.../master.m3u8", "title": "BBC News", "quality": "1080p", "labels": [],
      "feed": "HD", "userAgent": null, "referrer": null, "online": null, "lastChecked": null,
      "relayOnly": false, "proxyUrl": "/proxy/<sig>/<payload>" }
  ],
  "guides": [{ "site": "bbc.co.uk", "siteId": "bbc_news24", "lang": "en" }],
  "now":  { "title": "...", "start": 0, "stop": 0, "description": "...", "category": null, "icon": null },
  "next": { "title": "...", "start": 0, "stop": 0 }
}
```
Streams are ordered for playback: known-online first, then never-probed, then known-offline; within each group `https` before `http`, then higher quality, then original order. `index` is the catalog index (stable), not the position in this array. `relayOnly` is true when the stream needs a User-Agent/Referer (browsers can't set those, so the UI should skip the direct attempt). `proxyUrl` is omitted when the proxy is disabled.

## Stream health (prober)

A background job in `api` probes stream playlists (HTTP GET of the m3u8 with the stream's UA/Referer, following redirects, reading at most 64 KB; HLS playlists and DASH MPDs count as online) at `PROBE_RATE_PER_SECOND`, cycling through all streams every `PROBE_INTERVAL_HOURS`: never-probed first, then recent failures to confirm, then oldest checks. Streams that failed 10+ times in a row are re-checked once a day. Results go to `stream_health` (keyed by URL, survives ingest) and are mirrored onto `streams.status`/`last_checked` and `channels.online_count`. Status flips to `offline` only after 2 consecutive failures and back to `online` after 1 success. `POST /api/admin/probe` runs a pass now. `GET /api/meta` gains `"health": { "probed": 12000, "online": 8000, "lastProbe": 1760500000 }`.

## Logos

`GET /logo/:id` (`:id` = channel id, optional `?s=64|128|256|512` max edge, default 256) serves the channel's logo from a disk cache (`LOGO_CACHE_DIR`), fetching and resizing on first request (PNG/WebP; SVG passed through), with `Cache-Control: public, max-age=604800, stale-while-revalidate=86400` and ETag. 404 when the channel has no logo; a 1×1 transparent PNG is NOT returned (clients fall back to initials). When `LOGO_CACHE_ENABLED=true` the `logo` field in all channel responses is `/logo/<id>` instead of the upstream URL.

## `GET /api/channels/:id/epg?from=<ts>&to=<ts>`
Defaults: `from` = now − 2 h, `to` = now + 24 h. Max window 7 days.
```json
{ "channel": "BBCNews.uk", "items": [ { "title": "...", "description": "...", "start": 0, "stop": 0, "category": "News", "icon": null } ] }
```

## `GET /api/epg/now?ids=a,b,c`
Batch now/next for up to 200 ids: `{ "a": { "now": {...}|null, "next": {...}|null }, ... }`.

## `GET /api/epg/grid?ids=a,b,c&from=<ts>&to=<ts>`
Up to 100 ids, window ≤ 24 h. `{ "from": 0, "to": 0, "channels": { "a": [Programme], ... } }`.

## `GET /api/stream/:id/:index/play`
Resolve a single stream (used when the UI wants a fresh signed URL):
`{ "url": "...", "proxyUrl": "/proxy/...", "userAgent": null, "referrer": null }`.

## Exports (for Kodi, TiviMate, Plex, VLC, Jellyfin…)

### `GET /api/playlist.m3u`
Each `#EXTINF` also carries `tvg-chno="<number>"`. Same filters as `/api/channels` (`q`, `category`, `country`, `language`, `quality`, `nsfw`, `favorites`, `online`; `hasStream` is forced true; no paging — returns everything matching, capped at 20,000 channels).
Extra params: `proxy=true` emits relayed (absolute) URLs instead of origin URLs; `streams=all|best` (default `best` = first stream per channel).
Content-Type `audio/x-mpegurl`, `Content-Disposition: attachment; filename="freetv.m3u"`. Format:
```
#EXTM3U x-tvg-url="https://tv.example.com/api/guide.xml"
#EXTINF:-1 tvg-id="BBCNews.uk" tvg-name="BBC News" tvg-logo="https://…png" tvg-country="UK" tvg-language="English" group-title="News",BBC News
#EXTVLCOPT:http-user-agent=…        (only when the stream has one)
#EXTVLCOPT:http-referrer=…          (only when the stream has one)
https://…/master.m3u8
```
Absolute URLs use `PUBLIC_URL` when set, else the request's `X-Forwarded-Proto`/`Host`.

### `GET /api/guide.xml`
Streams the current XMLTV file (`EPG_FILE`) as `application/xml`; supports `If-Modified-Since`/`Last-Modified` and gzip when the client accepts it. 404 if no guide exists yet.

## Admin

### `GET /api/admin/status` (Bearer `ADMIN_TOKEN`)
```json
{
  "version": "0.1.0", "uptime": 12345, "now": 1760500000,
  "catalog": { "channels": 31570, "withStreams": 10278, "streams": 16042, "lastIngest": 1760500000, "lastIngestMs": 6184, "source": "mirror" },
  "epg": { "programmes": 234567, "lastImport": 1760500000, "file": { "exists": true, "size": 51400000, "mtime": 1760500000 } },
  "health": { "probed": 12000, "online": 8000, "offline": 4000, "lastProbe": 1760500000, "lastProbeMs": 90000, "running": false },
  "logos": { "cached": 12000, "bytes": 123456789 },
  "proxy": { "enabled": true },
  "db": { "bytes": 120000000, "walBytes": 4096 }
}
```
### `GET /metrics`
Prometheus text format, no auth (bind-mount-only in compose; Caddy does not route it publicly): `freetv_channels_total`, `freetv_channels_with_streams`, `freetv_streams_online`, `freetv_programmes_total`, `freetv_ingest_last_timestamp`, `freetv_epg_last_import_timestamp`, `freetv_probe_last_timestamp`, `freetv_http_requests_total{route,status}`, `freetv_http_request_duration_seconds` histogram.

## `POST /api/admin/ingest`  (header `Authorization: Bearer $ADMIN_TOKEN`)
Triggers a re-ingest in the background. `202 { "started": true }`.

## `POST /api/admin/epg/import`  (same auth)
Forces an XMLTV re-import. `202 { "started": true }`.

---

# Proxy contract (`proxy` service)

`GET ${PROXY_PUBLIC_PATH}/:sig/:payload` — see ARCHITECTURE.md for signing. Returns 403 on bad signature,
502 on upstream failure, 413 if a single upstream response exceeds `PROXY_MAX_BYTES` (default 50 MB; playlists are tiny, segments are a few MB).
`GET /healthz` → `ok`.

# Shared signing helper

Both `api` and `proxy` implement the same function (copy, do not share a package):

```ts
import { createHmac } from "node:crypto";
export function b64url(buf: Buffer | string) { return Buffer.from(buf).toString("base64url"); }
export function signPayload(secret: string, payload: string) { return createHmac("sha256", secret).update(payload).digest("base64url"); }
export function makeProxyUrl(secret: string, publicPath: string, u: string, ua?: string | null, r?: string | null) {
  const payload = b64url(JSON.stringify({ u, ...(ua ? { ua } : {}), ...(r ? { r } : {}) }));
  return `${publicPath}/${signPayload(secret, payload)}/${payload}`;
}
```
