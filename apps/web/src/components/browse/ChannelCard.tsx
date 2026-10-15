import { memo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ChannelSummary } from "@/lib/api";
import { favorites } from "@/lib/favorites";
import { fmtTime, progress } from "@/lib/format";
import { ChannelLogo } from "./ChannelLogo";

export interface ChannelCardProps {
  channel: ChannelSummary;
  isFavorite: boolean;
  view: "grid" | "list";
  /** Unix seconds, used for the programme progress bar. Ticks from the page. */
  now: number;
}

const cardBase =
  "group relative flex rounded-xl border border-zinc-200/90 bg-white transition-colors hover:border-zinc-300 hover:shadow-sm focus-within:ring-2 focus-within:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700 dark:focus-within:ring-zinc-500";

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 20.5s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  const cls =
    tone === "warn"
      ? "border-amber-400/70 text-amber-700 dark:border-amber-500/60 dark:text-amber-400"
      : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300";
  return <span className={`rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function NowLine({ channel, now }: { channel: ChannelSummary; now: number }) {
  const prog = channel.now ? progress(channel.now.start, channel.now.stop, now) : 0;
  if (!channel.now) return null;
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
        <span className="text-zinc-400 dark:text-zinc-500">Now: </span>
        {channel.now.title}
        <span className="ml-1.5 tabular-nums text-zinc-400 dark:text-zinc-500">
          {fmtTime(channel.now.start)}
        </span>
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-900 transition-[width] duration-500 dark:bg-zinc-100" style={{ width: `${prog * 100}%` }} />
      </div>
    </div>
  );
}

function Meta({ channel }: { channel: ChannelSummary }) {
  const c = channel;
  const streams = `${c.streamCount} stream${c.streamCount === 1 ? "" : "s"}`;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="truncate">
        {c.flag && <span className="mr-1" aria-hidden="true">{c.flag}</span>}
        {c.countryName ?? c.country ?? "Unknown country"}
      </span>
      <span aria-hidden="true">·</span>
      <span className="whitespace-nowrap">{streams}</span>
      {c.bestQuality && <Badge>{c.bestQuality}</Badge>}
      {c.isNsfw && <Badge tone="warn">18+</Badge>}
      {c.online !== null && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${c.online ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600"}`}
          title={c.online ? "Last check: online" : "Last check: offline"}
          aria-label={c.online ? "Last check: online" : "Last check: offline"}
          role="img"
        />
      )}
    </div>
  );
}

function Tags({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {categories.slice(0, 2).map((cat) => (
        <span key={cat} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {cat}
        </span>
      ))}
    </div>
  );
}

export const ChannelCard = memo(function ChannelCard({ channel: c, isFavorite, view, now }: ChannelCardProps) {
  const href = `/watch/${encodeURIComponent(c.id)}`;
  const favLabel = `${isFavorite ? "Remove" : "Add"} ${c.name} ${isFavorite ? "from" : "to"} favorites`;

  const favButton = (
    <button
      type="button"
      aria-pressed={isFavorite}
      aria-label={favLabel}
      title={favLabel}
      onClick={() => favorites.toggle(c.id)}
      className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-zinc-500 ${
        isFavorite
          ? "bg-rose-50 text-rose-500 hover:bg-rose-100 dark:bg-rose-500/15 dark:hover:bg-rose-500/25"
          : "bg-white/90 text-zinc-500 shadow-sm hover:text-rose-500 dark:bg-zinc-900/90 dark:text-zinc-400"
      }`}
    >
      <HeartIcon filled={isFavorite} className="h-4 w-4" />
    </button>
  );

  // The title link stretches over the whole card (after:inset-0) so the card is clickable,
  // while the heart button sits above it with its own z-index.
  const titleLink = (
    <Link to={href} className="truncate text-sm font-semibold text-zinc-900 after:absolute after:inset-0 after:rounded-xl focus:outline-none dark:text-zinc-100">
      {c.name}
    </Link>
  );

  if (view === "list") {
    return (
      <article className={`${cardBase} items-center gap-4 p-3`}>
        <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800/60">
          <ChannelLogo src={c.logo} name={c.name} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="min-w-0">{titleLink}</div>
          <Meta channel={c} />
          <Tags categories={c.categories} />
          <NowLine channel={c} now={now} />
        </div>
        {favButton}
      </article>
    );
  }

  return (
    <article className={`${cardBase} flex-col gap-3 p-3`}>
      <div className="relative flex aspect-[16/9] items-center justify-center rounded-lg bg-zinc-100 p-5 dark:bg-zinc-800/60">
        <ChannelLogo src={c.logo} name={c.name} />
        <div className="absolute right-2 top-2">{favButton}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-0.5">
        <div className="min-w-0">{titleLink}</div>
        <Meta channel={c} />
        <Tags categories={c.categories} />
        <div className="mt-auto pt-1">
          <NowLine channel={c} now={now} />
        </div>
      </div>
    </article>
  );
});
