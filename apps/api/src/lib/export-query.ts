import type { Db } from "../db/index.js";
import { planChannels } from "./channel-query.js";
import { parseJsonArray, placeholders, prep } from "./sql.js";

/** Hard cap on channels in one playlist. */
export const PLAYLIST_CAP = 20_000;
const STREAM_CHUNK = 500;
/** Paging/detail params that do not apply to an export. Dropped before planning. */
const NOT_FOR_EXPORT = ["page", "limit", "withNow"] as const;

export interface ExportStream {
  url: string;
  title: string | null;
  userAgent: string | null;
  referrer: string | null;
}

export interface ExportChannel {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
  /** Category display names, in the channel's own order. */
  categories: string[];
  /** Language display names, in the channel's own order. */
  languages: string[];
  /** Streams ordered by idx (idx 0 is the best). */
  streams: ExportStream[];
}

export interface ExportQueryResult {
  channels: ExportChannel[];
  /** True when more than `cap` channels matched and the list was cut. */
  truncated: boolean;
}

interface ChannelRow {
  id: string;
  name: string;
  country: string | null;
  logo_url: string | null;
  categories: string;
  languages: string;
}

interface StreamRow {
  channel: string;
  url: string;
  title: string | null;
  user_agent: string | null;
  referrer: string | null;
}

/**
 * Runs the same filters as GET /api/channels (via planChannels) without paging, forcing
 * hasStream=true, and attaches every stream of each matching channel. Throws HttpError(400)
 * on bad filter values, exactly like /api/channels.
 */
export function loadExportChannels(
  db: Db,
  query: Record<string, unknown>,
  opts: { hideNsfwDefault: boolean; cap?: number },
): ExportQueryResult {
  const params: Record<string, unknown> = { ...query, hasStream: "true" };
  for (const k of NOT_FOR_EXPORT) delete params[k];
  const plan = planChannels(params, {
    hideNsfwDefault: opts.hideNsfwDefault,
    // Same check as /api/channels: the online filter only applies once some stream has been probed.
    hasHealth: () => prep(db, "SELECT 1 FROM streams WHERE status IS NOT NULL LIMIT 1").get() !== undefined,
  });
  const cap = opts.cap ?? PLAYLIST_CAP;

  const rows = prep(
    db,
    `SELECT c.id, c.name, c.country, c.logo_url, c.categories, c.languages
     FROM ${plan.from} ${plan.where} ORDER BY ${plan.orderBy} LIMIT ?`,
  ).all(...plan.args, cap + 1) as ChannelRow[];
  const truncated = rows.length > cap;
  const page = truncated ? rows.slice(0, cap) : rows;
  if (page.length === 0) return { channels: [], truncated };

  const categoryNames = new Map(
    (prep(db, "SELECT id, name FROM categories").all() as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );
  const languageNames = new Map(
    (prep(db, "SELECT code, name FROM languages").all() as Array<{ code: string; name: string }>).map((l) => [l.code, l.name]),
  );

  const byId = new Map<string, ExportChannel>();
  for (const r of page) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      country: r.country,
      logo: r.logo_url,
      categories: parseJsonArray(r.categories).map((id) => categoryNames.get(id) ?? id),
      languages: parseJsonArray(r.languages).map((code) => languageNames.get(code) ?? code),
      streams: [],
    });
  }

  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += STREAM_CHUNK) {
    const chunk = ids.slice(i, i + STREAM_CHUNK);
    const streamRows = prep(
      db,
      `SELECT channel, url, title, user_agent, referrer FROM streams
       WHERE channel IN (${placeholders(chunk.length)}) ORDER BY channel, idx`,
    ).all(...chunk) as StreamRow[];
    for (const s of streamRows) {
      byId.get(s.channel)?.streams.push({
        url: s.url,
        title: s.title,
        userAgent: s.user_agent,
        referrer: s.referrer,
      });
    }
  }

  const channels = [...byId.values()].filter((c) => c.streams.length > 0);
  return { channels, truncated };
}
