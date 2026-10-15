import { useSaveData } from "@/lib/network";

/** Switch for the "Reduced data" preference. The same store backs every instance, so all copies agree. */
export function ReducedDataToggle({ id = "reduced-data", className = "", onChange }: { id?: string; className?: string; onChange?: (v: boolean) => void }) {
  const [on, store] = useSaveData();
  const set = (v: boolean) => {
    store(v);
    onChange?.(v);
  };
  return (
    <label
      htmlFor={id}
      title="Play the lowest-quality stream first. Saves data on metered connections."
      className={`inline-flex cursor-pointer items-center gap-2 text-sm min-h-11 pointer-fine:min-h-0 ${className}`}
    >
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => set(e.target.checked)}
          className="peer sr-only"
        />
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-zinc-300 transition-colors peer-checked:bg-zinc-900 peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-500 dark:bg-zinc-700 dark:peer-checked:bg-zinc-100" />
        <span aria-hidden="true" className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4 dark:bg-zinc-900" />
      </span>
      <span>Reduced data</span>
    </label>
  );
}
