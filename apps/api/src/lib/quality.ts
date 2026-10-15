/** Parse iptv-org quality strings ("1080p", "576i", null) into a rank: 0 unknown, 1 sd, 2 720p, 3 1080p, 4 2160p+. */
export function qualityRank(q: string | null | undefined): number {
  if (!q) return 0;
  const m = /^(\d{3,4})/.exec(q.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  if (h >= 2160) return 4;
  if (h >= 1080) return 3;
  if (h >= 720) return 2;
  return 1;
}
export const QUALITY_MIN_RANK: Record<string, number> = { sd: 1, "720p": 2, "1080p": 3, "2160p": 4 };
