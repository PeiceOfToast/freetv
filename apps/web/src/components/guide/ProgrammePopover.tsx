import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { Programme } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/format";

interface Props {
  channelId: string;
  channelName: string;
  programme: Programme;
  onClose: () => void;
}

export function ProgrammePopover({ channelId, channelName, programme: p, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={p.title}
      className="fixed inset-x-4 bottom-4 z-50 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl sm:left-auto sm:right-6 sm:top-24 sm:bottom-auto sm:w-96 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs opacity-60">{channelName}</p>
          <h2 className="text-base font-semibold leading-snug">{p.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded px-2 text-lg leading-none opacity-60 hover:opacity-100"
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-sm opacity-70">
        {fmtDate(p.start)} · {fmtTime(p.start)}–{fmtTime(p.stop)}
        {p.category && <span> · {p.category}</span>}
      </p>
      {p.description && <p className="mt-3 max-h-40 overflow-y-auto text-sm leading-relaxed">{p.description}</p>}
      <div className="mt-4 flex justify-end">
        <Link
          to={`/watch/${encodeURIComponent(channelId)}`}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Watch
        </Link>
      </div>
    </div>
  );
}

export default ProgrammePopover;
