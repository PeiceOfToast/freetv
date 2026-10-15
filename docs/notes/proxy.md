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

## Rate limiting, concurrency and metrics

- **Token bucket per client IP.** Each key starts full at `PROXY_RATE_LIMIT_BURST`, refills at
  `PROXY_RATE_LIMIT_RPS` and spends one token per request. `Retry-After` is the time until one token
  is available, rounded up, at least 1 s. The clock is injectable so the unit tests are deterministic.
- **Bounded memory.** The bucket map holds at most 50k keys. A new key over the cap evicts the least
  recently used one. A sweep every 60 s drops buckets that have refilled to full. A full bucket is the
  same as no bucket, so the sweep never changes a decision. The timer is `unref`'d and cleared on close.
- **Order of checks.** Rate limit comes after the signature check. Only URLs the api signed can use
  tokens, so random traffic cannot starve a real viewer. Target and SSRF checks come after the limit.
- **Concurrency.** A per-IP cap (`PROXY_MAX_CONCURRENT_PER_IP`, default 16) gives `429`. The global
  cap gives `503`. The per-IP check runs first, so one client hitting its own cap does not look like
  global overload. Both slots are released once, on the response `close`.
- **Client IP.** `PROXY_TRUST_PROXY=true` takes the **last** `X-Forwarded-For` entry if it parses as an
  IP, and falls back to the socket address otherwise. IPv4-mapped IPv6 is normalised, both dotted and
  hex. Caddy's `reverse_proxy` appends the peer address it saw to any header the client sent, so the
  last entry is the trustworthy one and a client rotating its own `X-Forwarded-For` still lands in one
  bucket. (The track originally used the first entry; the integrator switched it to the last entry for
  exactly this reason. If another trusted hop is ever placed in front of Caddy, revisit this.)
- **Logs.** The address is salted and hashed, with a per-process salt, and cut to 12 hex characters.
  The upstream target host is still logged, as before. `kind` is a guess from the signed URL's path
  until the upstream content type is known, then the real value.
- **Metrics.** Hand-rolled, about 150 lines in `src/metrics.ts`, Prometheus text format 0.0.4. Counters
  and gauges are label-set maps. The histogram is cumulative on render. `requests_total` is recorded
  once per request, on `finish` or `close`, whichever comes first. `bytes_total{client}` is bytes sent
  to the client, and `{upstream}` is bytes received, including bytes that were cut off by the cap.
  `active_requests` counts requests holding an upstream slot, so it matches the global cap.
  `rate_limited_total` covers only the token bucket. Per-IP concurrency `429`s appear only under
  `requests_total{status="429"}`.
- **Not done.** No labels on `requests_total` for client IP, which would be unbounded and would leak
  addresses. No auth on `/metrics`; it is internal only.

