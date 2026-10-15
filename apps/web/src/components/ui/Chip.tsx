import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Toggle state. When defined the chip is rendered as a pressed/unpressed toggle button. */
  active?: boolean;
  count?: number;
  children: ReactNode;
}

/** Pill-shaped toggle chip. */
export function Chip({ active, count, children, className = "", type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500"
      } ${className}`}
      {...rest}
    >
      <span className="truncate">{children}</span>
      {count !== undefined && (
        <span className={`tabular-nums ${active ? "opacity-70" : "text-zinc-400 dark:text-zinc-500"}`}>{count}</span>
      )}
    </button>
  );
}

export interface RemovableChipProps {
  label: string;
  onRemove: () => void;
}

/** Non-toggle chip showing an active filter with a remove (x) button. */
export function RemovableChip({ label, onRemove }: RemovableChipProps) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-200/80 py-1 pl-3 pr-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="grid h-5 w-5 place-items-center rounded-full text-zinc-500 hover:bg-zinc-300/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-500"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}
