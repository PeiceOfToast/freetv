import { useEffect, useState } from "react";
export type Theme = "dark" | "light" | "system";
const KEY = "freetv:theme";
export function getTheme(): Theme { try { return (localStorage.getItem(KEY) as Theme) || "system"; } catch { return "system"; } }
export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = t;
}
export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(getTheme);
  useEffect(() => { applyTheme(t); try { localStorage.setItem(KEY, t); } catch { /* */ } }, [t]);
  return [t, setT];
}
