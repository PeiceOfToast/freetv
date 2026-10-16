// Builds the playlist and guide URLs from the public base and the customise choices (docs/API.md "Exports").
export type QualityChoice = "" | "720p" | "1080p" | "2160p";

export interface PlaylistChoices {
  countries: string[];
  categories: string[];
  quality: QualityChoice;
  /** Pass the favorite ids to restrict the playlist to them; null leaves the favorites filter off. */
  favorites: string[] | null;
  allStreams: boolean;
}

/** Above this many favorites the favorites-only URL gets long enough that some apps truncate it. */
export const FAVORITES_WARN_AT = 150;

export function normaliseBase(publicUrl: string): string {
  return publicUrl.trim().replace(/\/+$/, "");
}

export function buildPlaylistUrl(base: string, c: PlaylistChoices): string {
  const parts: string[] = [];
  // Commas separate list values, so they stay literal; each value is encoded on its own.
  const list = (key: string, values: string[]) => {
    if (values.length) parts.push(`${key}=${values.map((v) => encodeURIComponent(v)).join(",")}`);
  };
  list("country", c.countries);
  list("category", c.categories);
  if (c.quality) parts.push(`quality=${c.quality}`);
  if (c.favorites && c.favorites.length) list("favorites", c.favorites);
  if (c.allStreams) parts.push("streams=all");
  return `${base}/api/playlist.m3u${parts.length ? `?${parts.join("&")}` : ""}`;
}

export function buildGuideUrl(base: string): string {
  return `${base}/api/guide.xml`;
}
