import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ChannelSummary, type Programme } from "@/lib/api";
import { favorites, useFavorites } from "@/lib/favorites";
import { fmtTime, nowTs } from "@/lib/format";
import { TimelineGrid, type GuideRow } from "@/components/guide/TimelineGrid";
import { ProgrammePopover } from "@/components/guide/ProgrammePopover";
import { ChannelSearch } from "@/components/guide/ChannelSearch";

const WINDOWS = [3, 6, 12] as const;
const BATCH = 100;
const SLOT = 1800; // grid snaps to half hours
const REFRESH_MS = 5 * 60_000;

const snap = (t: number) => Math.floor(t / SLOT) * SLOT;
const defaultStart = () => snap(nowTs() - SLOT);

interface Selected {
  row: GuideRow;
  programme: Programme;
}

export default function GuidePage() {
  const ids = useFavorites();
  const idsKey = ids.join(",");

  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(3);
  const [start, setStart] = useState(defaultStart);
  const [now, setNow] = useState(() => nowTs());
  const [refresh, setRefresh] = useState(0);
  const [meta, setMeta] = useState<Record<string, ChannelSummary>>({});
  const [grid, setGrid] = useState<Record<string, Programme[] | undefined>>({});
  const [gridError, setGridError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  const from = start;
  const to = start + hours * 3600;

  // Clock: "now" line and current-programme highlight.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowTs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Periodic data refresh.
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((r) => r + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Channel names and logos for the favourite rows.
  useEffect(() => {
    if (ids.length === 0) return;
    const ac = new AbortController();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
    Promise.all(
      chunks.map((chunk) =>
        api.channels({ favorites: chunk, hasStream: false, nsfw: true, limit: 200 }, ac.signal),
      ),
    )
      .then((pages) => {
        setMeta((prev) => {
          const next = { ...prev };
          for (const page of pages) for (const c of page.items) next[c.id] = c;
          return next;
        });
      })
      .catch(() => {
        /* names fall back to ids */
      });
    return () => ac.abort();
    // idsKey is the stable identity of ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Guide grid for the current window, in batches of <=100 ids.
  useEffect(() => {
    if (ids.length === 0) return;
    const ac = new AbortController();
    setGridError(null);
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      api
        .epgGrid(batch, from, to, ac.signal)
        .then((r) => {
          setGrid((prev) => {
            const next = { ...prev };
            for (const id of batch) next[id] = r.channels[id] ?? [];
            return next;
          });
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setGridError(err instanceof Error ? err.message : "Couldn't load the guide");
        });
    }
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, from, to, refresh]);

  const rows: GuideRow[] = useMemo(
    () =>
      ids.map((id) => {
        const m = meta[id];
        return { id, name: m?.name ?? id, logo: m?.logo ?? null };
      }),
    // ids identity is tracked by idsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, meta],
  );

  const shift = (dir: -1 | 1) => setStart((s) => s + dir * (hours * 3600) / 2);
  const jumpNow = () => setStart(defaultStart());
  const closePopover = useCallback(() => setSelected(null), []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-[clamp(1.25rem,1.1rem+0.7vw,1.5rem)] font-semibold tracking-tight">TV guide</h1>

        <div role="group" aria-label="Time window" className="flex overflow-hidden rounded-md border border-zinc-300 text-sm dark:border-zinc-700">
          {WINDOWS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={hours === h}
              onClick={() => setHours(h)}
              className={`px-3 py-1.5 ${hours === h ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"}`}
            >
              {h} h
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-sm">
          <button type="button" onClick={() => shift(-1)} aria-label="Earlier" className="rounded-md border border-zinc-300 px-2.5 py-1.5 hover:bg-zinc-200/60 dark:border-zinc-700 dark:hover:bg-zinc-800/60">
            ‹
          </button>
          <button type="button" onClick={jumpNow} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-200/60 dark:border-zinc-700 dark:hover:bg-zinc-800/60">
            Now
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Later" className="rounded-md border border-zinc-300 px-2.5 py-1.5 hover:bg-zinc-200/60 dark:border-zinc-700 dark:hover:bg-zinc-800/60">
            ›
          </button>
          <span className="ml-2 tabular-nums opacity-70">
            {fmtTime(from)}–{fmtTime(to)}
          </span>
        </div>
      </div>

      {ids.length === 0 ? (
        <div className="space-y-4 rounded-md border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
          <div>
            <p className="font-medium">Your guide is empty</p>
            <p className="mt-1 text-sm opacity-70">
              Search for channels below and add them to see what's on. Added channels are saved as favorites in this browser.
            </p>
          </div>
          <div className="max-w-xl">
            <ChannelSearch addedIds={ids} onAdd={(id) => favorites.toggle(id)} />
          </div>
        </div>
      ) : (
        <>
          <details className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <summary className="flex min-h-11 pointer-fine:min-h-0 cursor-pointer select-none items-center font-medium">Add channels ({ids.length} in guide)</summary>
            <div className="mt-3 max-w-xl">
              <ChannelSearch addedIds={ids} onAdd={(id) => favorites.toggle(id)} />
            </div>
          </details>

          {gridError && <p className="text-sm text-red-600 dark:text-red-400">{gridError}</p>}

          <TimelineGrid
            rows={rows}
            grid={grid}
            from={from}
            to={to}
            now={now}
            onSelect={(row, programme) => setSelected({ row, programme })}
            onRemove={(id) => {
              if (favorites.has(id)) favorites.toggle(id);
            }}
          />
        </>
      )}

      {selected && (
        <ProgrammePopover
          channelId={selected.row.id}
          channelName={selected.row.name}
          programme={selected.programme}
          onClose={closePopover}
        />
      )}
    </div>
  );
}
