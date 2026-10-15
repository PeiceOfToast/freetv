// Fetches one page of channels. Every change aborts the previous in-flight request.
import { useEffect, useState } from "react";
import { api, type ChannelQuery, type ChannelSummary, type Paged } from "@/lib/api";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

interface ChannelsState {
  data: Paged<ChannelSummary> | null;
  error: string | null;
  loading: boolean;
}

/** Pass `null` to skip fetching (e.g. favorites-only with nothing starred). */
export function useChannels(query: ChannelQuery | null): ChannelsState & { retry: () => void } {
  const key = query ? JSON.stringify(query) : null;
  const [state, setState] = useState<ChannelsState>({ data: null, error: null, loading: key !== null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key === null) {
      setState((s) => (s.loading || s.error ? { data: null, error: null, loading: false } : s));
      return;
    }
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .channels(JSON.parse(key) as ChannelQuery, ac.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: errorMessage(e) }));
      });
    return () => ac.abort();
  }, [key, attempt]);

  return { ...state, retry: () => setAttempt((a) => a + 1) };
}
