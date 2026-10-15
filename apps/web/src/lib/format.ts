export const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const nowTs = () => Math.floor(Date.now() / 1000);
export function progress(start: number, stop: number, now = nowTs()) { return Math.min(1, Math.max(0, (now - start) / Math.max(1, stop - start))); }
