import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SORT_OPTIONS } from "./state";
import type { SortKey } from "@/lib/api";
import type { ViewMode } from "./useView";

export interface ToolbarProps {
  total: number | null;
  rangeText: string | null;
  /** Probe totals from /api/meta. The summary and the "Only online" chip show only when something was probed. */
  health: { probed: number; online: number } | null;
  online: boolean;
  onOnline: (v: boolean) => void;
  sort: SortKey;
  order: "asc" | "desc";
  hasQuery: boolean;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  onSort: (s: SortKey) => void;
  onOrder: () => void;
  onOpenFilters: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  filterCount: number;
}

const iconBtn = (active: boolean) =>
  `grid h-8 w-8 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-zinc-500 ${
    active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
  }`;

export function Toolbar(p: ToolbarProps) {
  const sortOptions = SORT_OPTIONS.filter((o) => o.value !== "relevance" || p.hasQuery);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="mr-auto min-w-0">
        <div aria-live="polite">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {p.total === null ? (
              <span className="text-zinc-400">Loading channels…</span>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{p.total.toLocaleString()}</span>{" "}
                {p.total === 1 ? "channel" : "channels"}
                {p.rangeText && <span className="text-zinc-400 dark:text-zinc-500"> · {p.rangeText}</span>}
              </>
            )}
          </p>
        </div>
        {p.health && p.health.probed > 0 && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="tabular-nums">{p.health.online.toLocaleString()}</span> of{" "}
            <span className="tabular-nums">{p.health.probed.toLocaleString()}</span> checked streams online
          </p>
        )}
      </div>

      {p.health && p.health.probed > 0 && (
        <Chip active={p.online} onClick={() => p.onOnline(!p.online)} title="Hide channels whose last health check failed">
          Only online
        </Chip>
      )}

      <div className="lg:hidden">
      <Button variant="secondary" size="sm" onClick={p.onOpenFilters} aria-haspopup="dialog">
        Filters
        {p.filterCount > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-zinc-900 px-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">{p.filterCount}</span>
        )}
      </Button>
      </div>
      <div className="hidden lg:block">
      <Button variant="secondary" size="sm" onClick={p.onToggleSidebar} aria-expanded={p.sidebarOpen} aria-controls="browse-sidebar">
        {p.sidebarOpen ? "Hide filters" : "Show filters"}
        {p.filterCount > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-zinc-900 px-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">{p.filterCount}</span>
        )}
      </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor="browse-sort" className="sr-only">Sort by</label>
        <select
          id="browse-sort"
          value={p.sort}
          onChange={(e) => p.onSort(e.target.value as SortKey)}
          className="h-8 rounded-lg border border-zinc-300 bg-white pl-2.5 pr-7 text-sm text-zinc-800 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {p.sort !== "relevance" && (
          <button
            type="button"
            onClick={p.onOrder}
            aria-label={`Sort ${p.order === "asc" ? "ascending, switch to descending" : "descending, switch to ascending"}`}
            title={p.order === "asc" ? "Ascending" : "Descending"}
            className={`${iconBtn(false)} border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900`}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-4 w-4 transition-transform ${p.order === "desc" ? "rotate-180" : ""}`}>
              <path d="M8 13V3M4 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900" role="group" aria-label="View">
        <button type="button" aria-pressed={p.view === "grid"} aria-label="Grid view" title="Grid" onClick={() => p.onView("grid")} className={iconBtn(p.view === "grid")}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="currentColor"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
        </button>
        <button type="button" aria-pressed={p.view === "list"} aria-label="List view" title="List" onClick={() => p.onView("list")} className={iconBtn(p.view === "list")}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="currentColor"><rect x="2" y="3" width="12" height="2" rx="1" /><rect x="2" y="7" width="12" height="2" rx="1" /><rect x="2" y="11" width="12" height="2" rx="1" /></svg>
        </button>
      </div>
    </div>
  );
}
