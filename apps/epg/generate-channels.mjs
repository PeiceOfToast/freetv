#!/usr/bin/env node
// Builds an iptv-org/epg channels.xml from iptv-org's guides.json.
//
// One <channel> per (channel, site) pair. guides.json rows with channel === null are
// site channels that are not mapped to an iptv-org channel, so they are skipped.
//
// Environment:
//   IPTV_API_BASE     base URL for guides.json (default https://iptv-org.github.io/api)
//   GUIDES_FILE       read guides.json from this local path instead of the network
//   EPG_SITES         "all" (default) or a comma list of site names, e.g. tvguide.com,bbc.co.uk
//   EPG_EXCLUDE_SITES optional comma list of sites to drop after EPG_SITES is applied
//   FEEDS_FILE        optional feeds.json; its is_main flag picks each channel's main feed when
//                     several feeds exist on the same site (without it, feed null wins, then first)
//   EPG_SITES_DIR     optional path to iptv-org/epg's sites/ directory. Sites without
//                     <site>/<site>.config.js there are dropped: the grabber crashes on a missing
//                     config, which would stop the whole run. Defaults to $EPG_DIR/sites if EPG_DIR is set.
//
// CLI:
//   node generate-channels.mjs --out /work/channels.xml
//
// Exports generate() so run.mjs can build the list in-process (split-by-site mode).

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_API_BASE = 'https://iptv-org.github.io/api';
const MIRROR_API_BASE = 'https://raw.githubusercontent.com/iptv-org/api/gh-pages';
const FETCH_TIMEOUT_MS = 60_000;

