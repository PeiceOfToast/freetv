// TV settings and small persisted state. Every localStorage/sessionStorage access is guarded
// because TV browsers can have storage disabled or throw on access.

export interface TvSettings {
  hideNsfw: boolean | null; // null = follow API default (hideNsfwDefault)
  preferredQuality: "any" | "sd" | "720p" | "1080p" | "2160p";
  preferRelay: boolean;
}

const KEY = "freetv:tv-settings";
const RECENT_KEY = "freetv:tv-recent";
const LIST_KEY = "freetv:tv-list";

const DEFAULTS: TvSettings = { hideNsfw: null, preferredQuality: "any", preferRelay: false };
let cache: TvSettings | null = null;
const subs = new Set<() => void>();

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep in-memory only */
  }
}

function local(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
function session(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

export const tvSettings = {
  get(): TvSettings {
    if (!cache) cache = { ...DEFAULTS, ...readJson<Partial<TvSettings>>(local(), KEY, {}) };
    return cache;
  },
  set(patch: Partial<TvSettings>) {
    cache = { ...tvSettings.get(), ...patch };
    writeJson(local(), KEY, cache);
    subs.forEach((s) => s());
  },
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => { subs.delete(fn); };
  },
};

/** `nsfw` query value for the API: undefined follows the server default. */
export function nsfwParam(): boolean | undefined {
  const h = tvSettings.get().hideNsfw;
  return h === null ? undefined : !h;
}

/** Recently watched channel ids, most recent first, max 10. */
export const tvRecent = {
  list(): string[] {
    const v = readJson<unknown>(local(), RECENT_KEY, []);
    return Array.isArray(v) ? (v as string[]).slice(0, 10) : [];
  },
  push(id: string) {
    const next = [id, ...tvRecent.list().filter((x) => x !== id)].slice(0, 10);
    writeJson(local(), RECENT_KEY, next);
  },
};

/** The "current list" the watch page zaps through: ids + the index currently playing. */
export interface TvList { label: string; ids: string[]; index: number; returnTo: string }

export const tvList = {
  get(): TvList | null {
    return readJson<TvList | null>(session(), LIST_KEY, null);
  },
  set(list: TvList) {
    writeJson(session(), LIST_KEY, list);
  },
  setIndex(index: number) {
    const cur = tvList.get();
    if (cur) writeJson(session(), LIST_KEY, { ...cur, index });
  },
};
