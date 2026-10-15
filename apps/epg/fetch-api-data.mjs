#!/usr/bin/env node
// Downloads the iptv-org API JSON files that the grabber reads from ./temp/data
// (logos, feeds, channel metadata). The grabber's own postinstall step does the same
// download from https://iptv-org.github.io/api, but that step swallows errors and the
// host is not always reachable, so this script is the explicit, checked version.
//
// Usage: node fetch-api-data.mjs --dir /epg/temp/data [--strict]
//   --strict   exit non-zero if any file fails (used at image build time)
// Env:
//   API_MIRROR_BASE  default https://raw.githubusercontent.com/iptv-org/api/gh-pages
//   API_PRIMARY_BASE default https://iptv-org.github.io/api (tried first)

import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Same list the grabber's SDK downloads (scripts/api.ts in iptv-org/epg).
export const API_FILES = [
  'blocklist',
  'categories',
  'channels',
  'cities',
  'countries',
  'feeds',
  'guides',
  'languages',
  'logos',
  'regions',
  'streams',
  'subdivisions',
  'timezones'
];

const MIRROR = 'https://raw.githubusercontent.com/iptv-org/api/gh-pages';
const PRIMARY = 'https://iptv-org.github.io/api';
const TIMEOUT_MS = 120_000;

async function download(basename, bases) {
  const errors = [];
  for (const base of bases) {
    const url = `${base.replace(/\/+$/, '')}/${basename}.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      JSON.parse(body.toString('utf8')); // refuse to store a truncated or HTML error page
      return { body, url };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(errors.join('; '));
}

// Returns { ok: [basename], failed: [{ basename, error }] }.
export async function fetchApiData({ dir, strict = false } = {}) {
  const targetDir = dir || process.env.DATA_DIR_API || path.resolve('temp/data');
  const bases = [process.env.API_PRIMARY_BASE || PRIMARY, process.env.API_MIRROR_BASE || MIRROR];
  await mkdir(targetDir, { recursive: true });

  const ok = [];
  const failed = [];
  for (const basename of API_FILES) {
    try {
      const { body } = await download(basename, bases);
      const target = path.join(targetDir, `${basename}.json`);
      const tmp = `${target}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, target);
      ok.push(basename);
    } catch (err) {
      failed.push({ basename, error: err.message });
    }
  }

  console.log(`api data: ${ok.length}/${API_FILES.length} files into ${targetDir}`);
  for (const f of failed) console.error(`api data: FAILED ${f.basename}: ${f.error}`);

  if (strict && failed.length) {
    throw new Error(`${failed.length} API file(s) could not be downloaded`);
  }
  return { ok, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : undefined;
  const strict = args.includes('--strict');
  fetchApiData({ dir, strict }).catch(err => {
    console.error(`fetch-api-data: ${err.message}`);
    process.exitCode = 1;
  });
}