function parseList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Loads guides.json from GUIDES_FILE, IPTV_API_BASE, or the raw.githubusercontent mirror.
export async function loadGuides({ guidesFile, apiBase } = {}) {
  if (guidesFile) {
    const text = await readFile(guidesFile, 'utf8');
    return { rows: JSON.parse(text), source: guidesFile };
  }

  const bases = [apiBase || DEFAULT_API_BASE];
  if (!bases.includes(MIRROR_API_BASE)) bases.push(MIRROR_API_BASE);

  const errors = [];
  for (const base of bases) {
    const url = `${base.replace(/\/+$/, '')}/guides.json`;
    try {
      return { rows: await fetchJson(url), source: url };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(`could not load guides.json:\n  ${errors.join('\n  ')}`);
}

// Returns Map channel id -> id of its main feed (e.g. "SD"), from feeds.json.
export function mainFeedsFromFeeds(feeds) {
  const map = new Map();
  for (const f of feeds) if (f.is_main && !map.has(f.channel)) map.set(f.channel, f.id);
  return map;
}

// How good a guides.json row is as the representative of its (channel, site) pair.
function feedRank(row, mainFeeds) {
  if (mainFeeds && row.feed != null && mainFeeds.get(row.channel) === row.feed) return 3;
  if (row.feed == null) return 2;
  return 1;
}

// Builds the (channel, site) entries from guides.json rows.
export function buildEntries(rows, { sites = 'all', excludeSites = [], mainFeeds = null, hasConfig = null } = {}) {
  const include = sites === 'all' || sites == null ? null : new Set(sites);
  const exclude = new Set(excludeSites);

  const stats = {
    rowsTotal: rows.length,
    rowsUnmapped: 0,
    rowsIncomplete: 0,
    rowsFilteredOut: 0,
    rowsNoConfig: 0,
    sitesNoConfig: [],
    duplicatesDropped: 0,
    entries: 0,
    sites: 0,
    channels: 0
  };

  // key = channel + site. Keep the row on the channel's main feed, else feed === null, else the first seen.
  const byKey = new Map();

  for (const row of rows) {
    if (row.channel == null) {
      stats.rowsUnmapped++;
      continue;
    }
    if (!row.site || !row.site_id) {
      stats.rowsIncomplete++;
      continue;
    }
    if ((include && !include.has(row.site)) || exclude.has(row.site)) {
      stats.rowsFilteredOut++;
      continue;
    }
    if (hasConfig && !hasConfig(row.site)) {
      stats.rowsNoConfig++;
      if (!stats.sitesNoConfig.includes(row.site)) stats.sitesNoConfig.push(row.site);
      continue;
    }

    const key = `${row.channel}\u0000${row.site}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
    } else {
      stats.duplicatesDropped++;
      if (feedRank(row, mainFeeds) > feedRank(existing, mainFeeds)) byKey.set(key, row);
    }
  }

  // EPG_ONE_SITE_PER_CHANNEL (default true): grabbing the same channel from many sites multiplies
  // requests (BBC News is listed on ~68 sites) and yields overlapping schedules. Keep one site per
  // channel: prefer a site whose domain matches the channel's country (id suffix), then the main
  // feed, then the site with the most mapped channels (big aggregators tend to be reliable).
  let chosen = [...byKey.values()];
  const onePerChannel = (process.env.EPG_ONE_SITE_PER_CHANNEL ?? 'true').toLowerCase() !== 'false';
  if (onePerChannel) {
    const siteSize = new Map();
    for (const r of chosen) siteSize.set(r.site, (siteSize.get(r.site) || 0) + 1);
    const countryOf = id => (id.includes('.') ? id.slice(id.lastIndexOf('.') + 1).toLowerCase() : '');
    const siteMatchesCountry = (site, cc) => {
      if (!cc) return false;
      const s = site.toLowerCase();
      if (s.endsWith(`.${cc}`) || s.includes(`.${cc}.`)) return true;
      return cc === 'us' && (s.endsWith('.com') || s.endsWith('.net') || s.endsWith('.tv'));
    };
    const score = r =>
      (siteMatchesCountry(r.site, countryOf(r.channel)) ? 1_000_000 : 0) +
      feedRank(r, mainFeeds) * 100_000 +
      (siteSize.get(r.site) || 0);
    const best = new Map();
    for (const r of chosen) {
      const cur = best.get(r.channel);
      if (!cur || score(r) > score(cur)) best.set(r.channel, r);
    }
    stats.sitesCollapsed = chosen.length - best.size;
    chosen = [...best.values()];
  }

  const entries = chosen
    .map(row => ({
      site: row.site,
      lang: row.lang || 'en',
      xmltv_id: row.channel,
      site_id: String(row.site_id),
      name: row.site_name || row.channel
    }))
    .sort((a, b) => a.site.localeCompare(b.site) || a.xmltv_id.localeCompare(b.xmltv_id));

  stats.entries = entries.length;
  stats.sites = new Set(entries.map(e => e.site)).size;
  stats.channels = new Set(entries.map(e => e.xmltv_id)).size;

  return { entries, stats };
}

export function renderChannelsXml(entries) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<channels>'];
  for (const e of entries) {
    lines.push(
      `  <channel site="${escapeXml(e.site)}" lang="${escapeXml(e.lang)}" ` +
        `xmltv_id="${escapeXml(e.xmltv_id)}" site_id="${escapeXml(e.site_id)}">` +
        `${escapeXml(e.name)}</channel>`
    );
  }
  lines.push('</channels>', '');
  return lines.join('\n');
}

// One call does everything. Options default to the environment variables above.
export async function generate(opts = {}) {
  const sitesEnv = opts.sites ?? process.env.EPG_SITES ?? 'all';
  const sites =
    sitesEnv.trim() === '' || sitesEnv.trim() === 'all' ? 'all' : parseList(sitesEnv);
  const excludeSites = opts.excludeSites ?? parseList(process.env.EPG_EXCLUDE_SITES);

  const { rows, source } = await loadGuides({
    guidesFile: opts.guidesFile ?? process.env.GUIDES_FILE,
    apiBase: opts.apiBase ?? process.env.IPTV_API_BASE
  });
  if (!Array.isArray(rows)) throw new Error(`guides.json from ${source} is not an array`);

  const sitesDirOpt = opts.sitesDir ?? process.env.EPG_SITES_DIR ?? (process.env.EPG_DIR ? path.join(process.env.EPG_DIR, 'sites') : null);
  if (sitesDirOpt && !existsSync(sitesDirOpt)) {
    throw new Error(`sites dir not found: ${sitesDirOpt} (set EPG_DIR to the iptv-org/epg checkout)`);
  }
  const hasConfig = sitesDirOpt
    ? site => existsSync(path.join(sitesDirOpt, site, `${site}.config.js`))
    : null;

  const feedsFile = opts.feedsFile ?? process.env.FEEDS_FILE;
  let mainFeeds = null;
  if (feedsFile) {
    mainFeeds = mainFeedsFromFeeds(JSON.parse(await readFile(feedsFile, 'utf8')));
  }

  const { entries, stats } = buildEntries(rows, { sites, excludeSites, mainFeeds, hasConfig });
  stats.main_feeds = mainFeeds ? 'feeds.json' : 'none (feed null, then first)';
  stats.sites_dir = sitesDirOpt || 'not checked';
  if (stats.sitesNoConfig.length) {
    console.warn(
      `warning: ${stats.sitesNoConfig.length} site(s) have no config in ${sitesDirOpt} and were skipped ` +
        `(${stats.rowsNoConfig} rows): ${stats.sitesNoConfig.slice(0, 10).join(', ')}` +
        (stats.sitesNoConfig.length > 10 ? ', ...' : '')
    );
  }

  if (sites !== 'all') {
    const known = new Set(rows.map(r => r.site));
    const missing = sites.filter(s => !known.has(s));
    if (missing.length) console.warn(`warning: no guides.json rows for site(s): ${missing.join(', ')}`);
  }

  return {
    entries,
    stats: { ...stats, source, sites_filter: sites === 'all' ? 'all' : sites.join(',') },
    xml: renderChannelsXml(entries)
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out || process.env.CHANNELS_FILE || '/work/channels.xml';

  const { stats, xml } = await generate();

  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, xml, 'utf8');

  console.log(`source:             ${stats.source}`);
  console.log(`EPG_SITES filter:   ${stats.sites_filter}`);
  console.log(`main feed choice:   ${stats.main_feeds}`);
  console.log(`sites dir check:    ${stats.sites_dir}`);
  console.log(`guides rows:        ${stats.rowsTotal}`);
  console.log(`  unmapped (null):  ${stats.rowsUnmapped}`);
  console.log(`  incomplete:       ${stats.rowsIncomplete}`);
  console.log(`  filtered out:     ${stats.rowsFilteredOut}`);
  console.log(`  no site config:   ${stats.rowsNoConfig}`);
  console.log(`  duplicates:       ${stats.duplicatesDropped}`);
  console.log(`channels.xml:       ${stats.entries} entries, ${stats.sites} sites, ${stats.channels} channel ids`);
  console.log(`written to:         ${path.resolve(out)}`);

  if (stats.entries === 0) {
    console.error('error: no channels matched; refusing to produce an empty channels.xml');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(`generate-channels: ${err.message}`);
    process.exitCode = 1;
  });
}
