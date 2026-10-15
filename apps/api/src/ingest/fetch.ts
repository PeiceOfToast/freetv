// Downloads the nine iptv-org datasets into rawDir. Conditional GET via ETag (etags.json),
// atomic temp-file + rename writes, and a fallback to the mirror on any failure.
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { DATASETS, type DatasetName } from "./build.js";

export interface FetchLog {
  info(msg: string): void;
  warn(msg: string): void;
}

interface EtagEntry {
  etag: string;
  source: string; // base URL the etag came from; ETags are only sent back to the same source
}
type EtagMap = Partial<Record<DatasetName, EtagEntry>>;

const REQUEST_TIMEOUT_MS = 180_000;

function etagsPath(rawDir: string) {
  return path.join(rawDir, "etags.json");
}

function loadEtags(rawDir: string): EtagMap {
  try {
    return JSON.parse(fs.readFileSync(etagsPath(rawDir), "utf8")) as EtagMap;
  } catch {
    return {};
  }
}

async function saveEtags(rawDir: string, etags: EtagMap): Promise<void> {
  const tmp = `${etagsPath(rawDir)}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(etags, null, 2));
  await fs.promises.rename(tmp, etagsPath(rawDir));
}

/** Cheap sanity check so an HTML error page served with 200 is never written over good data. */
function looksLikeJsonArray(buf: Buffer): boolean {
  const text = buf.toString("utf8").trim();
  return text.startsWith("[") && text.endsWith("]");
}

type Outcome = "changed" | "unchanged";

async function fetchFrom(
  name: DatasetName,
  base: string,
  rawDir: string,
  etags: EtagMap,
): Promise<Outcome> {
  const dest = path.join(rawDir, `${name}.json`);
  const url = `${base}/${name}.json`;
  const headers: Record<string, string> = {};
  const prev = etags[name];
  if (prev && prev.source === base && fs.existsSync(dest)) headers["if-none-match"] = prev.etag;

  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 304) {
    await res.body?.cancel();
    return "unchanged";
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${url} -> HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!looksLikeJsonArray(buf)) throw new Error(`${url} did not return a JSON array`);

  const tmp = `${dest}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, dest);

  const etag = res.headers.get("etag");
  if (etag) etags[name] = { etag, source: base };
  else delete etags[name];
  return "changed";
}

/**
 * Downloads all nine datasets. Returns true if any file was (re)written.
 * If both primary and mirror fail for a dataset that already exists on disk, the stale copy is kept
 * and a warning is logged; if no copy exists at all, the error is thrown.
 */
export async function fetchDatasets(
  rawDir: string = config.rawDir,
  opts: { base?: string; mirror?: string; log?: FetchLog } = {},
): Promise<boolean> {
  const base = opts.base ?? config.iptvApiBase;
  const mirror = opts.mirror ?? config.iptvApiMirror;
  const log = opts.log;
  fs.mkdirSync(rawDir, { recursive: true });

  const etags = loadEtags(rawDir);
  let changed = false;
  // Once the primary has failed at the transport level, don't pay the timeout for every dataset.
  let primaryDown = false;

  try {
    for (const name of DATASETS) {
      const sources = [base, mirror].filter((s, i, all) => all.indexOf(s) === i);
      let done = false;
      let lastErr: unknown;
      for (const src of sources) {
        if (src === base && primaryDown) continue;
        try {
          const outcome = await fetchFrom(name, src, rawDir, etags);
          if (outcome === "changed") {
            changed = true;
            log?.info(`ingest: downloaded ${name}.json from ${src}`);
          }
          done = true;
          break;
        } catch (e) {
          lastErr = e;
          if (src === base) primaryDown = true;
          log?.warn(`ingest: ${name}.json from ${src} failed: ${(e as Error).message}`);
        }
      }
      if (!done) {
        const dest = path.join(rawDir, `${name}.json`);
        if (!fs.existsSync(dest)) throw lastErr;
        log?.warn(`ingest: keeping stale ${name}.json (all sources failed)`);
      }
    }
  } finally {
    await saveEtags(rawDir, etags);
  }
  return changed;
}
