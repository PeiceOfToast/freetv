import { useEffect, useRef } from "react";
import { SHORTCUT_GROUPS, useKeyHandler } from "@/lib/shortcuts";

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <span key={k}>
          {i > 0 && <span className="mx-0.5 text-xs text-zinc-400">/</span>}
          <kbd className="inline-grid min-w-6 place-items-center rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-xs text-zinc-700 shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

/** Keyboard cheat sheet, opened with "?". Closes on Escape, on the backdrop or the close button. */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useKeyHandler({ Escape: onClose }, open);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus?.();
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-zinc-950/50 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-w-lg sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-zinc-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Close
          </button>
        </div>
        <div className="space-y-5">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{g.title}</h3>
              <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span className="text-zinc-700 dark:text-zinc-300">{it.label}</span>
                    <Keys keys={it.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-5 text-xs text-zinc-500 dark:text-zinc-400">Shortcuts are off while you type in a text field.</p>
      </div>
    </div>
  );
}
