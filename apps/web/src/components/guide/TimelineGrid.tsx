import type { Programme } from "@/lib/api";
import { fmtTime } from "@/lib/format";

export const PX_PER_MIN = 4;
export const CHAN_W = 200;
const ROW_H = 56;
const HEADER_H = 32;

export interface GuideRow {
  id: string;
  name: string;
  logo: string | null;
}

interface Props {
  rows: GuideRow[];
  /** undefined = still loading; [] = no guide data for this channel. */
  grid: Record<string, Programme[] | undefined>;
  from: number;
  to: number;
  now: number;
  onSelect: (row: GuideRow, p: Programme) => void;
  onRemove?: (id: string) => void;
}

export function TimelineGrid({ rows, grid, from, to, now, onSelect, onRemove }: Props) {
  const trackW = ((to - from) / 60) * PX_PER_MIN;
  const ticks: number[] = [];
  for (let t = from; t < to; t += 1800) ticks.push(t);
  const nowX = now >= from && now <= to ? CHAN_W + ((now - from) / 60) * PX_PER_MIN : null;

  return (
    <div className="relative max-h-[70vh] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <div className="relative" style={{ width: CHAN_W + trackW }}>
        {/* Time header */}
        <div
          className="sticky top-0 z-20 flex border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          style={{ height: HEADER_H }}
        >
          <div className="sticky left-0 z-30 shrink-0 bg-zinc-50 dark:bg-zinc-950" style={{ width: CHAN_W }} />
          <div className="relative" style={{ width: trackW }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute top-0 h-full border-l border-zinc-300 pl-1 pt-1.5 text-xs tabular-nums opacity-70 dark:border-zinc-700"
                style={{ left: ((t - from) / 60) * PX_PER_MIN }}
              >
                {fmtTime(t)}
              </span>
            ))}
          </div>
        </div>

        {rows.map((row) => {
          const progs = grid[row.id];
          return (
            <div
              key={row.id}
              className="flex border-b border-zinc-200/70 dark:border-zinc-800/70"
              style={{ height: ROW_H }}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-800 dark:bg-zinc-950"
                style={{ width: CHAN_W }}
              >
                {row.logo ? (
                  <img src={row.logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 object-contain" />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm" title={row.name}>
                  {row.name}
                </span>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(row.id)}
                    aria-label={`Remove ${row.name} from guide`}
                    className="shrink-0 rounded px-1 text-sm opacity-50 hover:opacity-100"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="relative" style={{ width: trackW, height: ROW_H }}>
                {progs === undefined && (
                  <span className="absolute inset-y-0 left-2 flex items-center text-xs opacity-40">Loading…</span>
                )}
                {progs !== undefined && progs.length === 0 && (
                  <span className="absolute inset-y-0 left-2 flex items-center text-xs opacity-50">No guide data</span>
                )}
                {progs?.map((p) => {
                  const s = Math.max(p.start, from);
                  const e = Math.min(p.stop, to);
                  if (e <= s) return null;
                  const left = ((s - from) / 60) * PX_PER_MIN;
                  const width = ((e - s) / 60) * PX_PER_MIN;
                  const airing = p.start <= now && now < p.stop;
                  return (
                    <button
                      key={`${p.start}-${p.title}`}
                      type="button"
                      title={p.title}
                      onClick={() => onSelect(row, p)}
                      className={[
                        "absolute top-1 bottom-1 overflow-hidden rounded-md px-2 py-1 text-left text-xs",
                        airing
                          ? "bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/50 dark:hover:bg-emerald-900/70"
                          : "bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700",
                      ].join(" ")}
                      style={{ left, width: Math.max(width - 2, 4) }}
                    >
                      <span className="block truncate font-medium">{p.title}</span>
                      {width > 90 && <span className="block truncate opacity-60">{fmtTime(p.start)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {nowX !== null && (
          <div
            aria-label="Now"
            className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-red-500"
            style={{ left: nowX }}
          />
        )}
      </div>
    </div>
  );
}

export default TimelineGrid;
