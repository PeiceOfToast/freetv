# proxy: implementation notes

## Decisions and deviations from the brief

- **Non-2xx upstream responses become `502`.** Only 2xx is streamed or rewritten. The UI treats any error
  as "skip this stream", so the exact upstream status adds nothing and is kept out of the body.
- **Playlist cap is 2 MB and returns `413`.** Playlists larger than that are refused, not truncated.
- **Rewritten URLs always use `PROXY_PUBLIC_PATH`.** That is the path the browser requests, even when
  Caddy strips the prefix before the request reaches this service.
- **Non-http(s) URIs are left untouched** in playlists (`data:`, `skd:`). The proxy cannot fetch them.
- **Playlist detection** follows the brief: `mpegurl` in content-type, or a `.m3u8`/`.m3u` path. The
  rewritten tags are `EXT-X-KEY`, `EXT-X-MAP`, `EXT-X-MEDIA`, `EXT-X-I-FRAME-STREAM-INF`, plus
  `EXT-X-SESSION-KEY` and `EXT-X-PRELOAD-HINT`, which carry the same `URI=` pattern.
- **Upstream headers are an allow-list.** Only `Content-Type`, `Content-Length`, `Content-Range`,
  `Accept-Ranges` pass through. CORS and `Set-Cookie` are dropped. `Accept-Encoding: identity` is sent so
  bytes are never re-encoded.
- **`Origin` is derived from `r`** (the referer). `Referer` is sent as given.

## SSRF hardening

- Scheme must be `http:` or `https:`.
- Hostnames `localhost`, `*.localhost`, `*.local`, `*.internal` and `metadata.google.internal` are refused by name.
- Literal IPs are checked against `net.BlockList`. IPv4-mapped IPv6 (`::ffff:a.b.c.d` and the hex form) is
  unwrapped and checked as IPv4. Unwrappable mapped forms are refused.
- Hostnames are resolved and every returned address is checked before the request.
- The undici connector uses a `lookup` that re-checks the address actually connected to. This closes the
  gap where a DNS answer changes between the pre-check and the connection (rebinding).
- Redirects are followed manually, up to 5 hops. Each hop goes through the full check again.
- Not covered: a DNS answer that is public at check time and private at connect time is caught by the
  connector check. Anything else is out of scope for this service.

## Timeouts and limits

- undici `Agent`: `headersTimeout` 15 s, `bodyTimeout` 60 s (inactivity between chunks, not total duration).
- `PROXY_MAX_BYTES` is enforced on the `Content-Length` header up front (`413`), and while streaming by
  destroying the socket. Clients see a truncated body. There is no status code left to send once the
  headers are out.
- In-flight count covers the whole response lifetime, including streaming. A client disconnect aborts the
  upstream request through an `AbortController`.

## Open items for the integrator

- `api` must use the same `PROXY_SECRET` and `PROXY_PUBLIC_PATH` as this service.
- Caddy does not need to strip `/proxy`. Both forms are accepted, and rewritten URLs keep the prefix.
- `docker build` depends on the local Docker daemon being reachable.
