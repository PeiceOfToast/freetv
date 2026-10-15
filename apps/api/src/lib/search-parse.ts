import { QUALITY_MIN_RANK } from "./quality.js";
import { EMPTY_ALIASES, QUALITY_WORDS, fold, type AliasHit, type AliasIndex } from "./search-aliases.js";

/** Words dropped from the text when the query has other words too ("the bbc" -> "bbc"). */
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "channel", "channels", "watch"]);
const MAX_TOKENS = 12;
const MAX_TOKEN_LEN = 64;

export interface ParsedQuery {
  /** FTS5 MATCH expression, or null when no text is left to match. Built only from [letters digits] and spaces. */
  match: string | null;
  /** Text left after aliases and filters are removed: folded, space-separated. Used for whole-name ranking. */
  nameText: string;
  /** Category ids named in the query. Channels must be in at least one of them. */
  categories: string[];
  /** Minimum quality key ("720p", "1080p", "2160p") named in the query, or null. */
  quality: string | null;
}

/** `exact` plain alternatives match the whole token only (used for two-letter codes, so "de" is not "deluxe"). */
type Alt = { plain: string; exact?: boolean } | { col: "country_name" | "language_names"; value: string };
interface Unit {
  alts: Alt[];
  text: string;
  stop: boolean;
}

/** True when a parsed query has anything to search or filter on. */
export const isSearchActive = (p: ParsedQuery): boolean =>
  p.match !== null || p.categories.length > 0 || p.quality !== null;

const plainUnit = (f: string): Unit => {
  const pieces = f.match(/\p{L}+|\p{N}+/gu) ?? [f];
  const spaced = pieces.join(" ");
  const alts: Alt[] = [{ plain: f }];
  if (spaced !== f) alts.push({ plain: spaced });
  return { alts, text: spaced, stop: STOPWORDS.has(f) };
};

const aliasUnit = (key: string, hit: AliasHit): Unit => {
  const alts: Alt[] = [{ plain: key }];
  if (hit.country) alts.push({ col: "country_name", value: hit.country });
  if (hit.language) alts.push({ col: "language_names", value: hit.language });
  return { alts, text: key, stop: false };
};

function render(alt: Alt, prefix: boolean): string {
  if ("plain" in alt) return `"${alt.plain}"${prefix && !alt.exact ? "*" : ""}`;
  return `${alt.col} : "${alt.value.replace(/"/g, "")}"`;
}

/**
 * Parses free text for /api/channels `q`. Never throws, and never passes FTS5 syntax through: the only
 * characters that reach the MATCH string are letters, digits, spaces and the fixed FTS keywords this
 * function writes. The last word gets a prefix match; a single-word language code ("es") and an
 * uppercase country code ("DE") are expanded; category words and quality words become filters.
 */
export function parseQuery(raw: string, idx: AliasIndex = EMPTY_ALIASES): ParsedQuery {
  const tokens = (raw.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TOKENS).map((t) => t.slice(0, MAX_TOKEN_LEN));
  const categories: string[] = [];
  let quality: string | null = null;
  let qualityRank = 0;
  // `units` become the MATCH. `names` also keeps category words, so "news 24" ranks "News 24" first.
  const units: Unit[] = [];
  const names: Unit[] = [];
  const add = (u: Unit) => {
    units.push(u);
    names.push(u);
  };
  const oneWord = tokens.length === 1;

  let i = 0;
  while (i < tokens.length) {
    // Multi-word country and language names, longest first ("south africa", "dominican republic").
    let spanHit: { n: number; key: string; hit: AliasHit } | null = null;
    for (let n = Math.min(idx.maxSpan, tokens.length - i); n >= 2 && !spanHit; n--) {
      const key = fold(tokens.slice(i, i + n).join(" "));
      const hit = idx.spans.get(key);
      if (hit) spanHit = { n, key, hit };
    }
    if (spanHit) {
      add(aliasUnit(spanHit.key, spanHit.hit));
      i += spanHit.n;
      continue;
    }

    const t = tokens[i] ?? "";
    const f = fold(t);
    i++;

    const q = QUALITY_WORDS[f];
    if (q) {
      const rank = QUALITY_MIN_RANK[q] ?? 0;
      if (rank > qualityRank) {
        qualityRank = rank;
        quality = q;
      }
      continue;
    }

    const cat = idx.categories.get(f);
    if (cat) {
      if (!categories.includes(cat)) categories.push(cat);
      names.push({ alts: [], text: f, stop: false });
      continue;
    }

    const single = idx.spans.get(f);
    if (single) {
      add(aliasUnit(f, single));
      continue;
    }

    // Two-letter code: "DE", "US" (country, any query), or "es" alone (country and language).
    // Lowercase codes in a longer query stay plain words, so "cnn en espanol" is still a name.
    if (t.length === 2) {
      const upper = t === t.toUpperCase();
      const country = upper || oneWord ? idx.countryByCode.get(t.toUpperCase()) : undefined;
      const language = !upper && oneWord ? idx.languageByCode1.get(f) : undefined;
      if (country || language) {
        const alts: Alt[] = [{ plain: f, exact: true }];
        if (country) alts.push({ col: "country_name", value: country });
        if (language) alts.push({ col: "language_names", value: language });
        add({ alts, text: f, stop: false });
        continue;
      }
    }

    add(plainUnit(f));
  }

  const keep = (list: Unit[]) => (list.some((u) => !u.stop) ? list.filter((u) => !u.stop) : list);
  const content = keep(units);
  const nameText = keep(names).map((u) => u.text).join(" ");
  if (content.length === 0) return { match: null, nameText, categories, quality };

  const match = content
    .map((u, k) => {
      const last = k === content.length - 1;
      const body = u.alts.map((a) => render(a, last)).join(" OR ");
      return u.alts.length > 1 ? `(${body})` : body;
    })
    // Explicit AND: FTS5 rejects implicit AND after a parenthesised group.
    .join(" AND ");
  return { match, nameText, categories, quality };
}

/** FTS MATCH expression for `q` with no alias tables. Kept for callers that only need the text match. */
export function sanitizeFts(input: string): string | null {
  return parseQuery(input, EMPTY_ALIASES).match;
}

