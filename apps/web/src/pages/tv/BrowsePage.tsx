import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, type ChannelSummary, type Category, type Country } from "@/lib/api";
import { useFavorites } from "@/lib/favorites";
import { ChannelTile } from "@/components/tv/TvTile";
import { OnScreenKeyboard } from "@/components/tv/OnScreenKeyboard";
import { nsfwParam, tvList, tvRecent } from "@/components/tv/tvSettings";
import { remember } from "@/components/tv/numbers";

const PAGE = 48;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function BrowsePage() {
  const nav = useNavigate();
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const country = params.get("country") ?? "";
  const fav = params.get("fav") === "1";
  const recent = params.get("recent") === "1";
  const searchMode = params.get("search") === "1";
  const favs = useFavorites();
  const recentIds = recent ? tvRecent.list() : [];

  const [cats, setCats] = useState<Category[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [letter, setLetter] = useState<string>("A");

  const [q, setQ] = useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [items, setItems] = useState<ChannelSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    api.categories(true).then(setCats).catch(() => setCats([]));
    api.countries(true).then(setCountries).catch(() => setCountries([]));
    return () => ac.abort();
  }, []);

  // Search: debounce typed text, mirror it into the URL so Back restores it.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  // Reset to page 1 whenever a filter changes.
  const filterKey = [category, country, fav ? favs.join(",") : "", recent ? recentIds.join(",") : "", searchMode ? debouncedQ : ""].join("|");
  useEffect(() => { setPage(1); }, [filterKey]);

  const showEmptyFav = fav && favs.length === 0;
  const showEmptyRecent = recent && recentIds.length === 0;

  useEffect(() => {
    if (showEmptyFav || showEmptyRecent) { setItems([]); setTotal(0); return; }
    const ac = new AbortController();
    setLoading(true);
    setError(false);
    api.channels({
      category: category ? [category] : undefined,
      country: country ? [country] : undefined,
      favorites: recent ? recentIds : fav ? favs : undefined,
      q: searchMode && debouncedQ ? debouncedQ : undefined,
      sort: searchMode && debouncedQ ? "relevance" : "name",
      withNow: true,
      nsfw: nsfwParam(),
      limit: PAGE,
      page,
    }, ac.signal)
      .then((r) => {
        remember(r.items);
        if (recent) {
          // Recently watched: the API returns name order, so put them back in watch order.
          const byId = new Map(r.items.map((c) => [c.id, c] as const));
          const ordered = recentIds.map((x) => byId.get(x)).filter((c): c is ChannelSummary => !!c);
          setTotal(ordered.length);
          setItems(ordered);
          return;
        }
        setTotal(r.total);
        setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
      })
      .catch(() => { if (!ac.signal.aborted) setError(true); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page]);

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k); else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const setQuery = (v: string) => { setQ(v); setFilter({ q: v || null }); };
  // Category and "All" leave the recently-watched view; Recently watched clears the category.
  const setCategory = (id: string | null) => setFilter({ category: id, recent: null });

  const countriesForLetter = useMemo(
    () => countries.filter((c) => c.name.toUpperCase().startsWith(letter)),
    [countries, letter],
  );

  const open = (i: number) => {
    const label = searchMode ? `Search: ${debouncedQ}` : fav ? "Favorites" : recent ? "Recently watched" : category ? `Category: ${category}` : "Browse";
    tvList.set({ label, ids: items.map((c) => c.id), index: i, returnTo: loc.pathname + loc.search });
    nav(`/tv/watch/${encodeURIComponent(items[i].id)}`);
  };

  const hasMore = items.length < total;
  const title = fav ? "Favorites" : recent ? "Recently watched" : searchMode ? "Search" : category ? (cats.find((c) => c.id === category)?.name ?? "Browse") : "Browse";

  const grid = (
    <>
      <h1 className="tv-h1">{title}{!loading && !error ? <span className="tv-small"> · {total} channels</span> : null}</h1>
      {showEmptyFav && <div className="tv-small">No favorites yet. Add some from the website, then they appear here.</div>}
      {showEmptyRecent && <div className="tv-small">Nothing watched yet. Channels you open appear here.</div>}
      {error && <div className="tv-small">Couldn't load channels. Press Back and try again.</div>}
      <div className="tv-grid">
        {items.map((c, i) => (
          <ChannelTile key={c.id} ch={c} onOpen={() => open(i)} />
        ))}
        {hasMore && (
          <button type="button" data-nav tabIndex={0} className="tv-tile" onClick={() => setPage((p) => p + 1)} disabled={loading}>
            <div className="tv-tile-logo"><span>{loading ? "…" : "+"}</span></div>
            <div className="tv-tile-name">{loading ? "Loading…" : "Load more"}</div>
            <div className="tv-tile-meta">{items.length} of {total}</div>
          </button>
        )}
      </div>
      {!loading && !error && items.length === 0 && !showEmptyFav && !showEmptyRecent && (
        <div className="tv-small" style={{ marginTop: 20 }}>No channels match.</div>
      )}
    </>
  );

  return (
    <div className="tv-scroll">
      <div className="tv-chips" role="group" aria-label="Categories">
        <button type="button" data-nav tabIndex={0} className="tv-chip" aria-pressed={recent}
          onClick={() => setFilter({ recent: recent ? null : "1", category: null })}>Recently watched</button>
        <button type="button" data-nav tabIndex={0} className="tv-chip" aria-pressed={!category && !recent}
          onClick={() => setCategory(null)}>All</button>
        {cats.map((c) => (
          <button key={c.id} type="button" data-nav tabIndex={0} className="tv-chip" aria-pressed={category === c.id && !recent}
            onClick={() => setCategory(c.id)}>{c.name}</button>
        ))}
      </div>

      {!fav && !recent && !searchMode && (
        <>
          <div className="tv-chips" role="group" aria-label="Countries by letter">
            {LETTERS.map((l) => (
              <button key={l} type="button" data-nav tabIndex={0} className="tv-chip" aria-pressed={letter === l}
                onClick={() => setLetter(l)}>{l}</button>
            ))}
          </div>
          <div className="tv-chips" role="group" aria-label="Countries">
            <button type="button" data-nav tabIndex={0} className="tv-chip" aria-pressed={!country}
              onClick={() => setFilter({ country: null })}>Any country</button>
            {countriesForLetter.map((c) => (
              <button key={c.code} type="button" data-nav tabIndex={0} className="tv-chip" aria-pressed={country === c.code}
                onClick={() => setFilter({ country: c.code })}>{c.flag ? `${c.flag} ` : ""}{c.name}</button>
            ))}
          </div>
        </>
      )}

      {searchMode ? (
        <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
          <div style={{ width: 560, flexShrink: 0 }}>
            <OnScreenKeyboard value={q} onChange={setQuery} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>{grid}</div>
        </div>
      ) : grid}
    </div>
  );
}
