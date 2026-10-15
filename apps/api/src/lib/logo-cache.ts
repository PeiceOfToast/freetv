import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fetch } from "undici";
import sharp from "sharp";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { prep } from "./sql.js";

// Disk cache for channel logos. Served by routes/logo.ts; see docs/API.md "Logos" and
// docs/notes/api-logos.md for the design.

export const LOGO_SIZES = [64, 128, 256, 512] as const;
export const LOGO_UA = "FreeTV-logo-cache/1.0 (+https://github.com/iptv-org/iptv)";

/** Fetch and eviction tunables. Kept here rather than in config.ts (integrator-owned); tests override them. */
export const logoOptions = {
  fetchTimeoutMs: 10_000,
  maxSourceBytes: 5 * 1024 * 1024,
  negativeTtlMs: 6 * 60 * 60 * 1000,
  indexFlushMs: 60_000,
};

const CONTENT_TYPES = { webp: "image/webp", png: "image/png", svg: "image/svg+xml" } as const;
type Ext = keyof typeof CONTENT_TYPES;

export interface LogoHit {
  /** Absolute path of the cached file. */
  path: string;
  contentType: string;
  /** Strong ETag derived from size and mtime of the cached file (changes when the file is regenerated). */
  etag: string;
  size: number;
}

export interface GetLogoOptions {
  /** True when the request's Accept header includes image/webp. */
  webp?: boolean;
}

interface Entry {
  size: number;
  atime: number;
  /** Hash of the upstream URL the file was produced from; null when unknown (index lost). */
  src: string | null;
}

interface State {
  dir: string;
  entries: Map<string, Entry>;
  total: number;
  dirty: boolean;
  timer: ReturnType<typeof setInterval>;
}

let state: State | null = null;
const flights = new Map<string, Promise<unknown>>();

/**
 * Logo URL to put in channel responses. With the cache enabled this is the relative `/logo/<id>`;
 * otherwise (or when the channel has no upstream logo) it is the upstream URL / null.
 * Exports keep using the upstream absolute URL: TV apps fetch logos themselves and a relative path
 * would need PUBLIC_URL to be useful.
 */
export function publicLogoUrl(channelId: string, upstreamUrl: string | null): string | null {
  if (!upstreamUrl) return null;
  return config.logoCacheEnabled ? `/logo/${encodeURIComponent(channelId)}` : upstreamUrl;
}

/** Snap a requested edge length to a cached size: smallest allowed size >= requested, capped at LOGO_MAX_SIZE. */
export function normalizeLogoSize(requested: number | undefined): number {
  const allowed = LOGO_SIZES.filter((s) => s <= config.logoMaxSize);
  const pool: readonly number[] = allowed.length > 0 ? allowed : [LOGO_SIZES[0]];
  const want = requested ?? 256;
  return pool.find((s) => s >= want) ?? pool[pool.length - 1];
}

/**
 * Returns the cached logo file for a channel at the given size, fetching and producing it on a miss.
 * Null when the channel has no logo, the logo is unavailable upstream (negative-cached), or the cache is disabled.
 */
export async function getLogo(channelId: string, size: number, opts: GetLogoOptions = {}): Promise<LogoHit | null> {
  if (!config.logoCacheEnabled) return null;
  const base = baseName(channelId);
  if (!base) return null;
  const row = prep(getDb(), "SELECT logo_url FROM channels WHERE id = ? AND blocked = 0").get(channelId) as
    | { logo_url: string | null }
    | undefined;
  const url = row?.logo_url ?? null;
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const st = ensureState();
  const sz = normalizeLogoSize(size);
  const wantWebp = !!opts.webp;
  const src = hash16(url);
  // Single-flight per (channel, size, format): a burst of identical requests shares one fetch and one encode.
  return singleFlight(`${base}|${sz}|${wantWebp ? "webp" : "png"}`, async () => {
    const hit = findHit(st, base, sz, wantWebp ? ["webp", "svg"] : ["png", "svg"], src);
    if (hit) return hit;
    if (missFresh(st, base, src)) return null;
    return produce(st, { base, url, src, size: sz, wantWebp });
  });
}

