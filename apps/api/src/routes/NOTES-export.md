# Track J (exports) notes

Implemented: `GET /api/playlist.m3u` and `GET /api/guide.xml`, per docs/API.md "Exports".
Code: `src/routes/export.ts`, `src/lib/export-query.ts` (reuses `planChannels`, adds the un-paged read),
`src/lib/export-m3u.ts` (rendering), `src/lib/export-guide.ts` (ETag, gzip and 304 helpers).
Tests: `test/export-playlist.test.ts`, `test/export-guide.test.ts`. `channel-query.ts` and `catalog.ts` are untouched.

## Decisions where the contract is silent

1. **Attributes with no value are omitted** (`tvg-logo`, `tvg-country`, `tvg-language`). Empty values are never written.
   `tvg-id`, `tvg-name` and `group-title` are always present (`group-title` falls back to `Other`).
2. **`group-title` is the channel's first category** in its own order. A `category=` filter does not force that category
   into `group-title`, so a filtered channel can show another group.
3. **`streams=all` emits one `#EXTINF` per stream**, with the same metadata. That keeps the file valid M3U.
4. **`EXTVLCOPT` lines are written in both proxy modes** whenever the stream has a value. With `proxy=true` the same
   values are also signed into the relay URL, so the extra lines are redundant but harmless.
5. **`proxy=true` with the proxy unavailable** (`PROXY_ENABLED` off or no secret) falls back to origin URLs.
6. **Relay URLs** are `base + /proxy/<sig>/<payload>`. The API does not serve `/proxy`; the proxy service must be routed at
   that path on the same origin (the same assumption `/api/stream/.../play` already makes with its relative `proxyUrl`).
7. **Cap:** above 20,000 channels the list is cut and a comment line `# list capped at 20000 channels; ...` is appended.
   `page` and `limit` are ignored (not 400). `hasStream` is ignored (always forced true).
8. **`PUBLIC_URL`** is also trimmed of trailing slashes at request time, because tests and the integrator can set it
   directly. Without it the base is `x-forwarded-proto` / `x-forwarded-host` (first value of a comma list), then
   `req.protocol` / `Host`.
9. **Guide ETag is weak** (`W/"<mtimeMs>-<size>"`). The gzip variant is a different representation, so a weak tag is correct.
   If-None-Match takes precedence over If-Modified-Since. Gzip responses have no Content-Length and send `Vary: Accept-Encoding`.
10. **Error handler is plugin-scoped**, not `installHttpBehaviour`. That hook sets `Cache-Control: max-age=60` on every GET,
    which would overwrite the export cache headers.

## Measured on the real catalog (DATA_DIR=apps/api/.data)

- Unfiltered `/api/playlist.m3u`: 10,277 channels (default NSFW hidden), 21,319 lines, 2.7 MB, 0.29 to 0.42 s per request.
  The brief estimated 31k lines and 5 MB. That figure assumed every channel; only 10,277 have a stream and pass the default filters.
- `category=news&country=US`: correct, with the expected `tvg-*` and `EXTVLCOPT` output.
- `/api/guide.xml`: 200, 5.1 MB identity, gzip when accepted, 304 on If-None-Match.
- The startup ingest on this sandbox failed with a network error and did not rebuild the catalog.
