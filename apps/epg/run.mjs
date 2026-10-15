#!/usr/bin/env node
// EPG container entrypoint: regenerate channels.xml, run the iptv-org/epg grabber, publish
// /data/epg/guide.xml atomically, sleep, repeat. See README.md for the environment variables.

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { generate, renderChannelsXml } from './generate-channels.mjs';
import { fetchApiData } from './fetch-api-data.mjs';

const env = process.env;

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid number: ${value}`);
  return n;
}

const cfg = {
  epgDir: env.EPG_DIR || '/epg',
  workDir: env.EPG_WORK_DIR || '/work',
  outFile: env.EPG_OUTPUT || '/data/epg/guide.xml',
  runOnStart: bool(env.EPG_RUN_ON_START, true),
  intervalMs: Math.max(60_000, num(env.EPG_INTERVAL_HOURS, 12) * 3_600_000),
  days: num(env.EPG_DAYS, 2),
  maxConnections: num(env.EPG_MAX_CONNECTIONS, 10),
  timeoutMs: num(env.EPG_TIMEOUT_MS, 30_000),
  grabArgs: (env.EPG_GRAB_ARGS || '').split(/\s+/).filter(Boolean),
  splitBySite: bool(env.EPG_SPLIT_BY_SITE, false),
  refreshApiData: bool(env.EPG_REFRESH_API_DATA, true)
};

const epgDataDir = path.join(cfg.epgDir, 'temp', 'data');

let stopping = false;
let current = null; // running grabber child (npm process group)
let wakeTimer = null;
let wakeResolve = null;

const ts = () => new Date().toISOString();
const log = msg => console.log(`[${ts()}] ${msg}`);
const warn = msg => console.error(`[${ts()}] ${msg}`);

function sleep(ms) {
  return new Promise(resolve => {
    wakeResolve = resolve;
    wakeTimer = setTimeout(resolve, ms);
  });
}

function wake() {
  clearTimeout(wakeTimer);
  if (wakeResolve) wakeResolve();
  wakeResolve = null;
}

// Runs `npm run grab -- <args>` in the epg checkout. Output is inherited so it shows in docker logs.
function runGrab(args) {
  return new Promise(resolve => {
    const child = spawn('npm', ['run', 'grab', '--', ...args], {
      cwd: cfg.epgDir,
      stdio: 'inherit',
      detached: true // own process group, so shutdown can kill npm and tsx together
    });
    current = child;
    child.on('error', err => {
      warn(`failed to start grabber: ${err.message}`);
      current = null;
      resolve(-1);
    });
    child.on('exit', (code, signal) => {
      current = null;
      resolve(code ?? (signal ? 128 : 1));
    });
  });
}

// True if the XMLTV file contains at least one <programme>. The grabber exits 0 even when every
// request failed, leaving an empty <tv>, so a non-empty file alone is not enough.
async function hasProgrammes(file) {
  const st = await stat(file).catch(() => null);
  if (!st || st.size === 0) return false;
  const input = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.includes('<programme')) return true;
    }
    return false;
  } finally {
    rl.close();
    input.destroy();
  }
}

// Moves a finished temp guide into place. The previous guide stays if anything is wrong.
async function publish(tmpFile) {
  if (stopping) {
    await rm(tmpFile, { force: true });
    return false;
  }
  if (!(await hasProgrammes(tmpFile))) {
    warn(`new guide has no programmes; keeping previous ${cfg.outFile}`);
    await rm(tmpFile, { force: true });
    return false;
  }
  await rename(tmpFile, cfg.outFile); // same directory, so atomic
  const { size } = await stat(cfg.outFile);
  log(`published ${cfg.outFile} (${(size / 1048576).toFixed(1)} MiB)`);
  return true;
}

function grabArgs(channelsFile, outputFile) {
  return [
    `--channels=${channelsFile}`,
    `--days=${cfg.days}`,
    `--maxConnections=${cfg.maxConnections}`,
    `--timeout=${cfg.timeoutMs}`,
    `--output=${outputFile}`,
    ...cfg.grabArgs
  ];
}

// Default mode: one grabber run over the whole channels.xml.
async function runSingle(channelsFile) {
  const tmp = `${cfg.outFile}.tmp`;
  await rm(tmp, { force: true });
  const code = await runGrab(grabArgs(channelsFile, tmp));
  if (stopping) {
    await rm(tmp, { force: true });
    return false;
  }
  if (code !== 0) {
    warn(`grabber exited with ${code}; keeping previous guide`);
    await rm(tmp, { force: true });
    return false;
  }
  return publish(tmp);
}

// Optional mode: one grabber run per site, then the programme elements are concatenated.
// A broken site only loses its own programmes. Each site runs with its own channels file
// built from guides.json, not with --sites, because --sites would use the repo's bundled list.
async function runSplit(entries) {
  const splitDir = path.join(cfg.workDir, 'split');
  await rm(splitDir, { recursive: true, force: true });
  await mkdir(path.join(splitDir, 'out'), { recursive: true });

  const bySite = new Map();
  for (const e of entries) {
    if (!bySite.has(e.site)) bySite.set(e.site, []);
    bySite.get(e.site).push(e);
  }

  const parts = [];
  let failed = 0;
  let i = 0;
  for (const [site, siteEntries] of bySite) {
    if (stopping) break;
    i++;
    const safe = site.replace(/[^A-Za-z0-9._-]/g, '_');
    const channelsFile = path.join(splitDir, `${safe}.channels.xml`);
    const outFile = path.join(splitDir, 'out', `${safe}.xml`);
    await writeFile(channelsFile, renderChannelsXml(siteEntries), 'utf8');

    const code = await runGrab(grabArgs(channelsFile, outFile));
    if (code !== 0) {
      failed++;
      warn(`[${i}/${bySite.size}] ${site}: grabber exited with ${code}, skipped`);
      continue;
    }
    if (await hasProgrammes(outFile)) {
      parts.push(outFile);
    } else {
      failed++;
      warn(`[${i}/${bySite.size}] ${site}: no programmes, skipped`);
    }
  }

  log(`split run: ${parts.length} site(s) with programmes, ${failed} failed or empty`);
  if (stopping) return false;
  if (parts.length === 0) {
    warn('no site produced programmes; keeping previous guide');
    return false;
  }

  // Concatenate: keep one <tv> wrapper, copy only the <programme> elements from each part.
  const tmp = `${cfg.outFile}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile('<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="freetv-epg">\n');
    for (const part of parts) {
      const text = await readFile(part, 'utf8');
      const start = text.indexOf('<programme');
      if (start === -1) continue;
      const endTag = text.lastIndexOf('</tv>');
      await fh.writeFile(text.slice(start, endTag > start ? endTag : undefined).replace(/\s*$/, '\n'));
    }
    await fh.writeFile('</tv>\n');
  } finally {
    await fh.close();
  }

  return publish(tmp);
}

