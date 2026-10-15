import { reloadForUpdate, useUpdateReady } from "@/lib/pwa";

/** Shown when a new service worker has taken over; "Reload" applies the new version. */
export function UpdateToast() {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-zinc-900 py-1.5 pl-4 pr-1.5 text-sm text-zinc-100 shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
        <span>Update available</span>
        <button
          type="button"
          onClick={reloadForUpdate}
          className="inline-flex min-h-9 items-center rounded-full bg-zinc-100 px-3.5 font-medium text-zinc-900 hover:bg-white dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
