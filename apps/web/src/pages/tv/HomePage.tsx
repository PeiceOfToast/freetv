import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Category, type ChannelSummary } from "@/lib/api";
import { useFavorites } from "@/lib/favorites";
import { ChannelTile, TvRow } from "@/components/tv/TvTile";
import { nsfwParam, tvList, tvRecent } from "@/components/tv/tvSettings";

const TOP_CATEGORIES = 6;

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
      .then((r) => setFavItems(r.items))
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
        const byId = new Map(r.items.map((c) => [c.id, c] as const));
        setRecent(ids.map((id) => byId.get(id)).filter((c): c is ChannelSummary => !!c));
      })
      .catch(() => setRecent([]));
    return () => ac.abort();
  }, []);

  // Top categories, one row each, 20 channels with streams.
  useEffect(() => {
    const ac = new AbortController();
    api.categories(true)
      .then(async (cats) => {
        const top = [...cats].sort((a, b) => b.channelCount - a.channelCount).slice(0, TOP_CATEGORIES);
        setRows(top.map((cat) => ({ cat, items: null, error: false })));
        const results = await Promise.all(top.map((cat) =>
          api.channels({ category: [cat.id], hasStream: true, limit: 20, withNow: true, nsfw: nsfwParam() }, ac.signal)
            .then((r) => ({ id: cat.id, items: r.items, error: false }))
            .catch(() => ({ id: cat.id, items: [] as ChannelSummary[], error: true }))));
        setRows(top.map((cat, i) => ({ cat, items: results[i].items, error: results[i].error })));
      })
      .catch(() => setCatError(true));
    return () => ac.abort();
  }, []);

  const openList = (label: string, items: ChannelSummary[], index: number, returnTo: string) => {
    tvList.set({ label, ids: items.map((c) => c.id), index, returnTo });
    nav(`/tv/watch/${encodeURIComponent(items[index].id)}`);
  };

  const rowFor = (label: string, items: ChannelSummary[] | null, empty: string, id: string) => (
    <TvRow key={id} title={label} id={id}>
      {items === null && <div className="tv-small" style={{ padding: 20 }}>Loading…</div>}
      {items && items.length === 0 && <div className="tv-small" style={{ padding: 20 }}>{empty}</div>}
      {items && items.map((c, i) => (
        <ChannelTile key={c.id} ch={c} onOpen={() => openList(label, items, i, "/tv")} />
      ))}
    </TvRow>
  );

  return (
    <div className="tv-scroll" data-testid="tv-home">
      {rowFor("Favorites", favItems, "No favorites yet. Add some from the website or the Browse screen.", "row-fav")}
      {recent && recent.length > 0 && rowFor("Continue watching", recent, "", "row-recent")}
      {rows === null && !catError && <div className="tv-small" style={{ padding: 20 }}>Loading channels…</div>}
      {catError && <div className="tv-small" style={{ padding: 20 }}>Couldn't load categories. Check the connection and press Back to retry.</div>}
      {rows?.map((r) => rowFor(r.cat.name, r.items, r.error ? "Couldn't load this row." : "No channels in this category.", `row-${r.cat.id}`))}
    </div>
  );
}
