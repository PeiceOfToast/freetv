# Track ADMIN notes

## Built
- `apps/api/src/routes/admin.ts`: `GET /api/admin/status` (Bearer `ADMIN_TOKEN`, compared with `timingSafeEqual`; 401 when the token is missing, wrong, or unset; `Cache-Control: no-store`), `GET /metrics` (no auth), and an `onResponse` hook that counts every request on the app. `collectStatus()` is exported and feeds both endpoints.
- `apps/api/src/lib/metrics.ts`: small Prometheus registry (Counter, Gauge, Histogram, `HttpMetrics`), same shape as `apps/proxy/src/metrics.ts`. Route labels are Fastify route templates (`request.routeOptions.url`), `unmatched` for 404s, capped at 100 distinct values.
- `apps/api/test/admin.test.ts`: 8 tests (auth, exact key set, metric families, counter increments).
- `apps/web/src/lib/admin-api.ts`: separate client. The token is kept in `sessionStorage` under `freetv:admin-token`, never in localStorage.
- `apps/web/src/pages/admin/`: `AdminPage.tsx` (default export), `TokenGate.tsx`, `Panels.tsx`, `format.ts`. Status refreshes every 15 s and pauses while the tab is hidden. A 401 clears the token and shows the sign-in form again.

## Integrator to-dos
1. **Web route.** In `apps/web/src/App.tsx` add
   `const AdminPage = lazy(() => import("./pages/admin/AdminPage"));`
   and, inside the `<Route element={<Layout />}>` block, `<Route path="admin" element={<AdminPage />} />`.
2. **Ingest meta (track A).** `catalog.lastIngestMs` and `catalog.source` are not recorded anywhere that the API can read. Ingest should `setMeta("last_ingest_ms", ms)` and record the dataset source (`primary` or `mirror`) in meta. Until then `lastIngestMs` is `null`. `source` is derived from `${rawDir}/etags.json` (the `channels` entry's `source` compared with `config.iptvApiBase` and `config.iptvApiMirror`), so it is correct after a run but reads `null` if the ETag file is missing.
3. **Docs link.** The "Docs" link on the admin page points at `/about` (`DOCS_HREF` in `AdminPage.tsx`). The repo has no public FreeTV docs URL, so change it if one exists.

## Caddy / public exposure
- `/metrics` is not reachable through Caddy. `infra/caddy/Caddyfile` routes only `/api/*`, `/logo/*`, `/proxy/*` and assets to backends. Everything else, including `/metrics`, falls through to `file_server` with the SPA fallback, so a public `GET /metrics` returns `index.html`, not metrics. No Caddyfile change is needed. Prometheus scrapes `api:3000/metrics` on the compose network, which is unchanged.
- `/api/admin/status` is public-routed (through `/api/*`) but requires the token. The POST admin endpoints are unchanged in `server.ts`.

## Implementation notes
- `onResponse` hook: `adminRoutes` sets the `Symbol.for("skip-override")` flag at module level (the same flag `fastify-plugin` sets). Without it the hook is scoped to the plugin and misses `/api/health` and the other routes. The flag must be set before `register()`, so it cannot be set inside the plugin body. The hook is added after the other routes are registered, and it still covers them; the test checks `/api/health` and the unmatched 404 path.
- The `/metrics` gauges and `/api/admin/status` both run `collectStatus()`, which does a few `COUNT(*)` queries (`programmes` can reach 300k rows). This is cheap enough for a 15 s status poll and a 15 s to 1 min scrape, but it is not free.
- `db.bytes` and `walBytes` come from `db.name` (the open database file), which equals `config.dbPath` in production. Tests open a temp file, so they use the real path.
- `health.probed`, `online` and `offline` are counted on `streams.status`, not on `stream_health`, so they match `/api/meta` and the catalog counts.
- `epg.file.mtime` is Unix seconds. A missing file gives `exists: false`, `size: 0`, `mtime: null`.
- `logos` reports zeros when `LOGO_CACHE_ENABLED` is off, without touching the logo directory.

## Verification
- `apps/api`: `npm run typecheck` clean; `npm test` runs with `admin.test.ts` passing (3 runs in a row).
- `apps/web`: `npm run build` passes. The page is not reachable until the route is added.
