// Rebuilds the catalog tables from the raw iptv-org JSON files, inside ONE transaction.
// Pure derivation happens before the transaction opens; the transaction only writes.
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/index.js";
import { qualityRank } from "../lib/quality.js";

export const DATASETS = [
  "channels",
  "feeds",
  "streams",
  "categories",
  "countries",
  "languages",
  "guides",
  "logos",
  "blocklist",
] as const;
export type DatasetName = (typeof DATASETS)[number];

// Only the fields we use from each dataset.
export interface RawChannel {
  id: string;
  name: string;
  alt_names?: string[] | null;
  network?: string | null;
  owners?: string[] | null;
  country?: string | null;
  categories?: string[] | null;
  is_nsfw?: boolean | null;
  launched?: string | null;
  closed?: string | null;
  replaced_by?: string | null;
  website?: string | null;
}
export interface RawFeed {
  channel: string;
  id: string;
  name?: string | null;
  is_main?: boolean | null;
  broadcast_area?: string[] | null;
  timezones?: string[] | null;
  languages?: string[] | null;
  format?: string | null;
}
export interface RawStream {
  channel: string | null;
  feed: string | null;
  title?: string | null;
  url: string;
  quality?: string | null;
  labels?: string[] | null;
  user_agent?: string | null;
  referrer?: string | null;
}
export interface RawCategory {
  id: string;
  name: string;
  description?: string | null;
}
export interface RawCountry {
  name: string;
  code: string;
  languages?: string[] | null;
  flag?: string | null;
}
export interface RawLanguage {
  code: string;
  name: string;
}
export interface RawGuide {
  channel: string;
  feed?: string | null;
  site: string;
  site_id: string;
  lang?: string | null;
}
export interface RawLogo {
  channel: string;
  feed?: string | null;
  in_use?: boolean | null;
  url: string;
}
export interface RawBlocked {
  channel: string;
}

export interface RawDatasets {
  channels: RawChannel[];
  feeds: RawFeed[];
  streams: RawStream[];
  categories: RawCategory[];
  countries: RawCountry[];
  languages: RawLanguage[];
  guides: RawGuide[];
  logos: RawLogo[];
  blocklist: RawBlocked[];
}

export interface BuildStats {
  channels: number;
  channelsWithStreams: number;
  blockedChannels: number;
  streams: number;
  streamsSkipped: number;
  feeds: number;
  guides: number;
  categories: number;
  countries: number;
  languages: number;
  durationMs: number;
}

/** Reads all nine dataset files from rawDir. Throws if one is missing or not a JSON array. */
export function readDatasets(rawDir: string): RawDatasets {
  const read = <T>(name: DatasetName): T[] => {
    const file = path.join(rawDir, `${name}.json`);
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(value)) throw new Error(`${file} is not a JSON array`);
    return value as T[];
  };
  return {
    channels: read("channels"),
    feeds: read("feeds"),
    streams: read("streams"),
    categories: read("categories"),
    countries: read("countries"),
    languages: read("languages"),
    guides: read("guides"),
    logos: read("logos"),
    blocklist: read("blocklist"),
  };
}

const feedKey = (channel: string, feed: string) => `${channel}\u0000${feed}`;

