import type { Db } from "../db/index.js";
import { planChannels } from "./channel-query.js";
import { prep } from "./sql.js";
import { aliasIndexFor } from "./search-aliases.js";
import { isSearchActive, parseQuery } from "./search-parse.js";

export interface Suggestion {
  id: string;
  name: string;
  countryName: string | null;
  logo: string | null;
}

/**
 * Top channels for a partial query, ranked exactly as GET /api/channels ranks `q` (same parser, same
 * filters, same order), with NSFW and blocked channels and channels without streams left out.
 * Returns [] for blank or punctuation-only input, so an empty box never lists the whole catalog.
 * Not wired to a route yet; a future GET /api/suggest can call this directly.
 */
export function suggest(db: Db, q: string, limit = 8): Suggestion[] {
  const n = Math.max(1, Math.min(20, Math.floor(limit)));
  if (!isSearchActive(parseQuery(q, aliasIndexFor(db)))) return [];
  const plan = planChannels(
    { q, limit: String(n) },
    { hideNsfwDefault: true, hasHealth: () => false, db },
  );
  const rows = prep(
    db,
    `SELECT c.id, c.name, co.name AS country_name, c.logo_url AS logo FROM ${plan.from}
     LEFT JOIN countries co ON co.code = c.country ${plan.where} ORDER BY ${plan.orderBy} LIMIT ?`,
  ).all(...plan.args, plan.limit) as Array<{ id: string; name: string; country_name: string | null; logo: string | null }>;
  return rows.map((r) => ({ id: r.id, name: r.name, countryName: r.country_name, logo: r.logo }));
}
