// Google Cast (Chromecast) sender for FreeTV.
//
// The Web Sender SDK is loaded lazily, only when the browser can cast and only on the watch
// page (the first component that calls useCastState). If the script is blocked or fails,
// status.ready stays false and the Cast button never appears.
import { useEffect, useSyncExternalStore } from "react";

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const SDK_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 4;
const HLS_TYPE = "application/x-mpegURL";

export type CastState = "NO_DEVICES_AVAILABLE" | "NOT_CONNECTED" | "CONNECTING" | "CONNECTED";

export interface CastMedia {
  /** Channel id. Lets the page tell whether the receiver already shows this channel. */
  id?: string;
  title: string;
  logo?: string | null;
  /** Absolute URL of the first stream to try. */
  url: string;
  contentType?: string;
  /** Further absolute URLs, tried in order when the receiver reports a failure. */
  fallbackUrls?: string[];
}

export interface CastStatus {
  /** SDK loaded and initialised. When false, no Cast UI should be shown. */
  ready: boolean;
  state: CastState;
  deviceName: string | null;
  paused: boolean;
  /** What this page last started on the receiver, if anything. */
  loaded: { id?: string; title: string } | null;
  error: string | null;
}

/**
 * Cast Web Sender runs in desktop Chromium (Chrome, Edge) over HTTPS.
 * iOS browsers cannot use it. Android Chrome is excluded too: it gets the Remote Playback
 * API instead (see AirPlayButton).
 */
export function castSupported(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android/.test(ua)) return false;
  return /\b(Chrome|Chromium|Edg)\//.test(ua);
}

/**
 * Absolute URLs to cast for a channel, one per stream in playback order.
 * A relayed URL (proxyUrl) is preferred: the receiver needs CORS, and the relay adds it.
 * A direct stream is used only if it is https, because an https page cannot hand the
 * receiver an http:// URL. Streams with neither are skipped.
 */
export function castCandidates(streams: { url: string; proxyUrl?: string }[]): string[] {
  const out: string[] = [];
  for (const s of streams) {
    if (s.proxyUrl) out.push(new URL(s.proxyUrl, window.location.origin).href);
    else if (s.url.startsWith("https://")) out.push(s.url);
  }
  return out;
}

// ---- store -----------------------------------------------------------------

const EMPTY: CastStatus = { ready: false, state: "NO_DEVICES_AVAILABLE", deviceName: null, paused: false, loaded: null, error: null };
let status: CastStatus = EMPTY;
const listeners = new Set<() => void>();

function setStatus(patch: Partial<CastStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getStatus = () => status;

// ---- SDK loading -----------------------------------------------------------

interface Active {
  id?: string;
  title: string;
  logo: string | null;
  contentType: string;
  urls: string[];
  index: number;
  token: number;
  session: cast.framework.CastSession;
}

let active: Active | null = null;
let tokenSeq = 0;
let initPromise: Promise<boolean> | null = null;
let remotePlayer: cast.framework.RemotePlayer | null = null;
let controller: cast.framework.RemotePlayerController | null = null;
const hookedSessions = new WeakSet<object>();

function loadSdk(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof cast !== "undefined" && cast.framework) {
      resolve(true);
      return;
    }
    let timer: number | undefined;
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      resolve(ok);
    };
    timer = window.setTimeout(() => done(false), SDK_TIMEOUT_MS);
    window.__onGCastApiAvailable = (ok) => done(ok);

    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => done(false); // blocked by an ad blocker, or offline
    document.head.appendChild(script);
  });
}

function currentDeviceName(): string | null {
  try {
    return cast.framework.CastContext.getInstance().getCurrentSession()?.getCastDevice().friendlyName ?? null;
  } catch {
    return null;
  }
}

function loadedInfo(): CastStatus["loaded"] {
  return active ? { id: active.id, title: active.title } : null;
}

function onCastState(state: CastState) {
  if (state === "NOT_CONNECTED" || state === "NO_DEVICES_AVAILABLE") active = null;
  setStatus({
    state,
    deviceName: state === "CONNECTED" ? currentDeviceName() : null,
    loaded: loadedInfo(),
    paused: false,
    error: null,
  });
}

