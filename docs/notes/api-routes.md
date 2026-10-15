# Track B (api/routes) notes

Implemented: `/api/meta`, `/api/categories|countries|languages`, `/api/channels`, `/api/channels/:id`,
`/api/stream/:id/:index/play`. Helpers live in `src/lib/` (`http.ts`, `sql.ts`, `channel-query.ts`, `views.ts`).
Tests: `test/routes-catalog.test.ts`, `test/routes-stream.test.ts`.

## Contract concerns (for the integrator, docs/API.md is not edited)

1. **`q` does not match channel ids.** The schema declares `channels_fts.id` as UNINDEXED, but API.md says
   search covers the id. `q=BBCNews` does not find "BBC News"; `q=BBC News` does. Options: make `id` searchable
   in schema.sql (frozen), or add a `c.id LIKE 'q%'` branch in `planChannels`. Not done.
2. **`sort=updated` has no data source.** `channels` has no timestamp. Implemented as
   `MAX(streams.last_checked)` per channel (correlated subquery). It is NULL for everything until a health
   prober writes `last_checked`. Worst case (all channels, hasStream=false) is about 39 ms on 31k rows. A
   denormalised `channels.last_checked` would be cheaper.
3. **`online` semantics, per channel:** `online_count > 0` gives `true`; a channel with any probed stream but no
   online one gives `false`; never probed gives `null`. The `online=true` filter is skipped entirely when no
   stream has a non-null status anywhere (checked per request, only when `online=true` is asked for).
4. **Paging on reference lists.** The contract says all list endpoints take `limit`/`page`, but the reference
   examples are plain arrays. `/api/categories`, `/api/countries` and `/api/languages` return unpaged arrays
   (the languages list with channels is a few hundred entries).
5. **Empty parameters.** `category=`, `country=`, `language=` (empty) mean no filter. `favorites=` (present but
   empty) matches nothing, so the UI can show "no favourites" without a special case. Omit the param to not filter.
6. **`limit` above 200** is clamped to 200 and the response reports `"limit": 200`. It is not a 400.
7. **`q` with no searchable characters** (for example `-`) is treated as no search and returns the unfiltered list.
8. **`proxyEnabled` in `/api/meta`** is the effective value: `PROXY_ENABLED && PROXY_SECRET !== ""`. Proxy URLs
   are never issued without a secret, so reporting `true` would be misleading.
9. **Blocklisted and NSFW channels are reachable by id.** `nsfw`/`HIDE_NSFW_DEFAULT` only hides them in
   `/api/channels`. `/api/channels/:id` and `/api/stream/:id/:index/play` serve blocklisted channels (for example
   DMCA-listed ones) as well. The contract only says 404 for unknown ids. Decide whether detail and play should
   also be gated on `nsfw` or on `blocked`.
10. **`next` shape.** Follows the contract: `{title, start, stop}`. `now` also carries `description`, `category`
    and `icon` (null when absent).
11. **Relevance with `order=desc`** reverses the bm25 order. It is allowed, not special-cased.

## Behaviour notes

- `now` means `start_ts <= now < stop_ts`. With overlapping rows, the latest-starting one wins.
- `/api/channels/:id` returns `now: null` and `next: null` when there is no EPG data.
- The stream play endpoint 404s for both an unknown channel and an index past the last stream.
- `Cache-Control: public, max-age=60` is set on successful GETs only. Errors are never cached.
- Errors are `{ "error": "..." }`: 400 for bad parameters, 404 for unknown ids, 500 otherwise.
- Prepared statements are cached per DB handle (WeakMap) and per SQL text, capped at 256 entries.
- `/api/meta` `programmes` is a live `COUNT(*)`. Measured at 13 ms with 1.2M rows, so no cache is needed.
- List timings on the real catalog (31,570 channels): 7 to 30 ms typical, 39 ms worst case (sort=updated).
