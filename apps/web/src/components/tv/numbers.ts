// Channel number lookup for the TV UI. Numbers come from the API (`ChannelSummary.number`, stable per
// instance). Every channel the TV UI has seen is remembered here, so a number that is already known
// resolves without a request. An unknown number is looked up in the name-sorted list: numbers were
// handed out in name order at first ingest, so page ceil(n / PAGE) is the best guess. The API has no
// number filter, so a number added later can still be missed; callers then say "No channel N".
import { api } from "@/lib/api";

export interface NumberedChannel { id: string; name: string; number: number | null | undefined }

const PAGE = 200;
const byNumber = new Map<number, { id: string; name: string }>();
const fetched = new Set<number>();
const inflight = new Map<number, Promise<void>>();

/** Remember the channel numbers in any list the UI has loaded. */
export function remember(items: NumberedChannel[]): void {
  for (const c of items) {
    if (typeof c.number === "number") byNumber.set(c.number, { id: c.id, name: c.name });
  }
}

/** The channel with this number if it is already known, else null. Never fetches. */
export function lookup(n: number): { id: string; name: string } | null {
  return byNumber.get(n) ?? null;
}

function loadPage(page: number): Promise<void> {
  if (fetched.has(page)) return Promise.resolve();
  let p = inflight.get(page);
  if (!p) {
    // nsfw: true so the list matches the numbering (numbers cover every channel, NSFW included).
    p = api.channels({ hasStream: true, nsfw: true, limit: PAGE, page, sort: "name" })
      .then((r) => { fetched.add(page); remember(r.items); })
      .finally(() => { inflight.delete(page); });
    inflight.set(page, p);
  }
  return p;
}

/** Resolve a channel number: memory first, then the guessed page. Null when it is not found. */
export async function resolve(n: number): Promise<{ id: string; name: string } | null> {
  if (!Number.isInteger(n) || n < 1) return null;
  const hit = lookup(n);
  if (hit) return hit;
  // Exact lookup via the API (covers channels numbered after the first ingest), then the page guess.
  try {
    const d = await api.channelByNumber(n);
    byNumber.set(n, { id: d.id, name: d.name });
    return { id: d.id, name: d.name };
  } catch {
    /* 404 or offline: fall through */
  }
  await loadPage(Math.ceil(n / PAGE));
  return lookup(n);
}
