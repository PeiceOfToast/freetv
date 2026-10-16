import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Category, type ChannelSummary } from "@/lib/api";
import { useFavorites } from "@/lib/favorites";
import { fmtTime, nowTs, progress } from "@/lib/format";
import { ChannelLogo, ChannelNo, ChannelTile, CtaTile, TvRow, qualityBadge } from "@/components/tv/TvTile";
import { remember } from "@/components/tv/numbers";
import { IconGrid, IconPlay, IconStar } from "@/components/tv/icons";
import { nsfwParam, tvList, tvRecent } from "@/components/tv/tvSettings";

const TOP_CATEGORIES = 6;
const ROW_SIZE = 24;
/** A rail starts loading once it is within this many screens of the viewport, in either direction. */
const RAIL_MARGIN = "150% 0px";
/** Fresh install: the catalog is re-checked this often until the first ingest lands. */
const CATALOG_RETRY_MS = 15_000;

interface RowState { items: ChannelSummary[] | null; error: boolean }

/**
 * Wraps one category rail and calls onNear once it comes within RAIL_MARGIN of the viewport.
 * Without IntersectionObserver (old TV engines) it calls onNear straight away, as the page did before.
 */
function LazyRail({ onNear, children }: { onNear: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onNear);
  cb.current = onNear;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      cb.current();
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        cb.current();
      }
    }, { rootMargin: RAIL_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** A focusable stand-in for a row's tiles while they load. aria-disabled keeps it out of the press path. */
function RowPlaceholder({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <button
      type="button"
      data-nav
      tabIndex={0}
      className="tv-tile tv-tile-cta"
      aria-disabled="true"
      aria-busy={onRetry ? undefined : true}
      onClick={onRetry}
    >
      <span>{text}</span>
    </button>
  );
}

export default function HomePage() {
  const nav = useNavigate();
  const favs = useFavorites();
  const [favItems, setFavItems] = useState<ChannelSummary[] | null>(null);
  const [recent, setRecent] = useState<ChannelSummary[] | null>(null);
  const [cats, setCats] = useState<Category[] | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [catError, setCatError] = useState(false);
  const [catalogPending, setCatalogPending] = useState(false);
  const [catKey, setCatKey] = useState(0);
  const acRef = useRef<AbortController | null>(null);
  const requested = useRef(new Set<string>());

  // One abort controller for the page's category-row requests; aborted on unmount.
  useEffect(() => {
    const ac = new AbortController();
    acRef.current = ac;
    return () => ac.abort();
  }, []);

  // Favorites: the API filter needs ids; an empty list would return every channel, so skip it.
  useEffect(() => {
    if (favs.length === 0) { setFavItems([]); return; }
    const ac = new AbortController();
    api.channels({ favorites: favs, limit: 50, withNow: true, nsfw: nsfwParam() }, ac.signal)
      .then((r) => { remember(r.items); setFavItems(r.items); })
      .catch(() => setFavItems([]));
    return () => ac.abort();
  }, [favs.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continue watching: API returns in its own order, so re-sort by the recent list.
  useEffect(() => {
    const ids = tvRecent.list();
    if (ids.length === 0) { setRecent([]); return; }
    const ac = new AbortController();
    api.channels({ favorites: ids, limit: 10, withNow: true, nsfw: nsfwParam() }, ac.signal)
      .then((r) => {
        remember(r.items);
        const byId = new Map(r.items.map((c) => [c.id, c] as const));
        setRecent(ids.map((id) => byId.get(id)).filter((c): c is ChannelSummary => !!c));
      })
      .catch(() => setRecent([]));
    return () => ac.abort();
  }, []);

  // Loads one category rail. Called when the rail nears the viewport; force retries a failed one.
  const requestRow = useCallback((id: string, force = false) => {
    if (!force && requested.current.has(id)) return;
    const ac = acRef.current;
    if (!ac) return;
    requested.current.add(id);
    api.channels({ category: [id], hasStream: true, limit: ROW_SIZE, withNow: true, nsfw: nsfwParam() }, ac.signal)
      .then((r) => {
        remember(r.items);
        setRowState((s) => ({ ...s, [id]: { items: r.items, error: false } }));
      })
      .catch(() => {
        if (ac.signal.aborted) { requested.current.delete(id); return; }
        setRowState((s) => ({ ...s, [id]: { items: [], error: true } }));
      });
  }, []);

  // Top categories, one rail each. Only the list is fetched here; each rail fetches its channels.
  // An empty list before the first ingest shows one message instead of empty rails.
  useEffect(() => {
    const ac = acRef.current;
    if (!ac) return;
    api.categories(true)
      .then(async (all) => {
        if (ac.signal.aborted) return;
        if (all.length === 0) {
          const m = await api.meta(ac.signal).catch(() => null);
          if (ac.signal.aborted) return;
          setCatalogPending(m !== null && m.lastIngest === null);
          setCats([]);
          return;
        }
        setCatalogPending(false);
        setCats([...all].sort((a, b) => b.channelCount - a.channelCount).slice(0, TOP_CATEGORIES));
      })
      .catch(() => { if (!ac.signal.aborted) setCatError(true); });
  }, [catKey]);

  // Fresh install: re-check every 15 s until the catalog has been ingested.
  useEffect(() => {
    if (!catalogPending) return;
    const id = window.setInterval(() => setCatKey((k) => k + 1), CATALOG_RETRY_MS);
    return () => window.clearInterval(id);
  }, [catalogPending]);

  const openList = (label: string, items: ChannelSummary[], index: number) => {
    tvList.set({ label, ids: items.map((c) => c.id), index, returnTo: "/tv" });
    nav(`/tv/watch/${encodeURIComponent(items[index].id)}`);
  };

  // Hero: last watched, else first favorite, else the first channel of the biggest rail.
  const firstCat = cats?.[0] ?? null;
  const firstItems = firstCat ? rowState[firstCat.id]?.items ?? null : null;
  const hero: { ch: ChannelSummary; label: string; list: ChannelSummary[]; index: number } | null =
    recent && recent.length > 0 ? { ch: recent[0], label: "Continue watching", list: recent, index: 0 }
    : favItems && favItems.length > 0 ? { ch: favItems[0], label: "From your favorites", list: favItems, index: 0 }
    : firstCat && firstItems && firstItems.length > 0 ? { ch: firstItems[0], label: `Featured · ${firstCat.name}`, list: firstItems, index: 0 }
    : null;

  const rowFor = (label: string, items: ChannelSummary[] | null, id: string, count?: number | null, cta?: { label: string; to: string; icon: JSX.Element }, onRetry?: () => void) => (
    <TvRow key={id} title={label} id={id} count={count}>
      {items === null && <RowPlaceholder text={onRetry ? "Couldn’t load. Press OK to retry" : "Loading…"} onRetry={onRetry} />}
      {items && items.map((c, i) => (
        <ChannelTile key={c.id} ch={c} onOpen={() => openList(label, items, i)} />
      ))}
      {items && cta && <CtaTile label={cta.label} icon={cta.icon} onOpen={() => nav(cta.to)} />}
    </TvRow>
  );

  if (catalogPending) {
    return (
      <div className="tv-scroll" data-testid="tv-home">
        <div className="tv-small tv-row-empty" role="status">
          The channel catalog is still being downloaded — this takes about a minute on a fresh install. This page checks again every 15 seconds.
        </div>
      </div>
    );
  }

  return (
    <div className="tv-scroll" data-testid="tv-home">
      {hero && <Hero {...hero} onPlay={() => openList(hero.label, hero.list, hero.index)} />}

      {favItems && favItems.length > 0
        ? rowFor("Favorites", favItems, "row-fav", favs.length, { label: "All favorites", to: "/tv/browse?fav=1", icon: <IconStar /> })
        : favItems && (
          <TvRow title="Favorites" id="row-fav">
            <CtaTile label="Browse channels and press ★ to add favorites" icon={<IconStar />} onOpen={() => nav("/tv/browse")} />
          </TvRow>
        )}

      {recent && recent.length > 1 && rowFor("Continue watching", recent.slice(1), "row-recent")}

      {cats === null && !catError && <div className="tv-small tv-row-empty">Loading channels…</div>}
      {catError && <div className="tv-small tv-row-empty">Couldn't load categories. Check the connection and press Back to retry.</div>}
      {cats?.map((cat) => {
        const st = rowState[cat.id];
        const failed = st?.error === true;
        return (
          <LazyRail key={cat.id} onNear={() => requestRow(cat.id)}>
            {rowFor(
              cat.name,
              st?.items ?? null,
              `row-${cat.id}`,
              cat.channelCount,
              { label: `All ${cat.name}`, to: `/tv/browse?category=${encodeURIComponent(cat.id)}`, icon: <IconGrid /> },
              failed ? () => requestRow(cat.id, true) : undefined,
            )}
          </LazyRail>
        );
      })}
    </div>
  );
}

function Hero({ ch, label, onPlay }: { ch: ChannelSummary; label: string; list: ChannelSummary[]; index: number; onPlay: () => void }) {
  const nav = useNavigate();
  const badge = qualityBadge(ch.bestQuality);
  const now = ch.now;
  const pct = now ? Math.round(progress(now.start, now.stop, nowTs()) * 100) : null;
  return (
    <section className="tv-hero" aria-label={label}>
      <div className="tv-hero-logo"><ChannelLogo src={ch.logo} name={ch.name} /></div>
      <div className="tv-hero-body">
        <div className="tv-eyebrow">{label}</div>
        <div className="tv-hero-title"><ChannelNo n={ch.number} className="tv-chno-lg" />{ch.name}</div>
        <div className="tv-hero-next">
          {ch.flag ? `${ch.flag} ` : ""}{ch.countryName ?? ""}{ch.categories.length ? ` · ${ch.categories.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(", ")}` : ""}
          {badge && <span className={badge.cls} style={{ marginLeft: "0.6em" }}>{badge.label}</span>}
        </div>
        {now ? (
          <>
            <div className="tv-hero-now">Now: {now.title} · {fmtTime(now.start)}–{fmtTime(now.stop)}</div>
            {pct !== null && <div className="tv-bar" style={{ maxWidth: "60%" }}><div style={{ width: `${pct}%` }} /></div>}
          </>
        ) : (
          <div className="tv-hero-now" style={{ color: "#a1a1aa" }}>Live</div>
        )}
        <div className="tv-hero-actions">
          <button type="button" data-nav tabIndex={0} className="tv-btn tv-btn-primary" onClick={onPlay}><IconPlay /> Watch</button>
          <button type="button" data-nav tabIndex={0} className="tv-btn" onClick={() => nav("/tv/guide")}>Guide</button>
        </div>
      </div>
    </section>
  );
}
