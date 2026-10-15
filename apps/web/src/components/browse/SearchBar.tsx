import { useEffect, useRef, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 250;

export interface SearchBarProps {
  /** Committed query, from the URL. */
  value: string;
  onCommit: (q: string, opts: { immediate?: boolean }) => void;
}

const norm = (s: string) => s.trim();

export function SearchBar({ value, onCommit }: SearchBarProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(norm(value));
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const inputRef = useRef<HTMLInputElement>(null);

  // External changes (back/forward, "clear all") flow into the input.
  useEffect(() => {
    if (norm(value) !== committed.current) {
      committed.current = norm(value);
      setDraft(value);
    }
  }, [value]);

  // Debounce typing; abort the pending commit on every keystroke.
  useEffect(() => {
    if (norm(draft) === committed.current) return;
    const t = window.setTimeout(() => {
      committed.current = norm(draft);
      onCommitRef.current(norm(draft), {});
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [draft]);

  const commitNow = () => {
    if (norm(draft) === committed.current) return;
    committed.current = norm(draft);
    onCommitRef.current(norm(draft), { immediate: true });
  };

  const clear = () => {
    setDraft("");
    committed.current = "";
    onCommitRef.current("", { immediate: true });
    inputRef.current?.focus();
  };

  return (
    <form
      role="search"
      onSubmit={(e) => { e.preventDefault(); commitNow(); }}
      className="relative"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400">
        <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && draft) { e.preventDefault(); clear(); } }}
        placeholder="Search channels, networks, countries…"
        aria-label="Search channels"
        autoComplete="off"
        spellCheck={false}
        className="h-12 w-full rounded-xl border border-zinc-300 bg-white pl-12 pr-12 text-base text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </form>
  );
}