/** Counts for the admin status endpoint. */
export function logoCacheStats(): { cached: number; bytes: number } {
  const st = ensureState();
  return { cached: st.entries.size, bytes: st.total };
}

/** Stop the index flush timer and persist the index. Safe to call more than once. */
export function closeLogoCache() {
  if (!state) return;
  clearInterval(state.timer);
  flushIndex(state);
  state = null;
}

// ---------------------------------------------------------------------------------------------
// Production

interface ProduceArgs {
  base: string;
  url: string;
  src: string;
  size: number;
  wantWebp: boolean;
}

async function produce(st: State, a: ProduceArgs): Promise<LogoHit | null> {
  const source = await sourceOnce(a.base, a.url, a.src);
  if (!source) {
    writeMiss(st, a.base, a.src);
    return null;
  }
  let ext: Ext;
  let out: Buffer;
  try {
    if (looksLikeSvg(source)) {
      if (!svgIsSafe(source.toString("utf8"))) throw new Error("unsafe svg");
      ext = "svg";
      out = source;
    } else {
      ext = a.wantWebp ? "webp" : "png";
      out = await resize(source, a.size, ext);
    }
  } catch {
    writeMiss(st, a.base, a.src);
    return null;
  }
  const rel = imgRel(a.base, a.size, ext);
  await writeAtomic(path.join(st.dir, rel), out);
  record(st, rel, out.length, a.src);
  evict(st, rel);
  fs.rmSync(path.join(st.dir, missRel(a.base)), { force: true });
  return hitFor(st, rel, ext);
}

/** Upstream bytes for a channel, shared by concurrent producers for different sizes/formats. */
function sourceOnce(base: string, url: string, src: string): Promise<Buffer | null> {
  return singleFlight(`src|${base}|${src}`, () => download(url).catch(() => null));
}

async function download(url: string): Promise<Buffer> {
  const max = logoOptions.maxSourceBytes;
  const res = await fetch(url, {
    headers: { "user-agent": LOGO_UA, accept: "image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5" },
    signal: AbortSignal.timeout(logoOptions.fetchTimeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`upstream ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error("upstream too large");
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("upstream too large");
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error("empty upstream body");
  return Buffer.concat(chunks);
}

async function resize(input: Buffer, size: number, ext: "webp" | "png"): Promise<Buffer> {
  const img = sharp(input, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
  return ext === "webp"
    ? img.webp({ quality: 85, alphaQuality: 100, effort: 4 }).toBuffer()
    : img.png({ compressionLevel: 9 }).toBuffer();
}

/** Rejects SVG that can run script or pull in other documents. Served with a locked-down CSP as well. */
export function svgIsSafe(text: string): boolean {
  return (
    !/<script/i.test(text) &&
    !/[\s"'/]on[a-z]+\s*=/i.test(text) &&
    !/javascript:/i.test(text) &&
    !/<!(DOCTYPE|ENTITY)/i.test(text) &&
    !/<foreignObject/i.test(text)
  );
}

function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096).toString("utf8").trimStart();
  return head.startsWith("<") && /<svg[\s>]/i.test(head);
}

// ---------------------------------------------------------------------------------------------
// Cache state: lookup, negative markers, LRU index

function ensureState(): State {
  const dir = config.logoCacheDir;
  if (state && state.dir === dir) return state;
  if (state) closeLogoCache();
  fs.mkdirSync(dir, { recursive: true });
  const st: State = {
    dir,
    entries: new Map(),
    total: 0,
    dirty: false,
    timer: setInterval(() => flushIndex(st), logoOptions.indexFlushMs),
  };
  st.timer.unref();
  loadIndex(st);
  state = st;
  return st;
}

/** Scan the cache directory, reusing access times from index.json where the file still exists. */
function loadIndex(st: State) {
  let saved: Record<string, Entry> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(st.dir, "index.json"), "utf8"));
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, Entry>;
  } catch {
    saved = {};
  }
  for (const shard of fs.readdirSync(st.dir, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue;
    const shardDir = path.join(st.dir, shard.name);
    for (const f of fs.readdirSync(shardDir)) {
      const abs = path.join(shardDir, f);
      if (f.endsWith(".tmp")) {
        fs.rmSync(abs, { force: true });
        continue;
      }
      if (f.endsWith(".miss")) continue;
      const rel = `${shard.name}/${f}`;
      const stat = fs.statSync(abs);
      const old = saved[rel];
      st.entries.set(rel, {
        size: stat.size,
        atime: typeof old?.atime === "number" ? old.atime : stat.mtimeMs,
        src: typeof old?.src === "string" ? old.src : null,
      });
      st.total += stat.size;
    }
  }
}

function flushIndex(st: State) {
  if (!st.dirty) return;
  try {
    const tmp = path.join(st.dir, `index.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(st.entries)));
    fs.renameSync(tmp, path.join(st.dir, "index.json"));
    st.dirty = false;
  } catch {
    // Index is advisory (atimes only); a failed flush is retried on the next tick.
  }
}

