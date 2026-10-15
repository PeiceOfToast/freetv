import type { ReactNode } from "react";

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
        {action}
      </header>
      <div className="flex-1 space-y-2">{children}</div>
    </section>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

export function Big({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

/** Stacked horizontal bar. Each segment is a share of `total`; the rest is the empty track. */
export function StackedBar({
  total,
  segments,
  label,
}: {
  total: number;
  segments: Array<{ value: number; className: string; name: string }>;
  label: string;
}) {
  const pct = (v: number) => (total > 0 ? `${Math.min(100, (v / total) * 100)}%` : "0%");
  return (
    <div>
      <div
        role="img"
        aria-label={label}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        {segments.map((s) => (
          <div key={s.name} className={s.className} style={{ width: pct(s.value) }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {segments.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${s.className}`} aria-hidden="true" />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}
