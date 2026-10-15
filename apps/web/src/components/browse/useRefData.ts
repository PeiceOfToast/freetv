// Categories, countries and languages are fetched once per page load and cached at module scope.
import { useCallback, useEffect, useState } from "react";
import { api, type Category, type Country, type Language } from "@/lib/api";
import { errorMessage } from "./useChannels";

export interface RefData { categories: Category[]; countries: Country[]; languages: Language[] }

let cache: RefData | null = null;
let inflight: Promise<RefData> | null = null;

function loadRef(): Promise<RefData> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = Promise.all([api.categories(true), api.countries(true), api.languages(true)])
      .then(([categories, countries, languages]) => {
        cache = { categories, countries, languages };
        return cache;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useRefData(): { data: RefData | null; error: string | null; retry: () => void } {
  const [data, setData] = useState<RefData | null>(cache);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cache) { setData(cache); return; }
    let alive = true;
    setError(null);
    loadRef()
      .then((d) => { if (alive) setData(d); })
      .catch((e: unknown) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { data, error, retry };
}