function record(st: State, rel: string, size: number, src: string | null) {
  const prev = st.entries.get(rel);
  if (prev) st.total -= prev.size;
  st.entries.set(rel, { size, atime: Date.now(), src });
  st.total += size;
  st.dirty = true;
}

/** Evict least-recently-accessed files down to 90% of LOGO_CACHE_MAX_MB. The file just written is protected. */
function evict(st: State, protect: string) {
  const max = config.logoCacheMaxMb * 1024 * 1024;
  if (st.total <= max) return;
  const target = max * 0.9;
  const order = [...st.entries].filter(([rel]) => rel !== protect).sort((a, b) => a[1].atime - b[1].atime);
  for (const [rel, e] of order) {
    if (st.total <= target) break;
    fs.rmSync(path.join(st.dir, rel), { force: true });
    st.entries.delete(rel);
    st.total -= e.size;
    st.dirty = true;
  }
}

/** Looks for a usable cached variant among candidates (in preference order). Touches the entry on a hit. */
function findHit(st: State, base: string, size: number, candidates: Ext[], src: string): LogoHit | null {
  for (const ext of candidates) {
    const rel = imgRel(base, size, ext);
    const entry = st.entries.get(rel);
    if (entry && entry.src !== null && entry.src !== src) continue; // upstream URL changed: regenerate
    if (!fs.existsSync(path.join(st.dir, rel))) {
      if (entry) {
        st.total -= entry.size;
        st.entries.delete(rel);
        st.dirty = true;
      }
      continue;
    }
    if (!entry) record(st, rel, fs.statSync(path.join(st.dir, rel)).size, null);
    return hitFor(st, rel, ext);
  }
  return null;
}

function hitFor(st: State, rel: string, ext: Ext): LogoHit {
  const abs = path.join(st.dir, rel);
  const stat = fs.statSync(abs);
  const e = st.entries.get(rel);
  if (e) {
    e.atime = Date.now();
    st.dirty = true;
  }
  return {
    path: abs,
    contentType: CONTENT_TYPES[ext],
    etag: `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`,
    size: stat.size,
  };
}

function missFresh(st: State, base: string, src: string): boolean {
  let marker: { t?: unknown; src?: unknown };
  try {
    marker = JSON.parse(fs.readFileSync(path.join(st.dir, missRel(base)), "utf8"));
  } catch {
    return false;
  }
  return marker.src === src && typeof marker.t === "number" && Date.now() - marker.t < logoOptions.negativeTtlMs;
}

function writeMiss(st: State, base: string, src: string) {
  const abs = path.join(st.dir, missRel(base));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ t: Date.now(), src }));
}

async function writeAtomic(abs: string, data: Buffer) {
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, abs);
}

// ---------------------------------------------------------------------------------------------
// Helpers

/** Channel id -> filesystem-safe base name. Null if the id cannot be used as a file name. */
function baseName(channelId: string): string | null {
  if (!channelId) return null;
  const base = encodeURIComponent(channelId);
  return base.length <= 200 ? base : null;
}

function shardOf(base: string): string {
  return createHash("sha1").update(base).digest("hex").slice(0, 2);
}

function imgRel(base: string, size: number, ext: Ext): string {
  return `${shardOf(base)}/${base}-${size}.${ext}`;
}

function missRel(base: string): string {
  return `${shardOf(base)}/${base}.miss`;
}

function hash16(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = flights.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => flights.delete(key));
  flights.set(key, p);
  return p;
}
