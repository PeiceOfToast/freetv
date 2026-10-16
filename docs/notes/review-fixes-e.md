# Review fixes E: items 3.2, 3.3, 3.4, 4.4

Source: docs/notes/review-2026-10-16-full.md. Scope: apps/api only. Nothing committed.

## What changed

**3.2 Logo cache** (`apps/api/src/lib/logo-cache.ts`)
- Global counting semaphore around `produce()`. Size `LOGO_CONCURRENCY` (default 6), read at call time.
  FIFO. A request waiting more than `logoOptions.slotWaitMs` (10 s) throws `LogoBusyError`
  (`statusCode` 503, `retryAfter` 5).
- `limitInputPixels` 50 MP -> 4 MP. `sharp.concurrency(2)` once at module init.
- Single-flight per (channel, size, format) unchanged.

**3.3a Playlist memo** (`apps/api/src/routes/export.ts`)
- `/api/playlist.m3u` bodies memoised 60 s. Key: base URL plus the query's parameters sorted by name and value.
- LRU, 50 entries. An entry is dropped when `meta.last_ingest` no longer matches the value it was rendered under.
- Added beyond the spec: a 64 MB byte cap on the memo. A `proxy=true` playlist is about 6 MB, so 50 of them
  would be about 300 MB. The cap is approximate (string length, not bytes).
- `export-m3u.ts` and `export-query.ts` are not touched.

**3.3b guide.xml.gz** (`apps/api/src/epg/importer.ts`, `apps/api/src/routes/export.ts`, `apps/api/src/lib/export-guide.ts`)
- After a successful import the importer streams `EPG_FILE + ".gz"` (streaming gzip, temp file, atomic rename).
  Best-effort: a failure is logged as a warning and the route gzips on the fly.
- The gz copy's mtime is set to the source's mtime as captured at the start of the import. If the source changed
  during the read, the copy is older and is not served.
- `/api/guide.xml` serves the copy (its own ETag and Last-Modified, Content-Length set) when the client accepts gzip
  and `gzipIsCurrent(gz, src)` holds. Otherwise it falls back to on-the-fly gzip, as before.
- `gzipIsCurrent` uses round() on the copy and floor() on the source, because `utimes` goes through a float of
  seconds and can land a fraction of a millisecond low. Without this the copy was never served.

**3.4 SSRF guard** (`apps/api/src/lib/ssrf.ts`, new; ported from `apps/proxy/src/ssrf.ts`)
- Same address and hostname rules, same guarded DNS lookup.
- `guardedFetch(url)` runs one hop: `assertPublicTarget`, then undici `fetch` with `redirect: "manual"`
  through `Agent({ connect: { lookup: guardedLookup } })`. Callers loop over redirects, so every Location is
  re-checked.
- Used by the prober (`prober/probe.ts`) and the logo download (`lib/logo-cache.ts`, which now follows
  redirects by hand, max 5 hops).
- `FETCH_ALLOW_PRIVATE` (default false) disables the guard. Added to `config.ts` with `LOGO_CONCURRENCY`.
- The two `config.ts` additions are the only changes to that file.
- Literal IP hosts never reach the connector lookup. The pre-check in `assertPublicTarget` covers them on every hop.

**4.4 Importer staging table** (`apps/api/src/epg/importer.ts`)
- `programmes_new` is dropped after the swap, and also on the failure path. The next import recreates it
  (`CREATE TABLE IF NOT EXISTS`, already in place).
- `PRAGMA incremental_vacuum` runs only when `auto_vacuum` is INCREMENTAL (2). The default is NONE (0), so
  nothing runs by default.

## Docs
- `docs/ARCHITECTURE.md`: two env rows added after `LOGO_MAX_SIZE` (`LOGO_CONCURRENCY`, `FETCH_ALLOW_PRIVATE`).

## Tests
- New `apps/api/test/ssrf.test.ts`: address and hostname rules, mapped IPv6, guarded lookup at connect time,
  guarded fetch refusal.
- `logo.test.ts`: sets `fetchAllowPrivate = true` for its 127.0.0.1 upstream. Adds: guard refuses a private target
  with the flag off (no connection made), redirect chain followed, redirect loop capped at 5 hops, LogoBusyError
  on a full queue, concurrency never above the limit.
