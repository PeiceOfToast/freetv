// Grid/list preference is a per-viewer convenience, so it lives in localStorage.
import { useCallback, useState } from "react";

export type ViewMode = "grid" | "list";
const KEY = "freetv:view";

function read(): ViewMode {
  try { return localStorage.getItem(KEY) === "list" ? "list" : "grid"; } catch { return "grid"; }
}

export function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>(read);
  const set = useCallback((v: ViewMode) => {
    setView(v);
    try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
  }, []);
  return [view, set];
}
