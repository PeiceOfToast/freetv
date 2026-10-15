# proxy

HLS relay for FreeTV. Accepts only HMAC-signed URLs issued by `apps/api`, rewrites HLS playlists so every
segment, key and init section also goes through the relay, and streams other responses through.
Contract: `docs/API.md` ("Proxy contract"); env vars: `docs/ARCHITECTURE.md`.

## Run

```sh
PROXY_SECRET=$(openssl rand -hex 32) npm run dev     # tsx watch
npm run build && PROXY_SECRET=... npm start          # dist/main.js
npm test                                             # node --test
npm run typecheck
docker build -t freetv-proxy apps/proxy
```

## Routes

- `GET /healthz` returns `200 ok`.
- `GET /metrics` returns Prometheus text. No auth. Caddy does not route it, so it is reachable only inside
  the compose network. Do not add a Caddy route for it.
- `GET ${PROXY_PUBLIC_PATH}/:sig/:payload` (default `/proxy/:sig/:payload`).
- `GET /:sig/:payload` is also accepted, so a reverse proxy may strip the prefix. Rewritten playlists always
  use `PROXY_PUBLIC_PATH`, because that is the path the browser sees.
- `OPTIONS` returns `204` for CORS preflight on any path.

## Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `PROXY_SECRET` | required | HMAC key shared with `api`. |
| `PORT` | `3001` | Listen port. |
| `PROXY_PUBLIC_PATH` | `/proxy` | Public prefix used in rewritten URLs. |
| `PROXY_MAX_BYTES` | `52428800` (50 MB) | Per-response cap. Over-size responses get `413` or are cut mid-stream. |
| `PROXY_MAX_CONCURRENT` | `200` | In-flight requests across all clients. Above this, `503`. |
| `PROXY_MAX_CONCURRENT_PER_IP` | `16` | In-flight requests per client IP. Above this, `429`. `0` disables. |
| `PROXY_RATE_LIMIT_RPS` | `20` | Sustained requests per second per client IP (token refill rate). Playlists and segments count alike. `0` disables. |
| `PROXY_RATE_LIMIT_BURST` | `60` | Bucket size: requests allowed at once per client IP. Must be at least 1. |
| `PROXY_TRUST_PROXY` | `true` | `true` takes the client IP from the last `X-Forwarded-For` entry (the one Caddy appends, so clients cannot pick their own bucket). `false` uses the socket address. Set `false` when the proxy is not behind Caddy. |
| `PROXY_ALLOW_PRIVATE` | `false` | **Dev only.** Lets targets on loopback and private ranges through (tests use it). Never set in production. |
| `LOG_LEVEL` | info | `silent` disables the per-request log line. |

## Limits

Checks run in this order, and the first failure answers:

1. Signature and payload checks (`403`/`400`). Unsigned requests never use rate-limit tokens.
2. Rate limit per client IP (`429`, `{"error":"rate limited"}`, `Retry-After` in seconds).
3. Target checks (`403`).
4. Per-IP concurrency (`429`, `Retry-After: 2`).
5. Global concurrency (`503`, `Retry-After: 2`).

Every response carries the CORS headers, so the browser can read the error. `/healthz`, `/metrics` and
`OPTIONS` do not use tokens. Client IPs are never logged raw. Each access line has `ip=<12 hex>`, a hash
with a per-process salt, and `kind=playlist|segment|other`.

## Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `freetv_proxy_requests_total` | counter | `kind`, `status` |
| `freetv_proxy_bytes_total` | counter | `direction=upstream\|client` |
| `freetv_proxy_active_requests` | gauge | requests holding an upstream slot |
| `freetv_proxy_rate_limited_total` | counter | per-IP rate limit `429`s |
| `freetv_proxy_upstream_errors_total` | counter | `reason=forbidden\|unreachable\|bad_status\|too_large\|read` |
| `freetv_proxy_request_duration_seconds` | histogram | buckets 0.05 to 30 s |

## Security

Only `http(s)` targets are fetched. Literal IPs and resolved hostnames in loopback, private, link-local,
CGNAT, multicast, unique-local, NAT64 and IPv4-mapped ranges are refused with `403`. This is checked on
every redirect hop, and again at connect time to close the DNS-rebinding gap. See `docs/notes/proxy.md`.

The rate limit depends on `X-Forwarded-For`. Caddy appends to that header and does not replace it, so with
`PROXY_TRUST_PROXY=true` a client can pick its own rate-limit key. See `docs/notes/proxy.md`.