async function runOnce() {
  const started = Date.now();
  log('run start');

  if (cfg.refreshApiData) {
    try {
      await fetchApiData({ dir: epgDataDir });
    } catch (err) {
      warn(`api data refresh failed, using existing data: ${err.message}`);
    }
  }

  // generate-channels.mjs uses feeds.json (when present) to choose each channel's main feed.
  if (!env.FEEDS_FILE) {
    const feeds = path.join(epgDataDir, 'feeds.json');
    if (await stat(feeds).catch(() => null)) env.FEEDS_FILE = feeds;
  }

  let gen;
  try {
    gen = await generate({ sitesDir: path.join(cfg.epgDir, 'sites') });
  } catch (err) {
    warn(`channel list failed: ${err.message}; keeping previous guide`);
    return false;
  }
  if (gen.entries.length === 0) {
    warn('channel list is empty; keeping previous guide');
    return false;
  }
  const { stats } = gen;
  log(
    `channels: ${stats.entries} entries, ${stats.sites} sites, ${stats.channels} channel ids ` +
      `(EPG_SITES=${stats.sites_filter})`
  );

  let ok;
  if (cfg.splitBySite) {
    ok = await runSplit(gen.entries);
  } else {
    const channelsFile = path.join(cfg.workDir, 'channels.xml');
    await writeFile(channelsFile, gen.xml, 'utf8');
    ok = await runSingle(channelsFile);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  log(`run ${ok ? 'finished' : 'did not publish'} after ${secs}s`);
  return ok;
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, stopping`);
  wake();
  if (current && current.pid) {
    try {
      process.kill(-current.pid, 'SIGTERM');
    } catch {
      // group already gone
    }
    const force = setTimeout(() => {
      if (current && current.pid) {
        try {
          process.kill(-current.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }, 20_000);
    force.unref();
  }
}

async function main() {
  await mkdir(path.dirname(cfg.outFile), { recursive: true });
  await mkdir(cfg.workDir, { recursive: true });

  log(
    `epg loop: sites=${env.EPG_SITES || 'all'} days=${cfg.days} maxConnections=${cfg.maxConnections} ` +
      `timeout=${cfg.timeoutMs}ms interval=${cfg.intervalMs / 3_600_000}h ` +
      `mode=${cfg.splitBySite ? 'split-by-site' : 'single'} output=${cfg.outFile}`
  );

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  if (!cfg.runOnStart) {
    log(`EPG_RUN_ON_START=false, first run in ${cfg.intervalMs / 3_600_000}h`);
    await sleep(cfg.intervalMs);
  }

  while (!stopping) {
    try {
      await runOnce();
    } catch (err) {
      warn(`run error: ${err.stack || err.message}`);
    }
    if (stopping) break;
    log(`next run in ${cfg.intervalMs / 3_600_000}h`);
    await sleep(cfg.intervalMs);
  }
  log('stopped');
}

main().catch(err => {
  warn(`fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});
