# API logos (track L)

Status: implemented. `GET /logo/:id` serves cached, resized channel logos. Tests: `apps/api/test/logo.test.ts`
(18 cases; `npm test` 152/152, `npm run typecheck` clean).

Files:
- `apps/api/src/lib/logo-cache.ts` (new): cache, fetch, resize, eviction, `publicLogoUrl`, `normalizeLogoSize`, `logoCacheStats`, `closeLogoCache`.
- `apps/api/src/routes/logo.ts`: the route. Export name `logoRoutes` unchanged.
- `apps/api/package.json` + `package-lock.json`: `sharp` pinned to `0.35.5` (published 2026-09-27, so at least two weeks old).

## Behaviour

`GET /logo/:id?s=<px>`
- `s` is snapped to a cached size: the smallest of 64/128/256/512 that is >= `s`, capped at `LOGO_MAX_SIZE` (default 256 when absent; non-integer gives 400).
- Raster sources (PNG, JPEG, GIF, WebP, ...) are resized with `fit: inside, withoutEnlargement`. Output is WebP when `Accept` includes `image/webp`, else PNG. Alpha is kept.
- SVG sources are stored as-is and served as `image/svg+xml` with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`.
- Headers: `ETag` (strong, from size and mtime of the cached file), `Cache-Control: public, max-age=604800, stale-while-revalidate=86400`, `Vary: Accept`. `If-None-Match` gives 304.
- 404 `{"error":"no logo"}` when the channel has no `logo_url`, the upstream failed (negative-cached), or the channel is blocked. 404 `{"error":"logo cache disabled"}` when `LOGO_CACHE_ENABLED=false`.
- Headers are set in the route, not through `installHttpBehaviour`, because that hook overwrites `Cache-Control`.

`getLogo(channelId, size, { webp })` is the library entry point. It takes an optional third argument, which the brief did not list, because the format depends on `Accept`.

### Cache layout

`${LOGO_CACHE_DIR}/<shard>/<id>-<size>.<webp|png|svg>`
- `<shard>` is the first two hex chars of sha1 of the encoded id. Ids are `encodeURIComponent`-ed for the file name, so no id can escape the directory.
- `<shard>/<id>.miss` is the negative marker, `{"t": <ms>, "src": <url hash>}`.
- `index.json` (root of the cache dir) holds size, last access time and source URL hash per file. It is rewritten every 60 s when dirty. On startup the directory is scanned and `index.json` is merged in, so access times survive restarts. Stale `*.tmp` files are removed.

### Lifecycle

1. Each request resolves the channel's `logo_url` from `channels` (`blocked = 0`).
2. Requests for the same (channel, size, format) share one in-flight promise. The cache check runs inside it, so a burst costs one fetch and one encode.
3. Cache hit: the file's source hash must match the current `logo_url` hash. A changed URL regenerates the variant.
4. Miss: a fresh `.miss` (matching hash, under 6 h old) returns 404 at once.
5. Otherwise the upstream is fetched once per channel and shared across sizes and formats (also single-flight). Limits: 10 s total, 5 MB (checked on `Content-Length` and while reading), http/https only, undici `fetch`, UA `FreeTV-logo-cache/1.0 (+https://github.com/iptv-org/iptv)`.
6. Failures write `.miss`. These cover non-2xx, timeouts, oversize, non-image bodies and unsafe SVG.
7. Files are written atomically (tmp + rename).
8. Eviction: after each write, if total bytes exceed `LOGO_CACHE_MAX_MB`, the least recently accessed files are deleted down to 90%. The file just written is never evicted, so a response is always backed by a file.

### SVG rules

Rejected (treated as a miss) if the text contains `<script`, an attribute-style `on*=` (requires preceding whitespace, quote or slash), `javascript:`, `<!DOCTYPE` / `<!ENTITY`, or `<foreignObject`. The brief asked for `<script` and `on[a-z]+=`. The extra patterns are cheap and close off XXE and entity expansion.

## Integrator wiring (not done here: these files belong to other tracks)

1. `routes/catalog.ts`, list and detail:
   - `logo: r.logo_url` becomes `logo: publicLogoUrl(r.id, r.logo_url)`
   - `logo: ch.logo_url` becomes `logo: publicLogoUrl(ch.id, ch.logo_url)`
   - Import from `../lib/logo-cache.js`.
2. `routes/export.ts` / `lib/export-m3u.ts`: keep the upstream absolute URL in `tvg-logo`. Do not use `publicLogoUrl` here. TV apps (Kodi, TiviMate, Plex, VLC) fetch logos themselves, and a relative `/logo/...` would only work if PUBLIC_URL were set. The existing `logo: r.logo_url` in `export-query.ts` is correct as is.
3. **Caddy, required.** `infra/caddy/Caddyfile` only routes `/api/*` to `api:3000`. A `/logo/*` request currently falls through to the default web handler and gets the SPA shell. Add:
   ```
   handle /logo/* {
       reverse_proxy api:3000
   }
   ```
   with no prefix stripping, as for `/api/*`. Owner: track H (infra).
4. `routes/admin.ts`, `GET /api/admin/status`: `logos: logoCacheStats()` gives `{ cached, bytes }`, matching the documented shape.
5. `server.ts`: optional `closeLogoCache()` on shutdown. The index is flushed at most 60 s late without it, which only affects access times.
6. `docs/API.md` line 96: the Cache-Control text reads "max-age=604800, immutable-ish". The real header is `public, max-age=604800, stale-while-revalidate=86400`. Propose the wording change there; the contract file is frozen during the sprint.
7. Clients: the web app is same-origin, so `<img src="/logo/…">` works once Caddy routes it. Native and mobile clients that receive the relative `logo` must prefix the API base URL.

## Dockerfile

- `node:22-bookworm-slim` is fine. sharp 0.35.5 ships prebuilt libvips in `@img/sharp-libvips-linux-x64` (arm64 has its own package) and needs glibc, which bookworm provides. Node `>=20.9` is required and Node 22 is used.
- No apt packages are needed. Nothing changes in the Dockerfile.
- The build stage runs `npm ci` and picks the platform package for its architecture. `npm prune --omit=dev` keeps sharp, since it is a runtime dependency.
- Image growth: about 28 MB in `node_modules/@img` (18 MB of that is libvips on x64).
- The cache lives under `DATA_DIR` (`/data/logos` by default), which is the `/data` volume.
- Optional: on small hosts, `sharp.concurrency(1)` at startup limits libvips threads during bulk fetches.

## Config (unchanged; `docs/ARCHITECTURE.md` lines 36-39)

`LOGO_CACHE_ENABLED` (true), `LOGO_CACHE_DIR` (`$DATA_DIR/logos`), `LOGO_CACHE_MAX_MB` (500), `LOGO_MAX_SIZE` (512). Fetch timeout, size cap and negative TTL are constants in `logoOptions` (not in config.ts, which is integrator-owned).

## Known limits and follow-ups

- Each (size, format) variant re-downloads the upstream once. The source is not stored. Storing it would save bandwidth for the 4 sizes at the cost of disk.
- A changed upstream image behind an unchanged URL is not detected. Only URL changes are.
- `.miss` markers (about 100 bytes each) are not counted toward the budget.
- Animated images are reduced to their first frame.
- Eviction can delete a file that another response is about to open. On Linux an open file keeps working. A request that opens after deletion gets a broken stream, so the next request regenerates it. This is rare because eviction is LRU.
- ETags come from size and mtime. A regenerated file always gets a new ETag, which is the intent.
