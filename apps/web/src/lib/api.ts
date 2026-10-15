// The only module that knows API URLs. Types mirror docs/API.md.

export interface ProgrammeBrief { title: string; start: number; stop: number; description?: string | null; category?: string | null; icon?: string | null }
export interface Programme extends ProgrammeBrief { description: string | null; category: string | null; icon: string | null }

export interface ChannelSummary {
  id: string; name: string; country: string | null; countryName: string | null; flag: string | null;
  categories: string[]; languages: string[]; network: string | null; isNsfw: boolean;
  logo: string | null; streamCount: number; bestQuality: string | null; online: boolean | null; hasGuide: boolean;
  now?: ProgrammeBrief | null;
}

export interface StreamInfo {
  index: number; url: string; title: string | null; quality: string | null; labels: string[]; feed: string | null;
  userAgent: string | null; referrer: string | null; online: boolean | null; lastChecked: number | null; proxyUrl?: string;
}

export interface ChannelDetail {
  id: string; name: string; altNames: string[]; network: string | null; owners: string[];
  country: string | null; countryName: string | null; flag: string | null;
  categories: { id: string; name: string }[]; languages: { code: string; name: string }[];
  broadcastArea: string[]; isNsfw: boolean; launched: string | null; closed: string | null; replacedBy: string | null;
  website: string | null; logo: string | null; streams: StreamInfo[];
  guides: { site: string; siteId: string; lang: string | null }[];
  now: Programme | null; next: Programme | null;
}

export interface Category { id: string; name: string; description: string | null; channelCount: number }
export interface Country { code: string; name: string; flag: string | null; channelCount: number }
export interface Language { code: string; name: string; channelCount: number }
export interface Meta {
  channels: number; streams: number; channelsWithStreams: number; lastIngest: number | null; lastEpgImport: number | null;
  programmes: number; proxyEnabled: boolean; hideNsfwDefault: boolean; version: string;
}
export interface Paged<T> { total: number; page: number; limit: number; items: T[] }

export type SortKey = "relevance" | "name" | "country" | "streams" | "quality" | "updated";
export interface ChannelQuery {
  q?: string; category?: string[]; country?: string[]; language?: string[];
  hasStream?: boolean; online?: boolean; nsfw?: boolean; quality?: "sd" | "720p" | "1080p" | "2160p";
  favorites?: string[]; sort?: SortKey; order?: "asc" | "desc"; page?: number; limit?: number; withNow?: boolean;
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function get<T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
  }
  const res = await fetch(url.toString(), { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const api = {
  meta: (signal?: AbortSignal) => get<Meta>("/api/meta", undefined, signal),
  categories: (withStreams = true) => get<Category[]>("/api/categories", { withStreams }),
  countries: (withStreams = true) => get<Country[]>("/api/countries", { withStreams }),
  languages: (withStreams = true) => get<Language[]>("/api/languages", { withStreams }),
  channels: (q: ChannelQuery, signal?: AbortSignal) => get<Paged<ChannelSummary>>("/api/channels", q as Record<string, unknown>, signal),
  channel: (id: string, signal?: AbortSignal) => get<ChannelDetail>(`/api/channels/${encodeURIComponent(id)}`, undefined, signal),
  channelEpg: (id: string, from?: number, to?: number, signal?: AbortSignal) =>
    get<{ channel: string; items: Programme[] }>(`/api/channels/${encodeURIComponent(id)}/epg`, { from, to }, signal),
  epgNow: (ids: string[], signal?: AbortSignal) =>
    get<Record<string, { now: Programme | null; next: Programme | null }>>("/api/epg/now", { ids }, signal),
  epgGrid: (ids: string[], from: number, to: number, signal?: AbortSignal) =>
    get<{ from: number; to: number; channels: Record<string, Programme[]> }>("/api/epg/grid", { ids, from, to }, signal),
  play: (id: string, index: number) =>
    get<{ url: string; proxyUrl?: string; userAgent: string | null; referrer: string | null }>(`/api/stream/${encodeURIComponent(id)}/${index}/play`),
};