function initCast(): boolean {
  if (typeof cast === "undefined" || !cast.framework || typeof chrome === "undefined" || typeof chrome.cast === "undefined") {
    return false;
  }
  const ctx = cast.framework.CastContext.getInstance();
  ctx.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  ctx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e) => onCastState(e.castState));

  remotePlayer = new cast.framework.RemotePlayer();
  controller = new cast.framework.RemotePlayerController(remotePlayer);
  controller.addEventListener(cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED, () => {
    setStatus({ paused: remotePlayer?.isPaused ?? false });
  });

  const state = ctx.getCastState();
  setStatus({ ready: true, state, deviceName: state === "CONNECTED" ? currentDeviceName() : null });
  return true;
}

/** Loads and initialises the SDK once. Resolves false if Cast is unavailable. */
export function ensureCast(): Promise<boolean> {
  if (!castSupported()) return Promise.resolve(false);
  initPromise ??= loadSdk().then((ok) => {
    try {
      return ok && initCast();
    } catch {
      return false;
    }
  });
  return initPromise;
}

// ---- playback --------------------------------------------------------------

function watchSession(session: cast.framework.CastSession) {
  const obj = session.getSessionObj();
  if (hookedSessions.has(obj)) return;
  hookedSessions.add(obj);
  // A media object is announced for each load. Attribute its errors to the attempt that
  // was current when it was announced, then fall back to the next stream.
  obj.addMediaListener((media) => {
    const a = active;
    if (!a) return;
    const { token, index } = a;
    media.addUpdateListener(() => {
      if (media.playerState === "IDLE" && media.idleReason === "ERROR") failAttempt(token, index);
    });
  });
}

function failAttempt(token: number, index: number) {
  const a = active;
  if (!a || a.token !== token || a.index !== index) return; // already handled or superseded
  if (index + 1 < a.urls.length) {
    a.index = index + 1;
    void loadAttempt(a);
  } else {
    active = null;
    setStatus({ loaded: null, error: "The receiver could not play this channel. Try again later." });
  }
}

async function loadAttempt(a: Active) {
  const { token, index } = a;
  const info = new chrome.cast.media.MediaInfo(a.urls[index], a.contentType);
  info.streamType = chrome.cast.media.StreamType.LIVE;
  const md = new chrome.cast.media.GenericMediaMetadata();
  md.metadataType = chrome.cast.media.MetadataType.GENERIC;
  md.title = a.title;
  if (a.logo) md.images = [new chrome.cast.Image(a.logo)];
  info.metadata = md;
  const req = new chrome.cast.media.LoadRequest(info);
  req.autoplay = true;
  try {
    await a.session.loadMedia(req);
  } catch {
    failAttempt(token, index);
  }
}

/**
 * Starts `media` on the receiver. Opens the device picker first when there is no session.
 * Resolves false if Cast is unavailable or the user dismissed the picker.
 */
export async function castChannel(media: CastMedia): Promise<boolean> {
  if (!(await ensureCast())) return false;
  const ctx = cast.framework.CastContext.getInstance();
  let session = ctx.getCurrentSession();
  if (!session) {
    try {
      await ctx.requestSession();
    } catch {
      return false;
    }
    session = ctx.getCurrentSession();
    if (!session) return false;
  }
  watchSession(session);

  const a: Active = {
    id: media.id,
    title: media.title,
    logo: media.logo ?? null,
    contentType: media.contentType ?? HLS_TYPE,
    urls: [media.url, ...(media.fallbackUrls ?? [])].slice(0, MAX_ATTEMPTS),
    index: 0,
    token: ++tokenSeq,
    session,
  };
  active = a;
  setStatus({ loaded: loadedInfo(), paused: false, error: null });
  void loadAttempt(a);
  return true;
}

/** Ends the Cast session and stops the receiver app. */
export function stopCasting(): void {
  active = null;
  setStatus({ loaded: null, paused: false, error: null });
  if (typeof cast === "undefined" || !cast.framework) return;
  cast.framework.CastContext.getInstance().endCurrentSession(true);
}

/** Toggles play or pause on the receiver. */
export function castPlayPause(): void {
  if (active) controller?.playOrPause();
}

// ---- React -----------------------------------------------------------------

/**
 * Cast status for the UI. The first mount starts loading the SDK when the browser supports it.
 */
export function useCastState(): CastStatus {
  useEffect(() => {
    if (castSupported()) void ensureCast();
  }, []);
  return useSyncExternalStore(subscribe, getStatus, getStatus);
}
