/** "Browser" when the stream is known to play in a browser, "App" when it needs a player app, nothing when unknown. */
export function PlayabilityBadge({ playable }: { playable: boolean | null | undefined }) {
  if (playable === true) {
    return (
      <span
        title="Plays in this browser"
        className="rounded border border-emerald-500/70 px-1.5 py-px text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-400/60 dark:text-emerald-400"
      >
        Browser
      </span>
    );
  }
  if (playable === false) {
    return (
      <span
        title="Needs VLC or a TV app; it does not play in a browser"
        className="rounded border border-amber-400/70 px-1.5 py-px text-xs font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-500/60 dark:text-amber-400"
      >
        App
      </span>
    );
  }
  return null;
}
