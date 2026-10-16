import { getDb, type Db } from "../db/index.js";
import { QUALITY_MIN_RANK } from "./quality.js";
import { badRequest, boolParam, intParam, listParam, qs } from "./http.js";
import { placeholders } from "./sql.js";
import { aliasIndexFor } from "./search-aliases.js";
import { isSearchActive, parseQuery, sanitizeFts, type ParsedQuery } from "./search-parse.js";

export { sanitizeFts };

export const SORTS = ["relevance", "name", "country", "streams", "quality", "updated"] as const;
type Sort = (typeof SORTS)[number];
const DESC_BY_DEFAULT: ReadonlySet<string> = new Set(["streams", "quality", "updated"]);
const MAX_FAVORITES = 500;

// bm25 weights in channels_fts column order: id, name, alt_names, network, owners, country_name, language_names.
// Lower bm25 is a better match, so ORDER BY sorts it ascending.
const BM25 = "bm25(channels_fts, 4.0, 10.0, 6.0, 3.0, 2.0, 1.0, 1.0)";

export interface ChannelPlan {
  /** FROM clause (aliases: c = channels, channels_fts when searching). */
  from: string;
  /** WHERE clause including the keyword, or "". */
  where: string;
  args: unknown[];
  orderBy: string;
  page: number;
  limit: number;
  withNow: boolean;
}

export interface PlanOptions {
  hideNsfwDefault: boolean;
  hasHealth: () => boolean;
  /** DB handle for alias tables (countries, languages, categories). Defaults to the open catalog. */
  db?: Db;
}

function currentDb(): Db | null {
  try {
    return getDb();
  } catch {
    return null;
  }
}

/** Ranks a channel whose name equals the whole query text (1), starts with it (2), or neither (3). */
function nameTier(text: string): string {
  // An expression, not a bare 3: a bare integer in ORDER BY is a column position.
  if (!text) return "(0 + 3)";
  const lit = `'${text.replace(/'/g, "''")}'`;
  const n = [...text].length;
  return `CASE WHEN c.name_sort = ${lit} THEN 1 WHEN substr(c.name_sort, 1, ${n}) = ${lit} THEN 2 ELSE 3 END`;
}

/**
 * Relevance order. With text: exact or prefix name match first, then channels with streams, then bm25,
 * then guide and stream count as tie-breakers. Without text (category or quality only): streams, guide,
 * stream count.
 */
function relevanceOrder(parsed: ParsedQuery, hasMatch: boolean, orderRaw: string | undefined): string {
  if (!hasMatch) {
    const dir = orderRaw === "asc" ? "ASC" : "DESC";
    return `${nameTier(parsed.nameText)} ASC, c.has_stream DESC, (c.guide_count > 0) DESC, c.stream_count ${dir}, c.name_sort, c.id`;
  }
  const bmDir = orderRaw === "desc" ? "DESC" : "ASC";
  return `${nameTier(parsed.nameText)} ASC, c.has_stream DESC, ${BM25} ${bmDir}, (c.guide_count > 0) DESC, c.stream_count DESC, c.name_sort, c.id`;
}

/**
 * Parses the /api/channels query string into a SQL plan. Throws HttpError(400) on bad values.
 * `hasHealth` is only called when `online=true` is requested.
 */