export function readLocalBlocklist(file = process.env.LOCAL_BLOCKLIST ?? path.join(process.env.DATA_DIR ?? "/data", "local-blocklist.json")): string[] {
  try {
    if (!fs.existsSync(file)) return [];
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(v)) return [];
    return v.map((x) => (typeof x === "string" ? x : (x as { channel?: string })?.channel)).filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

/** lowercase, diacritics stripped: used for name ordering. */
export function nameSort(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

interface Tally {
  channels: number;
  streams: number;
}
function tally(m: Map<string, Tally>, key: string, hasStream: boolean) {
  let t = m.get(key);
  if (!t) m.set(key, (t = { channels: 0, streams: 0 }));
  t.channels++;
  if (hasStream) t.streams++;
}

interface ChannelRow {
  id: string;
  name: string;
  alt_names: string[];
  network: string | null;
  owners: string[];
  country: string | null;
  categories: string[];
  languages: string[];
  broadcast_area: string[];
  is_nsfw: number;
  blocked: number;
  launched: string | null;
  closed: string | null;
  replaced_by: string | null;
  website: string | null;
  logo_url: string | null;
  stream_count: number;
  has_stream: number;
  best_quality: string | null;
  quality_rank: number;
  guide_count: number;
  name_sort: string;
}

interface StreamRow {
  channel: string;
  feed: string | null;
  idx: number;
  url: string;
  title: string | null;
  quality: string | null;
  quality_rank: number;
  labels: string[];
  user_agent: string | null;
  referrer: string | null;
}

interface Plan {
  channels: ChannelRow[];
  channelCategories: Array<[string, string]>;
  channelLanguages: Array<[string, string]>;
  feeds: RawFeed[];
  streams: StreamRow[];
  guides: RawGuide[];
  categoryCounts: Map<string, Tally>;
  countryCounts: Map<string, Tally>;
  languageCounts: Map<string, Tally>;
  countryName: Map<string, string>;
  languageName: Map<string, string>;
  streamsSkipped: number;
}

/** Pure derivation of every catalog row from the raw datasets. */
export function derive(raw: RawDatasets): Plan {
  const countryName = new Map<string, string>();
  for (const c of raw.countries) countryName.set(c.code, c.name);
  const languageName = new Map<string, string>();
  for (const l of raw.languages) languageName.set(l.code, l.name);

  // Channels: first occurrence wins.
  const channels = new Map<string, RawChannel>();
  for (const c of raw.channels) if (!channels.has(c.id)) channels.set(c.id, c);

  const blocked = new Set(raw.blocklist.map((b) => b.channel));
  // Operator's own blocklist: LOCAL_BLOCKLIST (default $DATA_DIR/local-blocklist.json), a JSON array
  // of channel ids or of {channel, reason} objects. Lets an instance drop a channel immediately
  // without waiting for upstream.
  for (const id of readLocalBlocklist()) blocked.add(id);

  // Feeds for known channels, deduplicated by (channel, id).
  const feeds: RawFeed[] = [];
  const feedsOf = new Map<string, RawFeed[]>();
  const mainFeed = new Set<string>();
  const seenFeed = new Set<string>();
  for (const f of raw.feeds) {
    if (!channels.has(f.channel)) continue;
    const k = feedKey(f.channel, f.id);
    if (seenFeed.has(k)) continue;
    seenFeed.add(k);
    feeds.push(f);
    const list = feedsOf.get(f.channel) ?? [];
    list.push(f);
    feedsOf.set(f.channel, list);
    if (f.is_main) mainFeed.add(k);
  }

  // Guides for known channels.
  const guides = raw.guides.filter((g) => channels.has(g.channel));
  const guideCount = new Map<string, number>();
  for (const g of guides) guideCount.set(g.channel, (guideCount.get(g.channel) ?? 0) + 1);

  // Logo: in_use, prefer feed null, then main feed, then file order.
  const logo = new Map<string, { rank: number; url: string }>();
  for (const l of raw.logos) {
    if (!l.in_use || !l.url || !channels.has(l.channel)) continue;
    const rank = l.feed == null ? 0 : mainFeed.has(feedKey(l.channel, l.feed)) ? 1 : 2;
    const cur = logo.get(l.channel);
    if (!cur || rank < cur.rank) logo.set(l.channel, { rank, url: l.url });
  }

  // Streams: drop orphans (no channel or unknown channel); order https first, quality desc, file order.
  const streamsOf = new Map<string, Array<{ s: RawStream; rank: number; https: boolean; order: number }>>();
  let streamsSkipped = 0;
  raw.streams.forEach((s, order) => {
    if (!s.channel || !channels.has(s.channel)) {
      streamsSkipped++;
      return;
    }
    const list = streamsOf.get(s.channel) ?? [];
    list.push({
      s,
      rank: qualityRank(s.quality),
      https: s.url.trim().toLowerCase().startsWith("https://"),
      order,
    });
    streamsOf.set(s.channel, list);
  });

  const streamRows: StreamRow[] = [];
  const streamInfo = new Map<string, { count: number; bestRank: number; bestQuality: string | null }>();
  for (const [channel, list] of streamsOf) {
    list.sort((a, b) => Number(b.https) - Number(a.https) || b.rank - a.rank || a.order - b.order);
    let bestRank = -1;
    let bestQuality: string | null = null;
    list.forEach((entry, idx) => {
      if (entry.rank > bestRank) {
        bestRank = entry.rank;
        bestQuality = entry.s.quality ?? null;
      }
      streamRows.push({
        channel,
        feed: entry.s.feed ?? null,
        idx,
        url: entry.s.url,
        title: entry.s.title ?? null,
        quality: entry.s.quality ?? null,
        quality_rank: entry.rank,
        labels: entry.s.labels ?? [],
        user_agent: entry.s.user_agent ?? null,
        referrer: entry.s.referrer ?? null,
      });
    });
    streamInfo.set(channel, { count: list.length, bestRank: Math.max(bestRank, 0), bestQuality });
  }

  // Channel rows and join-table pairs.
  const categoryCounts = new Map<string, Tally>();
  const countryCounts = new Map<string, Tally>();
  const languageCounts = new Map<string, Tally>();
  const channelCategories: Array<[string, string]> = [];
  const channelLanguages: Array<[string, string]> = [];
  const channelRows: ChannelRow[] = [];

  for (const c of channels.values()) {
    const feedList = feedsOf.get(c.id) ?? [];
    const languages = [...new Set(feedList.flatMap((f) => f.languages ?? []))];
    const broadcastArea = [...new Set(feedList.flatMap((f) => f.broadcast_area ?? []))];
    const categories = [...new Set(c.categories ?? [])];
    const info = streamInfo.get(c.id);
    const hasStream = (info?.count ?? 0) > 0;
    const isBlocked = blocked.has(c.id);

    for (const cat of categories) channelCategories.push([c.id, cat]);
    for (const lang of languages) channelLanguages.push([c.id, lang]);
    if (!isBlocked) {
      for (const cat of categories) tally(categoryCounts, cat, hasStream);
      for (const lang of languages) tally(languageCounts, lang, hasStream);
      if (c.country) tally(countryCounts, c.country, hasStream);
    }

    channelRows.push({
      id: c.id,
      name: c.name,
      alt_names: c.alt_names ?? [],
      network: c.network ?? null,
      owners: c.owners ?? [],
      country: c.country ?? null,
      categories,
      languages,
      broadcast_area: broadcastArea,
      is_nsfw: c.is_nsfw ? 1 : 0,
      blocked: isBlocked ? 1 : 0,
      launched: c.launched ?? null,
      closed: c.closed ?? null,
      replaced_by: c.replaced_by ?? null,
      website: c.website ?? null,
      logo_url: logo.get(c.id)?.url ?? null,
      stream_count: info?.count ?? 0,
      has_stream: hasStream ? 1 : 0,
      best_quality: info?.bestQuality ?? null,
      quality_rank: info?.bestRank ?? 0,
      guide_count: guideCount.get(c.id) ?? 0,
      name_sort: nameSort(c.name),
    });
  }

  return {
    channels: channelRows,
    channelCategories,
    channelLanguages,
    feeds,
    streams: streamRows,
    guides,
    categoryCounts,
    countryCounts,
    languageCounts,
    countryName,
    languageName,
    streamsSkipped,
  };
}


/**
 * Rebuilds all catalog tables (not meta, not programmes) from rawDir in ONE transaction.
 * Readers in WAL mode keep seeing the previous catalog until commit.
 */
export function buildCatalog(db: Db, rawDir: string, now = Math.floor(Date.now() / 1000)): BuildStats {
  const t0 = Date.now();
  const raw = readDatasets(rawDir);
  const plan = derive(raw);

  const write = db.transaction(() => {
    for (const table of [
      "channel_categories",
      "channel_languages",
      "feeds",
      "streams",
      "guides",
      "channels_fts",
      "channels",
      "categories",
      "countries",
      "languages",
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'streams'").run();

    const insChannel = db.prepare(`
      INSERT INTO channels (id, name, alt_names, network, owners, country, categories, languages, broadcast_area,
        is_nsfw, blocked, launched, closed, replaced_by, website, logo_url, stream_count, has_stream,
        best_quality, quality_rank, guide_count, name_sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of plan.channels) {
      insChannel.run(
        c.id, c.name, JSON.stringify(c.alt_names), c.network, JSON.stringify(c.owners), c.country,
        JSON.stringify(c.categories), JSON.stringify(c.languages), JSON.stringify(c.broadcast_area),
        c.is_nsfw, c.blocked, c.launched, c.closed, c.replaced_by, c.website, c.logo_url,
        c.stream_count, c.has_stream, c.best_quality, c.quality_rank, c.guide_count, c.name_sort,
      );
    }

    const insFts = db.prepare(
      "INSERT INTO channels_fts (id, name, alt_names, network, owners, country_name, language_names) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const c of plan.channels) {
      insFts.run(
        c.id, c.name, c.alt_names.join(" "), c.network ?? "", c.owners.join(" "),
        (c.country && plan.countryName.get(c.country)) || "",
        c.languages.map((l) => plan.languageName.get(l) ?? "").filter(Boolean).join(" "),
      );
    }

    const insCc = db.prepare("INSERT OR IGNORE INTO channel_categories (channel, category) VALUES (?, ?)");
    for (const [ch, cat] of plan.channelCategories) insCc.run(ch, cat);
    const insCl = db.prepare("INSERT OR IGNORE INTO channel_languages (channel, language) VALUES (?, ?)");
    for (const [ch, lang] of plan.channelLanguages) insCl.run(ch, lang);

    const insFeed = db.prepare(`
      INSERT OR IGNORE INTO feeds (channel, id, name, is_main, broadcast_area, timezones, languages, format)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of plan.feeds) {
      insFeed.run(
        f.channel, f.id, f.name ?? f.id, f.is_main ? 1 : 0, JSON.stringify(f.broadcast_area ?? []),
        JSON.stringify(f.timezones ?? []), JSON.stringify(f.languages ?? []), f.format ?? null,
      );
    }

    const insStream = db.prepare(`
      INSERT INTO streams (channel, feed, idx, url, title, quality, quality_rank, labels, user_agent, referrer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of plan.streams) {
      insStream.run(
        s.channel, s.feed, s.idx, s.url, s.title, s.quality, s.quality_rank,
        JSON.stringify(s.labels), s.user_agent, s.referrer,
      );
    }

    const insGuide = db.prepare("INSERT INTO guides (channel, feed, site, site_id, lang) VALUES (?, ?, ?, ?, ?)");
    for (const g of plan.guides) insGuide.run(g.channel, g.feed ?? null, g.site, g.site_id, g.lang ?? null);

    const insCat = db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, description, channel_count, stream_count)
      VALUES (?, ?, ?, ?, ?)`);
    for (const c of raw.categories) {
      const t = plan.categoryCounts.get(c.id);
      insCat.run(c.id, c.name, c.description ?? null, t?.channels ?? 0, t?.streams ?? 0);
    }

    const insCountry = db.prepare(`
      INSERT OR IGNORE INTO countries (code, name, flag, languages, channel_count, stream_count)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const c of raw.countries) {
      const t = plan.countryCounts.get(c.code);
      insCountry.run(c.code, c.name, c.flag ?? null, JSON.stringify(c.languages ?? []), t?.channels ?? 0, t?.streams ?? 0);
    }

    const insLang = db.prepare(
      "INSERT OR IGNORE INTO languages (code, name, channel_count, stream_count) VALUES (?, ?, ?, ?)",
    );
    for (const l of raw.languages) {
      const t = plan.languageCounts.get(l.code);
      insLang.run(l.code, l.name, t?.channels ?? 0, t?.streams ?? 0);
    }

    const insMeta = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    const channelsWithStreams = plan.channels.filter((c) => c.has_stream).length;
    // Stable channel numbers: keep existing, assign the next free number to new channels with streams
    // (alphabetical within the batch so first-run numbering is predictable).
    const maxNum = (db.prepare("SELECT COALESCE(MAX(number), 0) AS m FROM channel_numbers").get() as { m: number }).m;
    const unnumbered = db.prepare(
      "SELECT id FROM channels WHERE has_stream = 1 AND blocked = 0 AND id NOT IN (SELECT channel FROM channel_numbers) ORDER BY name_sort, id",
    ).all() as { id: string }[];
    const insNum = db.prepare("INSERT INTO channel_numbers (channel, number) VALUES (?, ?)");
    let n = maxNum;
    for (const row of unnumbered) insNum.run(row.id, ++n);
    db.prepare("UPDATE channels SET number = (SELECT number FROM channel_numbers cn WHERE cn.channel = channels.id)").run();

    // Re-apply stream health from the prober's URL-keyed history onto the rebuilt streams rows.
    db.prepare(
      // Hysteresis: a single failure on a never-online stream is "pending", published as NULL (unknown).
      "UPDATE streams SET status = (SELECT CASE WHEN h.status = 'offline' AND h.fail_count < 2 AND h.last_online IS NULL THEN NULL ELSE h.status END FROM stream_health h WHERE h.url = streams.url), last_checked = (SELECT h.last_checked FROM stream_health h WHERE h.url = streams.url) WHERE url IN (SELECT url FROM stream_health)",
    ).run();
    db.prepare("UPDATE channels SET online_count = (SELECT COUNT(*) FROM streams s WHERE s.channel = channels.id AND s.status = 'online')").run();

    insMeta.run("last_ingest", String(now));
    insMeta.run(
      "counts",
      JSON.stringify({ channels: plan.channels.length, streams: plan.streams.length, channelsWithStreams }),
    );
  });
  write.immediate();

  return {
    channels: plan.channels.length,
    channelsWithStreams: plan.channels.filter((c) => c.has_stream).length,
    blockedChannels: plan.channels.filter((c) => c.blocked).length,
    streams: plan.streams.length,
    streamsSkipped: plan.streamsSkipped,
    feeds: plan.feeds.length,
    guides: plan.guides.length,
    categories: raw.categories.length,
    countries: raw.countries.length,
    languages: raw.languages.length,
    durationMs: Date.now() - t0,
  };
}
