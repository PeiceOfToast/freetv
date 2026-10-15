# Track D (web/browse) notes

## Built
- `pages/browse/BrowsePage.tsx`: default-exported page. Owns URL state, fetch orchestration, and the empty, error and loading states.
- `components/browse/`: `state.ts` (URL to state and back, query builder), `useChannels.ts` (abortable fetch), `useRefData.ts` (module-cached categories, countries and languages), `useView.ts` (grid/list in `localStorage` `freetv:view`), plus `SearchBar`, `Toolbar`, `FilterPanel`, `FilterDrawer`, `ActiveFilters`, `ChannelCard`, `ChannelGrid`, `ChannelLogo`, `Pagination`.
- `components/ui/`: `Button`, `Chip` (toggle chip and `RemovableChip`), `Spinner`, `Skeleton`, `EmptyState`.
- Sidebar collapse state is in `localStorage` `freetv:browse-sidebar` (`open` or `closed`).

## URL params (source of truth)
`q`, `category`, `country`, `language` (comma lists), `quality` (sd, 720p, 1080p, 2160p), `hasStream` (`0` when off; on by default), `online=1`, `nsfw=1`, `favorites=1`, `sort`, `order`, `page`. Defaults are omitted from the URL. Search commits use replace; other changes push history.

## Verification status
- `npm run build` passes (strict tsc plus vite).
- Not checked against a live API, because the API was not running. The mock-API smoke test could not run either: the Chrome extension was not connected.

## Needs from integrator / API
- `favorites=1` sends every starred id in the query string. Fine for dozens of ids. For hundreds the URL gets long, so consider POST or a larger limit.
- `sort=updated` is exposed as "Recently updated". Drop it from `SORT_OPTIONS` in `state.ts` if the API does not support it.
- The "Only online" toggle and the per-card status dot depend on health data. A null `online` shows no dot. The API ignores `online` without health data, as documented.
- Layout: the sticky search bar uses `top-14`, matching the Layout header `h-14`. Update `BrowsePage.tsx` if the header height changes.
- Layout `main` must not clip overflow, because the sticky search bar and sidebar depend on it.
