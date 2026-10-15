import { useEffect, useRef, type ReactNode } from "react";

export interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}

/** Mobile/tablet filter sheet. Hidden at lg and up, where the sidebar is shown inline. */
export function FilterDrawer({ open, onClose, footer, children }: FilterDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-drawer-title"
        className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col bg-zinc-50 shadow-2xl dark:bg-zinc-950"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
          <span id="filters-drawer-title" className="font-semibold">Filters</span>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800/70">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        <div className="shrink-0 border-t border-zinc-200 p-4 dark:border-zinc-800">{footer}</div>
      </div>
    </div>
  );
}
