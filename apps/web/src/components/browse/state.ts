// URL search params are the single source of truth for the browse page.
// Defaults are omitted from the URL so shared links stay short.
import type { ChannelQuery, SortKey } from "@/lib/api";

export const PAGE_SIZE = 60;

export type Quality = "sd" | "720p" | "1080p" | "2160p";
export const QUALITY_OPTIONS: { value: Quality | ""; label: string }[] = [
  { value: "", label: "Any" },
  { value: "sd", label: "SD+" },
  { value: "720p", label: "720p+" },
  { value: "1080p", label: "1080p+" },
  { value: "2160p", label: "4K" },
];

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "name", label: "Name" },
  { value: "country", label: "Country" },
  { value: "streams", label: "Streams" },
  { value: "quality", label: "Quality" },
];

const SORT_KEYS = new Set<string>(SORT_OPTIONS.map((o) => o.value));
const QUALITIES = new Set<string>(["sd", "720p", "1080p", "2160p"]);

export interface BrowseState {
  q: string;
  category: string[];
  country: string[];
  language: string[];
  quality: Quality | "";
  hasStream: boolean;
  online: boolean;
  nsfw: boolean;
  favorites: boolean;
  /** Explicit sort from the URL, or null when the default applies. */
  sort: SortKey | null;
  /** Explicit order from the URL, or null when the default applies. */
  order: "asc" | "desc" | null;
  page: number;
}

export const EMPTY_STATE: BrowseState = {
  q: "", category: [], country: [], language: [], quality: "",
  hasStream: true, online: false, nsfw: false, favorites: false,
  sort: null, order: null, page: 1,
};

const csv = (v: string | null) => (v ? [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))] : []);
const flag = (v: string | null) => v === "1" || v === "true";

export function parseState(params: URLSearchParams): BrowseState {
  const sortRaw = params.get("sort");
  const orderRaw = params.get("order");
  const qualityRaw = params.get("quality");
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    q: (params.get("q") ?? "").trim(),
    category: csv(params.get("category")),
    country: csv(params.get("country")).map((c) => c.toUpperCase()),
    language: csv(params.get("language")),
    quality: qualityRaw && QUALITIES.has(qualityRaw) ? (qualityRaw as Quality) : "",
    hasStream: params.has("hasStream") ? flag(params.get("hasStream")) : true,
    online: flag(params.get("online")),
    nsfw: flag(params.get("nsfw")),
    favorites: flag(params.get("favorites")),
    sort: sortRaw && SORT_KEYS.has(sortRaw) ? (sortRaw as SortKey) : null,
    order: orderRaw === "asc" || orderRaw === "desc" ? orderRaw : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Serialize a state into params, writing only non-default values. */
export function buildParams(s: BrowseState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.category.length) p.set("category", s.category.join(","));
  if (s.country.length) p.set("country", s.country.join(","));
  if (s.language.length) p.set("language", s.language.join(","));
  if (s.quality) p.set("quality", s.quality);
  if (!s.hasStream) p.set("hasStream", "0");
  if (s.online) p.set("online", "1");
  if (s.nsfw) p.set("nsfw", "1");
  if (s.favorites) p.set("favorites", "1");
  if (s.sort) p.set("sort", s.sort);
  if (s.order) p.set("order", s.order);
  if (s.page > 1) p.set("page", String(s.page));
  return p;
}

/** The sort in effect: explicit choice, else relevance while searching, else name. */
export function effectiveSort(s: BrowseState): SortKey {
  if (s.sort === "relevance" && !s.q) return "name";
  return s.sort ?? (s.q ? "relevance" : "name");
}

export function defaultOrder(sort: SortKey): "asc" | "desc" {
  return sort === "streams" || sort === "quality" || sort === "updated" ? "desc" : "asc";
}

export function effectiveOrder(s: BrowseState): "asc" | "desc" {
  return s.order ?? defaultOrder(effectiveSort(s));
}

export function hasActiveFilters(s: BrowseState): boolean {
  return Boolean(
    s.q || s.category.length || s.country.length || s.language.length || s.quality ||
    !s.hasStream || s.online || s.nsfw || s.favorites,
  );
}

/** Build the API query for the current state. */
export function toChannelQuery(s: BrowseState, favoriteIds: string[]): ChannelQuery {
  const sort = effectiveSort(s);
  return {
    q: s.q || undefined,
    category: s.category.length ? s.category : undefined,
    country: s.country.length ? s.country : undefined,
    language: s.language.length ? s.language : undefined,
    quality: s.quality || undefined,
    hasStream: s.hasStream,
    online: s.online,
    nsfw: s.nsfw,
    favorites: s.favorites ? favoriteIds : undefined,
    sort,
    order: effectiveOrder(s),
    page: s.page,
    limit: PAGE_SIZE,
    withNow: true,
  };
}

/** Number of sidebar filters in use (the search text is not counted). */
export function activeFilterCount(s: BrowseState): number {
  return (
    s.category.length + s.country.length + s.language.length +
    (s.quality ? 1 : 0) + (s.hasStream ? 0 : 1) + (s.online ? 1 : 0) +
    (s.nsfw ? 1 : 0) + (s.favorites ? 1 : 0)
  );
}
