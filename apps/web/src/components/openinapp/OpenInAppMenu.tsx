import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { StreamInfo } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import {
  appStreamUrl, channelPlaylistAbsoluteUrl, detectPlatform, openPlan, type OpenAction, type OpenPlan,
} from "@/lib/open-in-app";

export interface OpenInAppMenuProps {
  channelId: string;
  streams: StreamInfo[];
  /** Filled button (the call to action) or outlined (a secondary option). */
  emphasis?: "primary" | "secondary";
  /**
   * Compact: only the primary action as a link, plus "More ways" that jumps to the full menu.
   * Used inside the player's failure panel, where a dropdown would be clipped.
   */
  compact?: boolean;
  /** Where "More ways" scrolls to in compact mode. */
  moreTargetId?: string;
}

function streamName(s: StreamInfo, i: number): string {
  // Titles usually already carry the quality and feed; only fall back to them when there is no title.
  return s.title || [s.quality, s.feed].filter(Boolean).join(" · ") || `Stream ${i + 1}`;
}

const linkClass =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500";
const secondaryLinkClass =
  "text-sm font-medium text-zinc-800 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white";
// Compact mode sits on the player's dark failure panel, so it uses light colours.
const compactLinkClass =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 text-sm font-medium text-zinc-900 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300";
const compactMoreClass = "min-h-9 text-sm font-medium text-zinc-200 underline underline-offset-2 hover:text-white";

export function OpenInAppMenu({ channelId, streams, emphasis = "secondary", compact = false, moreTargetId }: OpenInAppMenuProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0); // position in `streams`; 0 is the first in API order
  const [copied, setCopied] = useState(false);
  const [platform] = useState(() => detectPlatform());
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const stream = streams[Math.min(index, Math.max(0, streams.length - 1))];
  const url = stream ? appStreamUrl(stream) : "";
  const plan: OpenPlan | null = useMemo(
    () => (stream ? openPlan(platform, url, channelPlaylistAbsoluteUrl(channelId)) : null),
    [platform, url, channelId, stream],
  );

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!stream || !plan) {
    return (
      <Button variant={emphasis} size="md" disabled>
        Open in app
      </Button>
    );
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address field in the menu can be copied by hand.
    }
  };

  if (compact) {
    return (
      <div className="flex w-full max-w-xs flex-col items-center gap-1">
        <ActionLink action={plan.primary} className={compactLinkClass} onCopy={copy} labelPrefix="Open in app" />
        {moreTargetId && (
          <button
            type="button"
            onClick={() => document.getElementById(moreTargetId)?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className={compactMoreClass}
          >
            More ways to open this channel
          </button>
        )}
      </div>
    );
  }

  const primary = plan.primary;
  return (
    <div ref={rootRef} className="relative inline-block">
      <Button
        variant={emphasis}
        size="md"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        Open in app
        <svg viewBox="0 0 12 12" aria-hidden="true" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>

      {open && (
        <div
          id={panelId}
          className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {streams.length > 1 && (
            <label className="flex items-center gap-2 text-xs">
              <span className="shrink-0 opacity-70">Stream</span>
              <select
                value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
                className="min-h-9 min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
              >
                {streams.map((s, i) => (
                  <option key={s.index} value={i}>
                    {streamName(s, i)}{s.browserPlayable === true ? " · plays in browser" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="space-y-1">
            <ActionLink action={primary} className={linkClass} onCopy={copy} />
            {primary.hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{primary.hint}</p>}
          </div>

          {plan.secondary.length > 0 && (
            <ul className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              {plan.secondary.map((a) => (
                <li key={a.id}>
                  <ActionLink action={a} className={secondaryLinkClass} onCopy={copy} copied={copied && a.kind === "copy"} />
                  {a.hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{a.hint}</p>}
                </li>
              ))}
            </ul>
          )}

          <label className="block text-xs">
            <span className="mb-1 block opacity-70">Stream address</span>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Stream address"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 font-mono text-[11px] dark:border-zinc-700"
            />
          </label>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Your device fetches the stream directly; nothing goes through this site.
          </p>
        </div>
      )}
    </div>
  );
}

function ActionLink({
  action, className, onCopy, copied = false, labelPrefix,
}: { action: OpenAction; className: string; onCopy: (text: string) => void; copied?: boolean; labelPrefix?: string }) {
  // labelPrefix puts "Open in app" into the accessible name of the compact primary control.
  const aria = labelPrefix ? `${labelPrefix}: ${action.label}` : undefined;
  if (action.kind === "copy") {
    return (
      <button type="button" className={`${className} text-left`} onClick={() => onCopy(action.text)} aria-label={aria}>
        {copied ? "Copied" : action.label}
      </button>
    );
  }
  if (action.kind === "download") {
    return (
      <a href={action.href} download className={className} aria-label={aria}>
        {action.label}
      </a>
    );
  }
  return (
    <a href={action.href} className={className} aria-label={aria}>
      {action.label}
    </a>
  );
}
