// Operator settings (docs/API.md "Settings"). Stored in the `settings` table as JSON values; env supplies
// the defaults. Reads are cached per DB handle; a write drops the cache and bumps the generation so
// anything memoised on it (the M3U body memo) can tell that the settings changed.
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getDb, type Db } from "../db/index.js";
import { badRequest } from "./http.js";
import { prep } from "./sql.js";

export const FEATURED_APPS = ["tivimate", "vlc", "kodi", "plex", "jellyfin", "smarters", "generic"] as const;
export type FeaturedApp = (typeof FEATURED_APPS)[number];

export interface Settings {
  siteName: string;
  /** Stored value, else PUBLIC_URL, else "" (callers then fall back to the request origin). No trailing slash. */
  publicUrl: string;
  contact: string;
  notes: string;
  featuredApps: FeaturedApp[];
}

export const SETTING_KEYS = ["siteName", "publicUrl", "contact", "notes", "featuredApps"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const isKey = (k: string): k is SettingKey => (SETTING_KEYS as readonly string[]).includes(k);

/** What env provides when nothing is stored. */
export function envDefaults(): Settings {
  return {
    siteName: "FreeTV",
    publicUrl: config.publicUrl,
    contact: "",
    notes: "",
    featuredApps: ["tivimate", "vlc", "kodi", "plex", "jellyfin"],
  };
}

let cache: { db: Db; stored: Partial<Record<SettingKey, unknown>> } | null = null;
let generation = 0;

/** Bumped on every successful write. */
export function settingsGeneration(): number {
  return generation;
}

function storedValues(db: Db): Partial<Record<SettingKey, unknown>> {
  if (cache && cache.db === db) return cache.stored;
  const rows = prep(db, "SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  const stored: Partial<Record<SettingKey, unknown>> = {};
  for (const r of rows) {
    if (!isKey(r.key)) continue;
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      // A malformed row is ignored, so the env default applies.
    }
  }
  cache = { db, stored };
  return stored;
}

/** Merged settings: stored values over env defaults. An empty stored publicUrl means "use PUBLIC_URL". */
export function getSettings(): Settings {
  const stored = storedValues(getDb());
  const env = envDefaults();
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v !== "" ? v : fallback);
  return {
    siteName: text(stored.siteName, env.siteName),
    publicUrl: text(stored.publicUrl, env.publicUrl).replace(/\/+$/, ""),
    contact: typeof stored.contact === "string" ? stored.contact : env.contact,
    notes: typeof stored.notes === "string" ? stored.notes : env.notes,
    featuredApps: Array.isArray(stored.featuredApps) ? (stored.featuredApps as FeaturedApp[]) : env.featuredApps,
  };
}

/** Raw stored values for the admin view: each key's stored value, or null when nothing is stored. */
export function storedSettings(): Record<SettingKey, unknown> {
  const stored = storedValues(getDb());
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, stored[k] ?? null])) as Record<SettingKey, unknown>;
}

export function relayEnabled(): boolean {
  return config.proxyEnabled && config.proxySecret !== "";
}

const str = (k: string, v: unknown): string => {
  if (typeof v !== "string") throw badRequest(`${k} must be a string`);
  return v;
};

function validate(k: SettingKey, v: unknown): unknown {
  switch (k) {
    case "siteName": {
      const s = str(k, v).trim();
      if (s === "") throw badRequest("siteName must not be empty");
      if (s.length > 60) throw badRequest("siteName must be at most 60 characters");
      if (/[\x00-\x1f\x7f]/.test(s)) throw badRequest("siteName must not contain control characters");
      return s;
    }
    case "publicUrl": {
      const s = str(k, v).trim().replace(/\/+$/, "");
      if (s === "") return "";
      let u: URL;
      try {
        u = new URL(s);
      } catch {
        throw badRequest("publicUrl must be an http or https URL, or empty to use PUBLIC_URL");
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw badRequest("publicUrl must be an http or https URL");
      return s;
    }
    case "contact": {
      const s = str(k, v).trim();
      if (s.length > 200) throw badRequest("contact must be at most 200 characters");
      return s;
    }
    case "notes": {
      // Plain text: tags are removed, so a pasted <script> is inert text at most.
      const s = str(k, v).replace(/<[^>]*>/g, "").trim();
      if (s.length > 2000) throw badRequest("notes must be at most 2000 characters");
      return s;
    }
    case "featuredApps": {
      if (!Array.isArray(v)) throw badRequest("featuredApps must be an array");
      const out: FeaturedApp[] = [];
      for (const a of v) {
        if (typeof a !== "string" || !(FEATURED_APPS as readonly string[]).includes(a)) {
          throw badRequest(`featuredApps contains an unknown app: ${String(a)}`);
        }
        if (!out.includes(a as FeaturedApp)) out.push(a as FeaturedApp);
      }
      return out;
    }
  }
}

/**
 * Validates a partial update and stores it in one transaction. Unknown keys and invalid values throw
 * HttpError(400) naming the key. Returns the merged settings afterwards.
 */
export function updateSettings(input: unknown): Settings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw badRequest("body must be a JSON object");
  const entries = Object.entries(input as Record<string, unknown>);
  for (const [k] of entries) if (!isKey(k)) throw badRequest(`unknown setting: ${k}`);
  const updates = entries.map(([k, v]) => [k as SettingKey, validate(k as SettingKey, v)] as const);

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const upsert = prep(db, "INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
  db.transaction(() => {
    for (const [k, v] of updates) upsert.run(k, JSON.stringify(v), now);
  }).immediate();
  cache = null;
  generation++;
  return getSettings();
}

const firstValue = (v: string | string[] | undefined): string | undefined => {
  const first = (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  return first ? first : undefined;
};

/** The request's own origin, honouring X-Forwarded-Proto and X-Forwarded-Host. */
export function requestOrigin(req: FastifyRequest): string {
  const proto = firstValue(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const host = firstValue(req.headers["x-forwarded-host"]) ?? firstValue(req.headers.host) ?? "localhost";
  return `${proto}://${host}`;
}

/** Stored publicUrl, else PUBLIC_URL, else the request origin. Used for every absolute URL in exports. */
export function publicBase(req: FastifyRequest): string {
  return getSettings().publicUrl || requestOrigin(req);
}
