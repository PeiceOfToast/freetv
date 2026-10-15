// Spatial focus manager for 10-foot (TV remote) UIs.
// Anything focusable carries `data-nav` and `tabIndex={0}`. Arrow keys move focus to the
// geometrically nearest candidate in that direction; Enter clicks; Back goes up one level.
// Remote-only keys (channel up/down, digits, info, guide, play/pause) are re-broadcast
// through `tvKeys` so pages can subscribe without knowing key codes.
import { useEffect, type RefObject } from "react";

export type TvKey =
  | { type: "channel"; dir: 1 | -1 }
  | { type: "digit"; digit: number }
  | { type: "info" }
  | { type: "guide" }
  | { type: "playpause" };

type KeyListener = (k: TvKey) => void;
const listeners = new Set<KeyListener>();

export const tvKeys = {
  subscribe(fn: KeyListener) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

function emit(k: TvKey) {
  listeners.forEach((l) => l(k));
}

// Back stack: the innermost registered handler wins. Returning true means "handled".
type BackHandler = () => boolean | void;
const backStack: BackHandler[] = [];

const BACK_CODES = new Set([8, 27, 461, 10009]);
const BACK_KEYS = new Set(["Backspace", "Escape", "GoBack", "BrowserBack", "XF86Back"]);
const CH_UP_CODES = new Set([427, 33]);
const CH_DOWN_CODES = new Set([428, 34]);
const PLAY_CODES = new Set([179, 415, 19]);
const ENTER_CODES = new Set([13]);
const LEFT_CODES = new Set([37]);
const UP_CODES = new Set([38]);
const RIGHT_CODES = new Set([39]);
const DOWN_CODES = new Set([40]);
// Numpad digits on keyCode 96..105, top-row digits on 48..57.
function digitOf(e: KeyboardEvent): number | null {
  if (e.key && e.key.length === 1 && e.key >= "0" && e.key <= "9") return e.key.charCodeAt(0) - 48;
  if (e.keyCode >= 96 && e.keyCode <= 105) return e.keyCode - 96;
  if (e.keyCode >= 48 && e.keyCode <= 57) return e.keyCode - 48;
  return null;
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function navItems(scope: ParentNode): HTMLElement[] {
  const nodes = scope.querySelectorAll<HTMLElement>("[data-nav]");
  const out: HTMLElement[] = [];
  nodes.forEach((n) => {
    if (n.hasAttribute("disabled") || n.getAttribute("aria-hidden") === "true") return;
    const r = n.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    out.push(n);
  });
  return out;
}

function currentScope(active: Element | null): ParentNode {
  // Prefer the innermost [data-nav-scope] that contains focus, else the document.
  const scope = active?.closest("[data-nav-scope]");
  return scope ?? document;
}

/** Find the nearest data-nav element in a direction from `from`. Prefers same row/column. */
export function nearestInDirection(from: HTMLElement, dir: "up" | "down" | "left" | "right", scope: ParentNode = document): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of navItems(scope)) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    let primary: number;
    let cross: number;
    if (dir === "left" || dir === "right") {
      primary = dir === "right" ? dx : -dx;
      cross = Math.abs(dy);
      // Same row: the vertical overlap test keeps "right" from jumping to a row above/below.
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (primary <= 1) continue;
      if (overlap <= 0 && cross > Math.max(a.height, b.height)) {
        // Different row: allowed but heavily penalised.
        primary += 400;
      }
    } else {
      primary = dir === "down" ? dy : -dy;
      cross = Math.abs(dx);
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (primary <= 1) continue;
      if (overlap <= 0 && cross > Math.max(a.width, b.width)) {
        primary += 400;
      }
    }
    // Weighted distance: favour alignment on the cross axis, then proximity.
    const score = primary + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function focusEl(el: HTMLElement | null) {
  if (!el) return;
  el.focus({ preventScroll: true });
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {
    /* old browsers: ignore */
  }
}

/** Focus the first data-nav element inside `root` (or the document). */
export function focusFirst(root: ParentNode = document): boolean {
  const first = navItems(root)[0];
  if (first) { focusEl(first); return true; }
  return false;
}

/** Register a back handler; returns an unregister function. */
export function pushBack(fn: BackHandler): () => void {
  backStack.push(fn);
  return () => {
    const i = backStack.lastIndexOf(fn);
    if (i >= 0) backStack.splice(i, 1);
  };
}

function goBack() {
  for (let i = backStack.length - 1; i >= 0; i--) {
    const handled = backStack[i]();
    if (handled !== false) return;
  }
  if (window.history.length > 1) window.history.back();
}

// Mouse cursor auto-hide: hides after 3 s idle, shown again on any mouse move.
let cursorTimer: number | undefined;
function wakeCursor() {
  document.documentElement.classList.remove("tv-cursor-hidden");
  window.clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => {
    document.documentElement.classList.add("tv-cursor-hidden");
  }, 3000);
}

