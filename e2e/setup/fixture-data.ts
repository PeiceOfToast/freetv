// Builds the input for the e2e catalog: a copy of the API's fixture JSON with the stream lists of
// three channels replaced by URLs on the fake HLS origin, and a guide whose programmes are shifted
// so "now" is inside them. The real ingest code then builds the catalog tables from this copy, so
// derived columns (stream_count, best_quality, idx order) stay consistent.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.ts";

export const FIXTURE_SRC = path.join(REPO_ROOT, "apps/api/test/fixtures");
export const HLS_PORT = Number(process.env.HLS_PORT ?? 4600);

interface RawStream {
  channel: string | null;
  feed: string | null;
  title: string | null;
  url: string;
  quality: string | null;
  labels: string[];
  user_agent: string | null;
  referrer: string | null;
}

const hls = (kind: "live" | "cors-blocked" | "dead") => `http://127.0.0.1:${HLS_PORT}/${kind}/master.m3u8`;

/** Playback order the browser sees (all direct URLs before any relay URL). */
export const OVERRIDES: Record<string, string[]> = {
  // dead -> direct fails; cors-blocked -> direct fails in the browser; good -> direct plays.
  "BBCNews.uk": [hls("dead"), hls("cors-blocked"), hls("live")],
  // Only reachable through the relay.
  "CNN.us": [hls("cors-blocked")],
  // Plays directly on the first attempt.
  "AlJazeera.qa": [hls("live")],
  // Every stream is dead, so the watch page ends in the "Couldn't play this channel" panel (hub.spec.ts).
  "Akaku53.us": [hls("dead")],
};

export function writeCatalogInput(dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(FIXTURE_SRC)) {
    // streams.json is rewritten below; everything else is copied as-is.
    if (f.endsWith(".json") && f !== "streams.json") fs.copyFileSync(path.join(FIXTURE_SRC, f), path.join(dst, f));
  }
  const streams = JSON.parse(fs.readFileSync(path.join(FIXTURE_SRC, "streams.json"), "utf8")) as RawStream[];
  const kept = streams.filter((s) => !(s.channel !== null && s.channel in OVERRIDES));
  for (const [channel, urls] of Object.entries(OVERRIDES)) {
    for (const url of urls) {
      kept.push({ channel, feed: null, title: channel, url, quality: null, labels: [], user_agent: null, referrer: null });
    }
  }
  fs.writeFileSync(path.join(dst, "streams.json"), JSON.stringify(kept));
}

/** XMLTV times are "YYYYMMDDHHMMSS +0000". Shifts every programme so the earliest one starts at `startAt`. */
export function shiftGuide(xml: string, startAt: Date): string {
  const re = /(start|stop)="(\d{14}) ([+-]\d{4})"/g;
  const parse = (ts: string) => {
    const n = (a: number, b: number) => Number(ts.slice(a, b));
    return Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10), n(10, 12), n(12, 14));
  };
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const starts = [...xml.matchAll(/start="(\d{14}) [+-]\d{4}"/g)].map((m) => parse(m[1]));
  if (starts.length === 0) throw new Error("sample guide has no programmes");
  const delta = startAt.getTime() - Math.min(...starts);
  return xml.replace(re, (_whole, attr: string, ts: string, tz: string) => `${attr}="${fmt(parse(ts) + delta)} ${tz}"`);
}

export function writeGuide(dst: string, now = new Date()) {
  const xml = fs.readFileSync(path.join(FIXTURE_SRC, "sample-guide.xml"), "utf8");
  // The first programme starts 30 minutes ago, so BBC News at Ten is on air for the test.
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, shiftGuide(xml, new Date(now.getTime() - 30 * 60_000)));
}
