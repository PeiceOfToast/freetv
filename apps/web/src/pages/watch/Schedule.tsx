import { useMemo } from "react";
import type { Programme } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/format";

interface Props {
  items: Programme[] | null;
  now: number;
  error?: string | null;
}

/** Group programmes by local calendar day, preserving order. */
function groupByDay(items: Programme[]): { key: string; first: number; list: Programme[] }[] {
  const groups = new Map<string, { key: string; first: number; list: Programme[] }>();
  for (const p of items) {
    const d = new Date(p.start * 1000);
    const key = d.toDateString();
    let g = groups.get(key);
    if (!g) {
      g = { key, first: p.start, list: [] };
      groups.set(key, g);
    }
    g.list.push(p);
  }
  return [...groups.values()];
}

export function Schedule({ items, now, error }: Props) {
  const groups = useMemo(() => (items ? groupByDay(items) : []), [items]);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">Couldn't load the schedule: {error}</p>;
  if (items === null) return <p className="text-sm opacity-60">Loading schedule…</p>;
  if (items.length === 0) return <p className="text-sm opacity-60">No schedule data for this channel.</p>;

  return (
    <div className="max-h-[28rem] space-y-4 overflow-y-auto overscroll-contain pr-1">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="sticky top-0 z-10 bg-zinc-50 py-1 text-xs font-semibold uppercase tracking-wide opacity-70 dark:bg-zinc-950">
            {fmtDate(g.first)}
          </h3>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.list.map((p) => {
              const current = p.start <= now && now < p.stop;
              const past = p.stop <= now;
              return (
                <li
                  key={`${p.start}-${p.title}`}
                  aria-current={current ? "true" : undefined}
                  className={[
                    "flex gap-3 px-2 py-2 text-sm",
                    current ? "rounded-md bg-emerald-100/70 dark:bg-emerald-900/30" : "",
                    past ? "opacity-50" : "",
                  ].join(" ")}
                >
                  <span className="w-28 shrink-0 tabular-nums opacity-70">
                    {fmtTime(p.start)}–{fmtTime(p.stop)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={current ? "font-semibold" : "font-medium"}>{p.title}</span>
                    {p.category && <span className="ml-2 text-xs opacity-60">{p.category}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default Schedule;
