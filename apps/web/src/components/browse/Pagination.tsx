import { Button } from "@/components/ui/Button";

/** 1-based page numbers with ellipses, e.g. [1, "…", 4, 5, 6, "…", 12]. */
export function pageWindow(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pageCount - 1) out.push("…");
  out.push(pageCount);
  return out;
}

export function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ← Prev
      </Button>
      <div className="flex items-center gap-1">
        {pageWindow(page, pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} aria-hidden="true" className="px-2 text-sm text-zinc-400">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              className={`grid h-8 min-w-8 place-items-center rounded-lg px-2 text-sm tabular-nums transition-colors ${
                p === page
                  ? "bg-zinc-900 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
              }`}
            >
              {p}
            </button>
          ),
        )}
      </div>
      <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next →
      </Button>
    </nav>
  );
}
