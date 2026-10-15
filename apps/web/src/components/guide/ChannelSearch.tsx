import { useEffect, useState } from "react";
import { api, type ChannelSummary } from "@/lib/api";

interface Props {
  addedIds: string[];
  onAdd: (id: string) => void;
}

/** Debounced channel search; each result can be added to the guide. */
export function ChannelSearch({ addedIds, onAdd }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ChannelSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setBusy(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setBusy(true);
    const timer = window.setTimeout(() => {
      api
        .channels({ q: term, hasStream: true, limit: 20 }, ac.signal)
        .then((r) => {
          setResults(r.items);
          setError(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [q]);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">Search channels to add</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search channels to add…"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {busy && results.length === 0 && <p className="text-xs opacity-60">Searching…</p>}
      {results.length > 0 && (
        <ul className="max-h-72 divide-y divide-zinc-200 overflow-y-auto rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {results.map((c) => {
            const added = addedIds.includes(c.id);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                {c.logo ? (
                  <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 object-contain" />
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {c.flag && <span className="mr-1">{c.flag}</span>}
                  {c.name}
                </span>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => onAdd(c.id)}
                  className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-200/60 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
                >
                  {added ? "Added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ChannelSearch;