let installed = false;
/** Installs the global key/mouse handlers once. Safe to call repeatedly. */
export function installSpatialNav() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const code = e.keyCode;
    const key = e.key;

    // Keep native typing working inside inputs (on-screen keyboard uses buttons, not inputs).
    if (isTextTarget(e.target) && !BACK_CODES.has(code) && !BACK_KEYS.has(key)) return;

    const active = document.activeElement as HTMLElement | null;

    if (UP_CODES.has(code) || key === "ArrowUp" || key === "Up") return moveFocus(e, "up", active);
    if (DOWN_CODES.has(code) || key === "ArrowDown" || key === "Down") return moveFocus(e, "down", active);
    if (LEFT_CODES.has(code) || key === "ArrowLeft" || key === "Left") return moveFocus(e, "left", active);
    if (RIGHT_CODES.has(code) || key === "ArrowRight" || key === "Right") return moveFocus(e, "right", active);

    if (ENTER_CODES.has(code) || key === "Enter") {
      if (active && active.hasAttribute("data-nav")) {
        e.preventDefault();
        active.click();
      }
      return;
    }

    if (BACK_CODES.has(code) || BACK_KEYS.has(key)) {
      // Escape/Backspace inside a text field should not navigate away while typing.
      if (isTextTarget(e.target) && key !== "Escape") return;
      e.preventDefault();
      goBack();
      return;
    }

    if (CH_UP_CODES.has(code) || key === "ChannelUp") { e.preventDefault(); emit({ type: "channel", dir: 1 }); return; }
    if (CH_DOWN_CODES.has(code) || key === "ChannelDown") { e.preventDefault(); emit({ type: "channel", dir: -1 }); return; }
    if (PLAY_CODES.has(code) || key === "MediaPlayPause") { emit({ type: "playpause" }); return; }

    const d = digitOf(e);
    if (d !== null && !e.ctrlKey && !e.metaKey && !e.altKey) { emit({ type: "digit", digit: d }); return; }

    if (key === "Info" || key === "i" || key === "I") { emit({ type: "info" }); return; }
    if (key === "Guide" || key === "g" || key === "G") { emit({ type: "guide" }); return; }
  });

  window.addEventListener("mousemove", wakeCursor);
  window.addEventListener("mousedown", wakeCursor);
  wakeCursor();
}

function moveFocus(e: KeyboardEvent, dir: "up" | "down" | "left" | "right", active: HTMLElement | null) {
  e.preventDefault();
  if (!active || !active.hasAttribute("data-nav")) {
    focusFirst(document);
    return;
  }
  const scope = currentScope(active);
  const next = nearestInDirection(active, dir, scope);
  if (next) focusEl(next);
}

/**
 * Scope focus to a container. Activates the global handlers, focuses the first item
 * when nothing inside the container has focus, and optionally registers a Back handler.
 */
export function useSpatialNav(containerRef: RefObject<HTMLElement>, opts: { onBack?: BackHandler; autofocus?: boolean } = {}) {
  const { onBack, autofocus = true } = opts;
  useEffect(() => {
    installSpatialNav();
    const root = containerRef.current;
    if (autofocus && root && !root.contains(document.activeElement)) {
      // Defer so children are mounted and laid out.
      const t = window.setTimeout(() => focusFirst(root), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => (onBack ? pushBack(onBack) : undefined), [onBack]);
}
