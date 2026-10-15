import type { ChannelSummary } from "@/lib/api";
import { PAGE_SIZE } from "./state";
import { ChannelCard } from "./ChannelCard";
import { Skeleton } from "@/components/ui/Skeleton";

export interface ChannelGridProps {
  items: ChannelSummary[];
  view: "grid" | "list";
  isFavorite: (id: string) => boolean;
  now: number;
  /** True while a page is loading; a dimmed grid is kept on screen when refetching. */
  busy: boolean;
  /** Show skeleton placeholders instead of the grid. */
  skeleton: boolean;
}

function SkeletonCard({ view }: { view: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-zinc-200/90 p-3 dark:border-zinc-800">
        <Skeleton className="h-14 w-24 shrink-0" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200/90 p-3 dark:border-zinc-800">
      <Skeleton className="aspect-[16/9] w-full rounded-lg" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="mt-2 h-1 w-full rounded-full" />
    </div>
  );
}

export function ChannelGrid({ items, view, isFavorite, now, busy, skeleton }: ChannelGridProps) {
  if (skeleton) {
    return (
      <div aria-busy="true" aria-label="Loading channels" className={view === "list" ? "flex flex-col gap-2" : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}>
        {Array.from({ length: Math.min(PAGE_SIZE, 12) }, (_, i) => (
          <SkeletonCard key={i} view={view} />
        ))}
      </div>
    );
  }
  const layout =
    view === "list"
      ? "flex flex-col gap-2"
      : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";
  return (
    <ul aria-busy={busy} className={`${layout} transition-opacity ${busy ? "opacity-60" : "opacity-100"}`}>
      {items.map((c) => (
        <li key={c.id} className="min-w-0">
          <ChannelCard channel={c} isFavorite={isFavorite(c.id)} view={view} now={now} />
        </li>
      ))}
    </ul>
  );
}
