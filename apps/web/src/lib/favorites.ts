// Favorites live in localStorage; this tiny store lets any component subscribe.
import { useSyncExternalStore } from "react";
const KEY = "freetv:favorites";
let cache: string[] | null = null;
const listeners = new Set<() => void>();
function read(): string[] {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]; } catch { cache = []; }
  return cache;
}
function write(next: string[]) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}
export const favorites = {
  get: read,
  has: (id: string) => read().includes(id),
  toggle(id: string) { const cur = read(); write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
export function useFavorites(): string[] { return useSyncExternalStore(favorites.subscribe, favorites.get, favorites.get); }
export function useIsFavorite(id: string): boolean { return useFavorites().includes(id); }
