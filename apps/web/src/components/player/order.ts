import type { StreamInfo } from "@/lib/api";

/** Vertical resolution for a quality label such as "1080p" or "sd"; null when unknown. */
export function qualityHeight(q: string | null): number | null {
  if (!q) return null;
  const s = q.trim().toLowerCase();
  if (s === "sd") return 480;
  const m = /^(\d{3,4})p?$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** Online first, then never checked, then offline. Matches the API's ordering. */
function healthGroup(online: boolean | null): number {
  return online === true ? 0 : online === null ? 1 : 2;
}

/**
 * Reduced data: within the online and never-checked groups, the lowest known quality comes first
 * (unknown quality last). Offline streams keep the API order. With the preference off, the API
 * order is returned untouched, since the API already ranks streams for playback.
 */
export function orderStreams(streams: StreamInfo[], reduced: boolean): StreamInfo[] {
  if (!reduced) return streams;
  return streams
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const g = healthGroup(a.s.online) - healthGroup(b.s.online);
      if (g !== 0) return g;
      if (healthGroup(a.s.online) === 2) return a.i - b.i;
      const ha = qualityHeight(a.s.quality) ?? Number.POSITIVE_INFINITY;
      const hb = qualityHeight(b.s.quality) ?? Number.POSITIVE_INFINITY;
      if (ha !== hb) return ha < hb ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.s);
}
