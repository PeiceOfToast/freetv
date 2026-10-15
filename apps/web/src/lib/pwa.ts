import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/* Install prompt, update notice and iOS "Add to Home Screen" hint. Module-level state so that
 * events fired before React mounts (beforeinstallprompt, service worker update) are not lost. */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// ---- Install prompt (Chromium / Android / desktop) --------------------------------------------

let deferredInstall: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the event so the header button can trigger it
    deferredInstall = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    emit();
  });
}

/** True only while the browser has offered an install prompt that has not been used. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, () => deferredInstall !== null, () => false);
}

export async function promptInstall(): Promise<void> {
  const e = deferredInstall;
  if (!e) return;
  deferredInstall = null;
  emit();
  try {
    await e.prompt();
    await e.userChoice;
  } catch {
    /* prompt already used or blocked */
  }
}

// ---- Service worker update -----------------------------------------------------------------

let updateReady = false;

/** Called by registerSW's onNeedReload (the worker has updated; a reload applies it). */
export function notifyUpdateAvailable(): void {
  updateReady = true;
  emit();
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribe, () => updateReady, () => false);
}

export function reloadForUpdate(): void {
  window.location.reload();
}

// ---- iOS Safari "Share -> Add to Home Screen" hint --------------------------------------------

const IOS_HINT_KEY = "freetv:ios-install-hint-seen";

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  return ios && safari;
}

function hintSeen(): boolean {
  try {
    return localStorage.getItem(IOS_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markHintSeen(): void {
  try {
    localStorage.setItem(IOS_HINT_KEY, "1");
  } catch {
    /* private mode */
  }
}

/** Shows the hint once per browser (it is marked seen when first displayed), until dismissed. */
export function useIosInstallHint(): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isIosSafari() && !isStandalone() && !hintSeen()) {
      markHintSeen();
      setShow(true);
    }
  }, []);
  const dismiss = useCallback(() => setShow(false), []);
  return { show, dismiss };
}

