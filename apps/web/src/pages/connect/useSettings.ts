// Module-wide cache for GET /api/settings. Any page can call useSettings(); the request runs once per
// page load. A failed request is not cached, so the next mount retries. The admin settings form calls
// loadSettings(true) after a save so every page sees the new values without a reload.
import { useEffect, useState } from "react";
import { api, type Settings } from "@/lib/api";

let cached: Settings | null = null;
let inflight: Promise<Settings> | null = null;
const listeners = new Set<() => void>();

/** Returns the cached settings, or fetches them. `force` bypasses the cache. */
export function loadSettings(force = false): Promise<Settings> {
  if (!force && cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .settings()
      .then((s) => {
        cached = s;
        listeners.forEach((l) => l());
        return s;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export interface SettingsState {
  /** Null while loading or when the request failed. */
  settings: Settings | null;
  loading: boolean;
  error: string | null;
}

export function useSettings(): SettingsState {
  const [state, setState] = useState<SettingsState>(() => ({ settings: cached, loading: cached === null, error: null }));

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (alive && cached) setState({ settings: cached, loading: false, error: null });
    };
    listeners.add(sync);
    if (!cached) {
      loadSettings().then(
        (s) => {
          if (alive) setState({ settings: s, loading: false, error: null });
        },
        (e: unknown) => {
          if (alive) setState({ settings: null, loading: false, error: e instanceof Error ? e.message : "Could not load settings." });
        },
      );
    }
    return () => {
      alive = false;
      listeners.delete(sync);
    };
  }, []);

  return state;
}
