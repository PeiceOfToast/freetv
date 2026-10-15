// Shared look for the cast and AirPlay controls, matching the watch page's action buttons.

export const actionClass =
  "inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-200/60 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60";

export function CastIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
    </svg>
  );
}

export function AirPlayIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
      <path d="M12 14l5 6H7z" fill="currentColor" />
    </svg>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
