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
| `PROXY_MAX_CONCURRENT` | `200` | In-flight requests. Above this, `503`. |
| `PROXY_ALLOW_PRIVATE` | `false` | **Dev only.** Lets targets on loopback and private ranges through (tests use it). Never set in production. |
| `LOG_LEVEL` | info | `silent` disables the per-request log line. |

## Security

Only `http(s)` targets are fetched. Literal IPs and resolved hostnames in loopback, private, link-local,
CGNAT, multicast, unique-local, NAT64 and IPv4-mapped ranges are refused with `403`. This is checked on
every redirect hop, and again at connect time to close the DNS-rebinding gap. See `docs/notes/proxy.md`.
