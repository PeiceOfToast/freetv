import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type ChannelDetail, type Programme, type StreamInfo } from "@/lib/api";
import { favorites, useIsFavorite } from "@/lib/favorites";
import { fmtTime, nowTs, progress } from "@/lib/format";
import { Player } from "@/components/player/Player";
import { Schedule } from "./Schedule";

type LoadState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "error"; message: string }
  | { status: "ready"; channel: ChannelDetail };

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

export default function WatchPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [epg, setEpg] = useState<Programme[] | null>(null);
  const [epgError, setEpgError] = useState<string | null>(null);
  const [now, setNow] = useState(() => nowTs());
  const [copied, setCopied] = useState(false);
  const isFav = useIsFavorite(id);

  // Channel detail.
  useEffect(() => {
    const ac = new AbortController();
    setState({ status: "loading" });
    setEpg(null);
    api
      .channel(id, ac.signal)
      .then((channel) => setState({ status: "ready", channel }))
      .catch((err: unknown) => {
        if (isAbort(err)) return;
        if (err instanceof ApiError && err.status === 404) setState({ status: "notfound" });
        else setState({ status: "error", message: err instanceof Error ? err.message : "Unknown error" });
      });
    return () => ac.abort();
  }, [id]);

  // Schedule: now-2h .. now+24h, refreshed every 60 s.
  useEffect(() => {
    const ac = new AbortController();
    const load = () => {
      const t = nowTs();
      api
        .channelEpg(id, t - 2 * 3600, t + 24 * 3600, ac.signal)
        .then((r) => {
          setEpg(r.items);
          setEpgError(null);
        })
        .catch((err: unknown) => {
          if (isAbort(err)) return;
          setEpgError(err instanceof Error ? err.message : "Unknown error");
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      window.clearInterval(timer);
      ac.abort();
    };
  }, [id]);

  // Clock for progress bars and current-item highlight.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowTs()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const name = state.status === "ready" ? state.channel.name : null;
  useEffect(() => {
    if (!name) return;
    const prev = document.title;
    document.title = `${name} · FreeTV`;
    return () => {
      document.title = prev;
    };
  }, [name]);

  if (state.status === "loading") {
    return <div className="p-8 text-center opacity-60">Loading channel…</div>;
  }
  if (state.status === "notfound") {
    return (
      <div className="p-8 text-center">
        <p className="text-lg font-semibold">Channel not found</p>
        <p className="mt-1 opacity-70">There is no channel with the id “{id}”.</p>
        <Link to="/" className="mt-4 inline-block underline">Back to channels</Link>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="p-8 text-center">
        <p className="text-lg font-semibold">Couldn't load this channel</p>
        <p className="mt-1 opacity-70">{state.message}</p>
        <Link to="/" className="mt-4 inline-block underline">Back to channels</Link>
      </div>
    );
  }

  const ch = state.channel;

  // Prefer the fresh schedule; fall back to the detail's now/next snapshot.
  const scheduleCurrent = epg?.find((p) => p.start <= now && now < p.stop) ?? null;
  const nowItem = scheduleCurrent ?? (ch.now && ch.now.stop > now ? ch.now : null);
  const nextItem =
    epg?.find((p) => p.start >= (nowItem?.stop ?? now) && p !== scheduleCurrent) ??
    (ch.next && ch.next.start >= now ? ch.next : null);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="space-y-6">
      <nav className="text-sm opacity-70">
        <Link to="/" className="hover:underline">Channels</Link>
        <span className="mx-2">/</span>
        <span>{ch.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Player key={ch.id} streams={ch.streams} />
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="flex items-start gap-3">
            {ch.logo ? (
              <img src={ch.logo} alt="" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded bg-white object-contain p-1" />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{ch.name}</h1>
              <p className="text-sm opacity-70">
                {ch.flag && <span className="mr-1">{ch.flag}</span>}
                {ch.countryName ?? ch.country ?? "Unknown country"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => favorites.toggle(ch.id)}
              aria-pressed={isFav}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-200/60 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
            >
              {isFav ? "★ Favorited" : "☆ Add to favorites"}
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-200/60 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
            >
              {copied ? "Link copied" : "Share"}
            </button>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            {ch.categories.length > 0 && (
              <>
                <dt className="opacity-60">Categories</dt>
                <dd>{ch.categories.map((c) => c.name).join(", ")}</dd>
              </>
            )}
            {ch.languages.length > 0 && (
              <>
                <dt className="opacity-60">Languages</dt>
                <dd>{ch.languages.map((l) => l.name).join(", ")}</dd>
              </>
            )}
            {ch.network && (
              <>
                <dt className="opacity-60">Network</dt>
                <dd>{ch.network}</dd>
              </>
            )}
            {ch.website && (
              <>
                <dt className="opacity-60">Website</dt>
                <dd>
                  <a href={ch.website} target="_blank" rel="noopener noreferrer" className="break-all underline">
                    {ch.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </dd>
              </>
            )}
            {ch.closed && (
              <>
                <dt className="opacity-60">Closed</dt>
                <dd>{ch.closed}</dd>
              </>
            )}
          </dl>

          <section aria-label="Now and next" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Now / Next</h2>
            {nowItem ? (
              <div>
                <p className="font-medium">{nowItem.title}</p>
                <p className="text-xs opacity-60">
                  {fmtTime(nowItem.start)}–{fmtTime(nowItem.stop)}
                </p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${Math.round(progress(nowItem.start, nowItem.stop, now) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm opacity-60">No programme information right now.</p>
            )}
            {nextItem && (
              <div className="text-sm">
                <span className="opacity-60">Next: </span>
                <span className="font-medium">{nextItem.title}</span>
                <span className="opacity-60"> · {fmtTime(nextItem.start)}</span>
              </div>
            )}
            {nowItem?.description && <p className="text-sm opacity-70">{nowItem.description}</p>}
          </section>
        </aside>
      </div>

      <section aria-label="Today" className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Schedule</h2>
        <Schedule items={epg} now={now} error={epgError} />
      </section>

      <section aria-label="Streams" className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Streams</h2>
        <StreamList streams={ch.streams} />
      </section>
    </div>
  );
}

function StreamList({ streams }: { streams: StreamInfo[] }) {
  if (streams.length === 0) return <p className="text-sm opacity-60">No streams available.</p>;
  return (
    <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {streams.map((s) => (
        <li key={s.index} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="font-medium">{s.title || `Stream ${s.index + 1}`}</span>
          {s.quality && <Badge>{s.quality}</Badge>}
          {s.feed && <Badge>{s.feed}</Badge>}
          {s.labels.map((l) => (
            <Badge key={l}>{l}</Badge>
          ))}
          {s.proxyUrl && <Badge>Relay available</Badge>}
          <OnlineBadge online={s.online} />
        </li>
      ))}
    </ul>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{children}</span>;
}

function OnlineBadge({ online }: { online: boolean | null }) {
  if (online === true)
    return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Online</span>;
  if (online === false)
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-900/40 dark:text-red-300">Offline</span>;
  return <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs opacity-70 dark:bg-zinc-900">Unchecked</span>;
}
