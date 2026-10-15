// Keyboard shortcuts. Handlers are ignored while typing in a field or with a modifier key held.
import { useEffect, useRef } from "react";

export interface ShortcutItem {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** The cheat-sheet content. Keep in step with the handlers in Layout, BrowsePage and Player. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Everywhere",
    items: [
      { keys: ["?"], label: "Show this list" },
      { keys: ["g"], label: "Open the guide" },
      { keys: ["t"], label: "Open TV mode" },
      { keys: ["Esc"], label: "Close a dialog" },
    ],
  },
  {
    title: "Browse",
    items: [
      { keys: ["/"], label: "Focus search" },
      { keys: ["f"], label: "Toggle favorites only" },
    ],
  },
  {
    title: "Player",
    items: [
      { keys: ["Space"], label: "Play or pause" },
      { keys: ["m"], label: "Mute or unmute" },
      { keys: ["f"], label: "Fullscreen" },
      { keys: ["p"], label: "Picture-in-picture" },
      { keys: ["←", "→"], label: "Seek back or forward 10 s" },
    ],
  },
];

/** True when the key event comes from an editable field. Shortcuts must not steal typed characters. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
}

/**
 * Runs `map[e.key]` on window keydown. Plain keys only: Ctrl, Meta and Alt combinations pass through.
 * Handlers are read through a ref, so callers can pass a fresh object each render.
 */
export function useKeyHandler(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const fn = ref.current[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