export function planChannels(query: Record<string, unknown>, opts: PlanOptions): ChannelPlan {
  const where: string[] = [];
  const args: unknown[] = [];

  const rawQ = qs(query.q);
  const parsed: ParsedQuery | null =
    rawQ !== undefined ? parseQuery(rawQ, aliasIndexFor(opts.db ?? currentDb())) : null;
  const searching = parsed !== null && isSearchActive(parsed);
  const match = parsed?.match ?? null;
  const from = match ? "channels_fts JOIN channels c ON c.id = channels_fts.id" : "channels c";
  if (match) {
    where.push("channels_fts MATCH ?");
    args.push(match);
  }

  // Category words in the query filter the list (any of them); the remaining text is matched.
  if (parsed && parsed.categories.length) {
    where.push(
      `c.id IN (SELECT channel FROM channel_categories WHERE category IN (${placeholders(parsed.categories.length)}))`,
    );
    args.push(...parsed.categories);
  }

  if (boolParam(qs(query.hasStream), "hasStream", true)) where.push("c.has_stream = 1");

  const nsfw = boolParam(qs(query.nsfw), "nsfw", !opts.hideNsfwDefault);
  if (!nsfw) where.push("c.is_nsfw = 0 AND c.blocked = 0");

  const categories = (listParam(qs(query.category)) ?? []).map((s) => s.toLowerCase());
  if (categories.length) {
    where.push(`c.id IN (SELECT channel FROM channel_categories WHERE category IN (${placeholders(categories.length)}))`);
    args.push(...categories);
  }

  const countries = (listParam(qs(query.country)) ?? []).map((s) => s.toUpperCase());
  if (countries.length) {
    where.push(`c.country IN (${placeholders(countries.length)})`);
    args.push(...countries);
  }

  const languages = (listParam(qs(query.language)) ?? []).map((s) => s.toLowerCase());
  if (languages.length) {
    where.push(`c.id IN (SELECT channel FROM channel_languages WHERE language IN (${placeholders(languages.length)}))`);
    args.push(...languages);
  }

  if (boolParam(qs(query.online), "online", false) && opts.hasHealth()) {
    where.push("c.online_count > 0");
  }

  // The `quality` param and a quality word in `q` both set a minimum; the stricter one wins.
  let minRank = 0;
  const qualityRaw = qs(query.quality)?.trim().toLowerCase();
  if (qualityRaw) {
    const r = QUALITY_MIN_RANK[qualityRaw];
    if (r === undefined) throw badRequest(`quality must be one of ${Object.keys(QUALITY_MIN_RANK).join(", ")}`);
    minRank = r;
  }
  if (parsed?.quality) minRank = Math.max(minRank, QUALITY_MIN_RANK[parsed.quality] ?? 0);
  if (minRank > 0) {
    where.push("c.quality_rank >= ?");
    args.push(minRank);
  }

  // browser = channels with a browser-playable stream; app = channels with streams and none browser-playable (incl. unknown).
  const playableRaw = qs(query.playable)?.trim().toLowerCase();
  if (playableRaw === "browser") where.push("c.browser_count > 0");
  else if (playableRaw === "app") where.push("c.has_stream = 1 AND c.browser_count = 0");
  else if (playableRaw !== undefined && playableRaw !== "" && playableRaw !== "any") {
    throw badRequest("playable must be browser, app or any");
  }

  const favorites = listParam(qs(query.favorites));
  if (favorites !== undefined) {
    if (favorites.length > MAX_FAVORITES) throw badRequest(`favorites accepts at most ${MAX_FAVORITES} ids`);
    // An empty list (favorites=) means "none of these", so it matches nothing.
    where.push(favorites.length ? `c.id IN (${placeholders(favorites.length)})` : "0");
    args.push(...favorites);
  }

  const sortRaw = qs(query.sort)?.trim().toLowerCase();
  if (sortRaw !== undefined && sortRaw !== "" && !(SORTS as readonly string[]).includes(sortRaw)) {
    throw badRequest(`sort must be one of ${SORTS.join(", ")}`);
  }
  let sort: Sort = (sortRaw || (searching ? "relevance" : "name")) as Sort;
  if (sort === "relevance" && !searching) sort = "name";

  const orderRaw = qs(query.order)?.trim().toLowerCase();
  if (orderRaw !== undefined && orderRaw !== "" && orderRaw !== "asc" && orderRaw !== "desc") {
    throw badRequest("order must be asc or desc");
  }
  const dir = orderRaw ? orderRaw.toUpperCase() : DESC_BY_DEFAULT.has(sort) ? "DESC" : "ASC";

  const orderBy = (() => {
    switch (sort) {
      case "relevance":
        return relevanceOrder(parsed ?? { match: null, nameText: "", categories: [], quality: null }, match !== null, orderRaw || undefined);
      case "country":
        return `(c.country IS NULL) ASC, c.country ${dir}, c.name_sort, c.id`;
      case "streams":
        return `c.stream_count ${dir}, c.name_sort, c.id`;
      case "quality":
        return `c.quality_rank ${dir}, c.name_sort, c.id`;
      case "updated":
        // channels.last_checked is kept current by ingest and by the prober's result apply (schema v4).
        return `COALESCE(c.last_checked, 0) ${dir}, c.name_sort, c.id`;
      default:
        return `c.name_sort ${dir}, c.id`;
    }
  })();

  const page = intParam(qs(query.page), "page", 1, 1);
  const limit = Math.min(200, intParam(qs(query.limit), "limit", 60, 1));

  return {
    from,
    where: where.length ? `WHERE ${where.join(" AND ")}` : "",
    args,
    orderBy,
    page,
    limit,
    withNow: boolParam(qs(query.withNow), "withNow", false),
  };
}
