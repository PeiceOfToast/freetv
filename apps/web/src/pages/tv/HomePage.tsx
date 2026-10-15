import { useEffect, useState } from "react";
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

interface CatRow { cat: Category; items: ChannelSummary[] | null; error: boolean }

export default function HomePage() {
  const nav = useNavigate();
  const favs = useFavorites();
  const [favItems, setFavItems] = useState<ChannelSummary[] | null>(null);
  const [recent, setRecent] = useState<ChannelSummary[] | null>(null);
  const [rows, setRows] = useState<CatRow[] | null>(null);
  const [catError, setCatError] = useState(false);

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

  // Top categories, one row each.
  useEffect(() => {
    const ac = new AbortController();
    api.categories(true)
      .then(async (cats) => {
        const top = [...cats].sort((a, b) => b.channelCount - a.channelCount).slice(0, TOP_CATEGORIES);
        setRows(top.map((cat) => ({ cat, items: null, error: false })));
        const results = await Promise.all(top.map((cat) =>
          api.channels({ category: [cat.id], hasStream: true, limit: ROW_SIZE, withNow: true, nsfw: nsfwParam() }, ac.signal)
            .then((r) => { remember(r.items); return { id: cat.id, items: r.items, error: false }; })
            .catch(() => ({ id: cat.id, items: [] as ChannelSummary[], error: true }))));
        setRows(top.map((cat, i) => ({ cat, items: results[i].items, error: results[i].error })));
      })
      .catch(() => setCatError(true));
    return () => ac.abort();
  }, []);

  const openList = (label: string, items: ChannelSummary[], index: number) => {
    tvList.set({ label, ids: items.map((c) => c.id), index, returnTo: "/tv" });
    nav(`/tv/watch/${encodeURIComponent(items[index].id)}`);
  };

  // Hero: last watched, else first favorite, else the first channel of the biggest row.
  const hero: { ch: ChannelSummary; label: string; list: ChannelSummary[]; index: number } | null =
    recent && recent.length > 0 ? { ch: recent[0], label: "Continue watching", list: recent, index: 0 }
    : favItems && favItems.length > 0 ? { ch: favItems[0], label: "From your favorites", list: favItems, index: 0 }
    : rows && rows[0]?.items && rows[0].items.length > 0 ? { ch: rows[0].items[0], label: `Featured · ${rows[0].cat.name}`, list: rows[0].items, index: 0 }
    : null;

  const rowFor = (label: string, items: ChannelSummary[] | null, id: string, count?: number | null, cta?: { label: string; to: string; icon: JSX.Element }) => (
    <TvRow key={id} title={label} id={id} count={count}>
      {items === null && <div className="tv-small tv-row-empty">Loading…</div>}
      {items && items.map((c, i) => (
        <ChannelTile key={c.id} ch={c} onOpen={() => openList(label, items, i)} />
      ))}
      {items && cta && <CtaTile label={cta.label} icon={cta.icon} onOpen={() => nav(cta.to)} />}
    </TvRow>
  );

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

      {rows === null && !catError && <div className="tv-small tv-row-empty">Loading channels…</div>}
      {catError && <div className="tv-small tv-row-empty">Couldn't load categories. Check the connection and press Back to retry.</div>}
      {rows?.map((r) =>
        rowFor(r.cat.name, r.items, `row-${r.cat.id}`, r.cat.channelCount, { label: `All ${r.cat.name}`, to: `/tv/browse?category=${encodeURIComponent(r.cat.id)}`, icon: <IconGrid /> }),
      )}
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
