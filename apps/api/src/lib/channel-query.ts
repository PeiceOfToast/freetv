import { QUALITY_MIN_RANK } from "./quality.js";
import { badRequest, boolParam, intParam, listParam, qs } from "./http.js";
import { placeholders } from "./sql.js";

export const SORTS = ["relevance", "name", "country", "streams", "quality", "updated"] as const;
type Sort = (typeof SORTS)[number];
const DESC_BY_DEFAULT: ReadonlySet<string> = new Set(["streams", "quality", "updated"]);
const MAX_FAVORITES = 500;
const MAX_TOKENS = 12;
const MAX_TOKEN_LEN = 64;

/**
 * Turns free text into an FTS5 MATCH expression: each token is quoted (so FTS operators in user
 * input are literal), the last token gets a prefix `*`, and juxtaposed terms are ANDed.
 * Returns null when nothing searchable is left (punctuation only, or blank).
 */
export function sanitizeFts(input: string): string | null {
  const tokens = input
    .split(/\s+/)
    .map((t) => t.slice(0, MAX_TOKEN_LEN).replace(/"/g, ""))
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, MAX_TOKENS);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => `"${t}"${i === tokens.length - 1 ? "*" : ""}`).join(" ");
}

// bm25 column weights in channels_fts order: id (unindexed), name, alt_names, network, owners, country_name
const BM25 = "bm25(channels_fts, 0.0, 10.0, 4.0, 3.0, 2.0, 1.0)";

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

/**
 * Parses the /api/channels query string into a SQL plan. Throws HttpError(400) on bad values.
 * `hasHealth` is only called when `online=true` is requested.
 */
export function planChannels(
  query: Record<string, unknown>,
  opts: { hideNsfwDefault: boolean; hasHealth: () => boolean },
): ChannelPlan {
  const where: string[] = [];
  const args: unknown[] = [];

  const rawQ = qs(query.q);
  const fts = rawQ !== undefined ? sanitizeFts(rawQ) : null;
  const from = fts
    ? "channels_fts JOIN channels c ON c.id = channels_fts.id"
    : "channels c";
  if (fts) {
    where.push("channels_fts MATCH ?");
    args.push(fts);
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

  const qualityRaw = qs(query.quality)?.trim().toLowerCase();
  if (qualityRaw) {
    const minRank = QUALITY_MIN_RANK[qualityRaw];
    if (minRank === undefined) throw badRequest(`quality must be one of ${Object.keys(QUALITY_MIN_RANK).join(", ")}`);
    where.push("c.quality_rank >= ?");
    args.push(minRank);
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
  let sort: Sort = (sortRaw || (fts ? "relevance" : "name")) as Sort;
  if (sort === "relevance" && !fts) sort = "name";

  const orderRaw = qs(query.order)?.trim().toLowerCase();
  if (orderRaw !== undefined && orderRaw !== "" && orderRaw !== "asc" && orderRaw !== "desc") {
    throw badRequest("order must be asc or desc");
  }
  const dir = orderRaw ? orderRaw.toUpperCase() : DESC_BY_DEFAULT.has(sort) ? "DESC" : "ASC";

  const orderBy = (() => {
    switch (sort) {
      case "relevance":
        return `${BM25} ${dir}, c.name_sort, c.id`;
      case "country":
        return `(c.country IS NULL) ASC, c.country ${dir}, c.name_sort, c.id`;
      case "streams":
        return `c.stream_count ${dir}, c.name_sort, c.id`;
      case "quality":
        return `c.quality_rank ${dir}, c.name_sort, c.id`;
      case "updated":
        return `COALESCE((SELECT MAX(s.last_checked) FROM streams s WHERE s.channel = c.id), 0) ${dir}, c.name_sort, c.id`;
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
