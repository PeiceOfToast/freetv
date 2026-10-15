// "Reduced data" preference: play the lowest-quality stream first. It is a per-viewer convenience,
// so it lives in localStorage. The default follows the browser's Save-Data hint when no choice is stored.
import { useSyncExternalStore } from "react";

const KEY = "freetv:save-data";

type NavigatorWithConnection = Navigator & { connection?: { saveData?: boolean } };

function systemSaveData(): boolean {
  try {
    return (navigator as NavigatorWithConnection).connection?.saveData === true;
  } catch {
    return false;
  }
}

let cache: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (cache !== null) return cache;
  let stored: boolean | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "1") stored = true;
    else if (raw === "0") stored = false;
  } catch {
    /* private mode or blocked storage */
  }
  cache = stored ?? systemSaveData();
  return cache;
}

function write(v: boolean) {
  cache = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

const store = {
  get: read,
  set: write,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useSaveData(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  return [value, store.set];
}
