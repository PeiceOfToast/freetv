import { castPlayPause, stopCasting, useCastState } from "@/lib/cast";
import { CastIcon } from "./parts";

const barButton =
  "rounded-md border border-emerald-400/60 px-2.5 py-1 text-xs font-medium hover:bg-emerald-100 disabled:pointer-events-none disabled:opacity-50 dark:border-emerald-700 dark:hover:bg-emerald-900/50";

/** Compact strip under the player while a Cast device is connected. */
export function CastBar() {
  const { state, deviceName, paused, loaded, error } = useCastState();
  if (state !== "CONNECTED") return null;

  return (
    <div
      role="region"
      aria-label="Casting"
      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/40"
    >
      <CastIcon className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
      <p className="min-w-0 flex-1 truncate">
        Casting to <span className="font-medium">{deviceName ?? "Cast device"}</span>
        {loaded ? <span className="opacity-70"> · {loaded.title}</span> : !error && <span className="opacity-70"> · nothing playing from this page</span>}
      </p>
      <button type="button" onClick={castPlayPause} disabled={!loaded} className={barButton} aria-label={paused ? "Play on Cast device" : "Pause on Cast device"}>
        {paused ? "Play" : "Pause"}
      </button>
      <button type="button" onClick={stopCasting} className={barButton}>
        Stop
      </button>
      {error && <p className="basis-full text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
