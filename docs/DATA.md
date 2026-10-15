# iptv-org datasets (as of Oct 2026)

Base: `https://iptv-org.github.io/api/<name>.json` (mirror: `https://raw.githubusercontent.com/iptv-org/api/gh-pages/<name>.json`).
Sizes are approximate. One sample record each.

| file | rows | size | sample |
|------|------|------|--------|
| channels.json | 31,570 | 7.9 MB | `{"id":"002RadioTV.do","name":"002 Radio TV","alt_names":[],"network":null,"owners":[],"country":"DO","categories":["general"],"is_nsfw":false,"launched":null,"closed":null,"replaced_by":null,"website":"https://www.002radio.com/"}` |
| feeds.json | 45,168 | 8.1 MB | `{"channel":"002RadioTV.do","id":"SD","name":"SD","alt_names":[],"is_main":true,"broadcast_area":["c/DO"],"timezones":["America/Santo_Domingo"],"languages":["spa"],"format":"480i"}` |
| streams.json | 18,022 | 3.7 MB | `{"channel":null,"feed":null,"title":"TV Publica","url":"http://.../playlist.m3u8","quality":"1080p","labels":[],"user_agent":null,"referrer":null}` — `channel` can be null (orphan stream; ignored in v1). `quality` is like `480p`, `720p`, `1080p`, `2160p`, `576i`, or null. `labels` e.g. `["Geo-blocked"]`, `["Not 24/7"]`. |
| categories.json | 30 | 3 KB | `{"id":"auto","name":"Auto","description":"Programming related to cars..."}` |
| countries.json | 250 | 19 KB | `{"name":"Afghanistan","code":"AF","languages":["pus","prd","tuk"],"flag":"🇦🇫"}` |
| languages.json | 7,893 | 269 KB | `{"code":"aaa","name":"Ghotuo"}` |
| guides.json | 180,681 | 25.6 MB | `{"channel":"Channel9.il","feed":"SD","site":"9tv.co.il","site_id":"#","site_name":"9 канал","lang":"ru","sources":[]}` |
| logos.json | 35,281 | 5.7 MB | `{"channel":"002RadioTV.do","feed":null,"in_use":true,"tags":[],"width":334,"height":210,"format":"PNG","url":"https://i.imgur.com/7oNe8xj.png"}` |
| blocklist.json | 935 | 97 KB | `{"channel":"21Sextury.us","reason":"nsfw","ref":"https://github.com/iptv-org/iptv/issues/15723"}` — reasons: `nsfw`, `dmca`. |

Quality rank mapping (used in `channels.quality_rank` / `streams.quality_rank`):
`null`/unparseable → 0; height < 720 → 1 (`sd`); 720 → 2; 1080 → 3; ≥ 2160 → 4. Parse the leading integer of `quality` (`1080p` → 1080, `576i` → 576).

Stream ordering within a channel: `https://` before `http://`, then `quality_rank` desc, then original file order.

## iptv-org/epg

Repo: `https://github.com/iptv-org/epg`. Usage: `npm install` then
`npm run grab -- --channels=channels.xml --days=2 --maxConnections=10 --output=guide.xml`.
`channels.xml` format:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<channels>
  <channel site="bbc.co.uk" lang="en" xmltv_id="BBCNews.uk" site_id="bbc_news24">BBC News</channel>
</channels>
```
Output is standard XMLTV: `<programme start="20261015120000 +0000" stop="..." channel="BBCNews.uk">` with `<title>`, `<desc>`, `<category>`, `<icon src="">`. Some versions emit `channel="ID@FEED"`; strip from `@`.
Sites live under `sites/<site>/` in that repo; `--site=<name>` grabs one site using its bundled channel list instead of `--channels`.
