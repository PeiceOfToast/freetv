import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useFavorites } from "@/lib/favorites";
import { nowTs } from "@/lib/format";
import type { SortKey } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchBar } from "@/components/browse/SearchBar";
import { Toolbar } from "@/components/browse/Toolbar";
import { FilterPanel } from "@/components/browse/FilterPanel";
import { FilterDrawer } from "@/components/browse/FilterDrawer";
import { ActiveFilters } from "@/components/browse/ActiveFilters";
import { ChannelGrid } from "@/components/browse/ChannelGrid";
import { Pagination } from "@/components/browse/Pagination";
import { useChannels } from "@/components/browse/useChannels";
import { useRefData } from "@/components/browse/useRefData";
import { useViewMode } from "@/components/browse/useView";
import {
  PAGE_SIZE, activeFilterCount, buildParams, effectiveOrder, effectiveSort, hasActiveFilters,
  parseState, toChannelQuery, type BrowseState,
} from "@/components/browse/state";

const SIDEBAR_KEY = "freetv:browse-sidebar";
function readSidebarOpen(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) !== "closed"; } catch { return true; }
}

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseState(params), [params]);
  const favIds = useFavorites();
  const favSet = useMemo(() => new Set(favIds), [favIds]);
  const refs = useRefData();
  const [view, setView] = useViewMode();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [now, setNow] = useState(nowTs);

  // Re-render every 30 s so the "Now" progress bars stay current.
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowTs()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // All state changes go through the URL. Filter changes push history; search replaces it.
  const update = useCallback(
    (patch: Partial<BrowseState>, opts?: { replace?: boolean }) => {
      setParams((prev) => buildParams({ ...parseState(prev), ...patch }), { replace: opts?.replace });
    },
    [setParams],
  );
  const change = useCallback((patch: Partial<BrowseState>) => update({ ...patch, page: 1 }), [update]);
  const onSearch = useCallback((q: string) => update({ q, page: 1 }, { replace: true }), [update]);
  const clearFilters = useCallback(
    () => change({ category: [], country: [], language: [], quality: "", hasStream: true, online: false, nsfw: false, favorites: false }),
    [change],
  );
  const clearAll = useCallback(() => change({ q: "", category: [], country: [], language: [], quality: "", hasStream: true, online: false, nsfw: false, favorites: false }), [change]);
  const goPage = useCallback((p: number) => {
    update({ page: p });
    window.scrollTo({ top: 0 });
  }, [update]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open;
      try { localStorage.setItem(SIDEBAR_KEY, next ? "open" : "closed"); } catch { /* private mode */ }
      return next;
    });
  }, []);

  // "Favorites only" with nothing starred: show the empty state instead of fetching everything.
  const noFavorites = state.favorites && favIds.length === 0;
  const query = useMemo(() => (noFavorites ? null : toChannelQuery(state, favIds)), [state, favIds, noFavorites]);
  const ch = useChannels(query);
  const data = ch.data;
  const total = data?.total ?? null;
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));

  // If the URL points past the last page (e.g. filters narrowed), clamp it.
  useEffect(() => {
    if (data && !ch.loading && state.page > pageCount) update({ page: pageCount }, { replace: true });
  }, [data, ch.loading, state.page, pageCount, update]);

  const items = data?.items ?? [];
  const rangeText = data && data.items.length > 0
    ? `${(data.page - 1) * data.limit + 1}–${(data.page - 1) * data.limit + data.items.length}`
    : null;
  const filterCount = activeFilterCount(state);
  const sort: SortKey = effectiveSort(state);

  let body: ReactNode;
  if (noFavorites) {
    body = (
      <EmptyState
        title="No favorites yet"
        description="Tap the heart on any channel to save it here."
        action={<Button onClick={() => change({ favorites: false })}>Show all channels</Button>}
      />
    );
  } else if (ch.error && !data) {
    body = <EmptyState title="Couldn’t load channels" description={ch.error} action={<Button onClick={ch.retry}>Try again</Button>} />;
  } else if (!data) {
    body = <ChannelGrid items={[]} view={view} isFavorite={() => false} now={now} busy={false} skeleton />;
  } else if (items.length === 0) {
    body = hasActiveFilters(state) ? (
      <EmptyState
        title="No channels match these filters"
        description="Try removing a filter or searching for something broader."
        action={<Button onClick={clearAll}>Clear filters</Button>}
      />
    ) : (
      <EmptyState title="No channels found" description="The channel list is empty right now. Try again later." />
    );
  } else {
    body = <ChannelGrid items={items} view={view} isFavorite={(id) => favSet.has(id)} now={now} busy={ch.loading} skeleton={false} />;
  }

  const filterPanel = (idPrefix: string) => (
    <FilterPanel
      idPrefix={idPrefix}
      state={state}
      refData={refs.data}
      refError={refs.error}
      onRetryRef={refs.retry}
      favoriteCount={favIds.length}
      onChange={change}
      onClearAll={clearFilters}
      activeCount={filterCount}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <h1 className="text-[clamp(1.5rem,1.2rem+1.4vw,2rem)] font-semibold tracking-tight">Browse channels</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Free, publicly available TV from around the world.</p>
      </header>

      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 bg-zinc-50/90 px-4 py-3 backdrop-blur dark:bg-zinc-950/90">
        <SearchBar value={state.q} onCommit={onSearch} />
      </div>

      <div className="flex items-start gap-8">
        <aside
          id="browse-sidebar"
          aria-label="Filters"
          className={`hidden w-64 shrink-0 ${sidebarOpen ? "lg:block" : "lg:hidden"} lg:sticky lg:top-[calc(9rem+env(safe-area-inset-top))] lg:max-h-[calc(100dvh-9.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-2`}
        >
          {filterPanel("side")}
        </aside>

        <section aria-label="Results" className="min-w-0 flex-1">
          <Toolbar
            total={total}
            rangeText={rangeText}
            sort={sort}
            order={effectiveOrder(state)}
            hasQuery={Boolean(state.q)}
            view={view}
            onView={setView}
            onSort={(s) => change({ sort: s, order: null })}
            onOrder={() => change({ order: effectiveOrder(state) === "asc" ? "desc" : "asc" })}
            onOpenFilters={() => setDrawerOpen(true)}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            filterCount={filterCount}
          />

          {hasActiveFilters(state) && (
            <div className="mt-3">
              <ActiveFilters state={state} refData={refs.data} onChange={change} onClearAll={clearAll} />
            </div>
          )}

          {ch.error && data && (
            <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <span>Couldn’t refresh results. {ch.error}</span>
              <Button size="sm" variant="secondary" onClick={ch.retry}>Retry</Button>
            </div>
          )}

          <div className="mt-4">{body}</div>

          {data && <Pagination page={state.page} pageCount={pageCount} onPage={goPage} />}
        </section>
      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        footer={
          <Button variant="primary" className="w-full" onClick={closeDrawer}>
            Show {total !== null ? `${total.toLocaleString()} ${total === 1 ? "channel" : "channels"}` : "results"}
          </Button>
        }
      >
        {filterPanel("drawer")}
      </FilterDrawer>
    </div>
  );
}