- `prober-probe.test.ts`: sets the flag for its fixture server. Adds: loopback and 169.254.169.254 refused with the
  flag off, and no request reaches the fixture server.
- `export-guide.test.ts`: serves a current `.gz` with its own validators, falls back when the `.gz` is older,
  identity clients get the source. Adds `gzipIsCurrent` unit test.
- `export-playlist.test.ts`: new describe for the memo (hit within TTL, invalidation on `last_ingest`,
  parameter-order normalisation, bound past 50 entries).
- `epg-import.test.ts`: the staging table is gone after import, `guide.xml.gz` exists, is current and has no temp
  files left behind.

Results (api, `npm run typecheck` clean):
- All suites I touched pass: logo, prober-probe, ssrf, export-guide, export-playlist, epg-import, epg-bulk.
- `npm test` with `FETCH_ALLOW_PRIVATE=true`: 236 of 238 pass, 1 TODO. The failure is "catalog routes" (open item 4).
  Without the env var, `prober-run` also fails (open item 1). Neither is in my files.

## Open items for the integrator (outside my edit list)

1. **`apps/api/test/prober-run.test.ts`** (not in my list): it uses the 127.0.0.1 fixture server and now fails with
   the guard on (7 subtests). Fix: set `config.fetchAllowPrivate = true;` in its config block, next to the other
   `config.*` assignments. Verified: with `FETCH_ALLOW_PRIVATE=true` the file passes 15/15.
2. **`apps/api/src/routes/logo.ts`** (not in my list): `getLogo` now throws `LogoBusyError` (503, `retryAfter` 5).
   Without a catch, Fastify answers 503 but without the `Retry-After` header. Add around the `getLogo` call:
   ```ts
   } catch (err) {
     if (err instanceof LogoBusyError) return reply.code(503).header("Retry-After", String(err.retryAfter)).send({ error: err.message });
     throw err;
   }
   ```
   (the `getLogo` call needs wrapping in a `try`; `LogoBusyError` is exported from `lib/logo-cache.ts`).
3. **Expiry wiring (other agent)**: `export-m3u.ts` now calls `proxyPathFor(s, exp)`. The closure in
   `routes/export.ts` (`(s) => proxyUrlFor(s.url, s.userAgent, s.referrer)`) drops `exp`, and `views.ts` does not
   take it yet. The test "M3U relay URLs expire after PROXY_EXPORT_TTL_SECONDS" is a TODO for this. I left the
   closure alone because the expiry work is theirs.
4. **`routes/catalog` / "catalog routes" test**: it fails on the relay URL now carrying `exp`. It was already failing
   before my changes, and the cause is the expiry work above.
5. **One-time VACUUM** (for OPERATIONS, another track's file). The freed pages from the old `programmes_new` DELETEs
   stay in the file until VACUUM runs. Suggested one-liner, UNVERIFIED (check that the `api` image resolves
   `better-sqlite3` from `/app`, and stop the api first if you want no WAL contention):
   ```sh
   docker compose exec api sh -c 'cd /app/apps/api && node --input-type=module -e "import D from \"better-sqlite3\"; const d = new D(\"/data/catalog.db\"); d.exec(\"VACUUM\"); d.close()"'
   ```
   The `WORKDIR` in `apps/api/Dockerfile` is `/app`; adjust the `cd` to wherever the installed `node_modules` lives.
6. **Write access**: the importer now writes `/data/epg/guide.xml.gz`. The api container already has the `data` volume
   (`docker-compose.yml`), so this should be fine. Confirm the api user can write to `/data/epg`.

## Behaviour notes and trade-offs
- The semaphore wraps the whole `produce()`, including the upstream download, as specified. A slow upstream (up to
  the 10 s fetch timeout) can hold a slot, so a burst of cold logos can turn into 503s. Moving the slot to the
  decode/encode step only would avoid this, at the cost of more concurrent downloads.
- `limitInputPixels` 4 MP refuses logos above about 2000x2000 (treated as a miss, no logo). Logos are normally far smaller.
- Logos refused by the guard are negative-cached for 6 h, like other upstream failures.
- The redirect re-check is structural: every hop goes through `guardedFetch`. An end-to-end test of a public host
  redirecting to a private one needs network access, so it is not in the suite. The refusal itself is unit-tested.
- Gzip copy generation costs CPU on every EPG change (about 10 s per core for a 300 MB guide, per the review).
  It happens once per import, not per request.
