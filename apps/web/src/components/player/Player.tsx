import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type Hls from "hls.js";
import type { StreamInfo } from "@/lib/api";
import { setMediaSession, setPlaybackState } from "@/lib/media-session";
import { useSaveData } from "@/lib/network";
import { orderStreams } from "./order";
import { ReducedDataToggle } from "./ReducedDataToggle";

export interface PlayerProps {
  streams: StreamInfo[];
  autoplay?: boolean;
  className?: string;
  /** Channel name, shown in OS media controls. Defaults to "FreeTV". */
  title?: string;
  /** Now-playing programme, shown as the artist line in OS media controls. */
  subtitle?: string;
  /** Logo URL used as artwork in OS media controls. */
  artwork?: string | null;
}

interface Attempt {
  key: string; // `${catalogIndex}:${kind}`, stable across re-orderings
  kind: "direct" | "proxy";
  label: string;
  url: string;
  quality: string | null;
}

/** lib.dom omits ScreenOrientation.lock, which Chromium and Android support. */
type LockableOrientation = ScreenOrientation & { lock(orientation: "landscape"): Promise<void> };

/** The iOS fullscreen player exposes this non-standard method on <video>. */
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const TIMEOUT_MS = 8000;
const VOL_KEY = "freetv:volume";
const SEEK_STEP = 10;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 40;
/** Taps this close to the bottom edge hit the native control bar and do not count for double-tap. */
const CONTROLS_ZONE_PX = 56;

function readVolume(): { v: number; m: boolean } {
  try {
    const j = JSON.parse(localStorage.getItem(VOL_KEY) ?? "null") as { v?: unknown; m?: unknown } | null;
    if (j && typeof j.v === "number") return { v: Math.min(1, Math.max(0, j.v)), m: j.m === true };
  } catch {
    /* private mode or corrupt value */
  }
  return { v: 1, m: false };
}

function saveVolume(v: number, m: boolean) {
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify({ v, m }));
  } catch {
    /* ignore */
  }
}

/** Media Source Extensions present, so hls.js can run. iOS Safari without MSE returns false. */
function hasMse(): boolean {
  return "MediaSource" in window || "ManagedMediaSource" in window;
}

function isPhone(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

/** Landscape lock while fullscreen on a phone. Browsers refuse it in many cases; that is fine. */
async function lockLandscape() {
  if (!isPhone()) return;
  try {
    await (screen.orientation as LockableOrientation).lock("landscape");
  } catch {
    /* unsupported, or not in fullscreen */
  }
}

function unlockOrientation() {
  try {
    screen.orientation?.unlock();
  } catch {
    /* ignore */
  }
}

function streamLabel(s: StreamInfo, pos: number): string {
  const parts = [s.quality, s.feed].filter(Boolean);
  return parts.length ? parts.join(" · ") : s.title || `Stream ${pos + 1}`;
}

/**
 * Every candidate in playback order: all direct URLs first, then all relay URLs. Streams that need a
 * User-Agent or Referer (relayOnly) skip the direct attempt, because the browser cannot send those
 * headers. A relayOnly stream with no relay URL is dropped.
 */
function allAttempts(streams: StreamInfo[]): Attempt[] {
  const out: Attempt[] = [];
  streams.forEach((s, pos) => {
    if (s.url && !s.relayOnly) {
      out.push({ key: `${s.index}:direct`, kind: "direct", label: `Direct · ${streamLabel(s, pos)}`, url: s.url, quality: s.quality });
    }
  });
  streams.forEach((s, pos) => {
    if (s.proxyUrl) {
      out.push({ key: `${s.index}:proxy`, kind: "proxy", label: `Relay · ${streamLabel(s, pos)}`, url: s.proxyUrl, quality: s.quality });
    }
  });
  return out;
}

function tryPlay(video: HTMLVideoElement, onPolicyMute: () => void) {
  video.play().catch((err: unknown) => {
    // Browser blocked unmuted autoplay: fall back to muted and let the user unmute.
    if (err instanceof DOMException && err.name === "NotAllowedError" && !video.muted) {
      video.muted = true;
      onPolicyMute();
      video.play().catch(() => undefined);
    }
  });
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-11 w-11 place-items-center rounded-md bg-black/60 text-white shadow hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
    >
      {children}
    </button>
  );
}

export function Player({ streams, autoplay = true, className = "", title, subtitle, artwork }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const policyMutedRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const [manual, setManual] = useState<string>("auto");
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [policyMuted, setPolicyMuted] = useState(false);
  /** Key of the attempt whose manifest loaded. Set only on success, so the status line can name it. */
  const [okKey, setOkKey] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const canPip = typeof document !== "undefined" && document.pictureInPictureEnabled === true;
  const [saveData] = useSaveData();

  const ordered = useMemo(() => orderStreams(streams, saveData), [streams, saveData]);
  const every = useMemo(() => allAttempts(ordered), [ordered]);
  const plan = useMemo(
    () => (manual === "auto" ? every : every.filter((a) => a.key === manual)),
    [every, manual],
  );
  const planKey = plan.map((a) => a.key).join("|");
  const cur = plan[attempt];
  const exhausted = plan.length === 0 || attempt >= plan.length;
  const okAttempt = cur && okKey === cur.key ? cur : null;

  // Restore volume once.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const { v: vol, m } = readVolume();
    v.volume = vol;
    v.muted = m;
  }, []);

  // Source loading: try plan[attempt]; on fatal error or 8 s without manifest, advance.
  useEffect(() => {
    const video = videoRef.current;
    const a = plan[attempt];
    if (!video || !a) return;
    setOkKey(null);

    let parsed = false;
    let dead = false;
    let timer: number | undefined;

    const teardown = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video.getAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
    };

    const fail = () => {
      if (dead) return;
      dead = true;
      window.clearTimeout(timer);
      teardown();
      setAttempt((x) => x + 1);
    };

    const ok = () => {
      if (dead || parsed) return;
      parsed = true;
      window.clearTimeout(timer);
      setOkKey(a.key);
      if (autoplay) tryPlay(video, () => { policyMutedRef.current = true; setPolicyMuted(true); });
    };

    timer = window.setTimeout(() => {
      if (!parsed) fail();
    }, TIMEOUT_MS);

    const startNative = () => {
      // Native HLS (iOS Safari, which has no MSE).
      video.addEventListener("loadedmetadata", ok);
      video.addEventListener("error", fail);
      video.src = a.url;
    };

    const startHls = (HlsCtor: typeof Hls) => {
      const hls = new HlsCtor({ enableWorker: true, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.on(HlsCtor.Events.MANIFEST_PARSED, ok);
      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (data.fatal) fail();
      });
      hls.loadSource(a.url);
      hls.attachMedia(video);
    };

    const canNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    if (hasMse()) {
      // hls.js is only fetched when the browser can use it, so iOS Safari never downloads it.
      import("hls.js")
        .then(({ default: HlsCtor }) => {
          if (dead) return;
          if (HlsCtor.isSupported()) startHls(HlsCtor);
          else if (canNative) startNative();
          else fail();
        })
        .catch(() => {
          if (!dead) fail();
        });
    } else if (canNative) {
      startNative();
    } else {
      fail();
    }

    return () => {
      dead = true;
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", ok);
      video.removeEventListener("error", fail);
      teardown();
    };
    // planKey captures plan contents; plan itself is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, attempt, run, autoplay]);

  // Fullscreen. Standard Fullscreen API on the container; iOS falls back to the native video player.
  const toggleFullscreen = async () => {
    const box = boxRef.current;
    const v = videoRef.current as IosVideo | null;
    if (!box || !v) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (box.requestFullscreen) {
      try {
        await box.requestFullscreen();
        void lockLandscape();
        return;
      } catch {
        /* not allowed here; try the iOS path */
      }
    }
    v.webkitEnterFullscreen?.();
  };

  // Track fullscreen state; release the orientation lock when leaving fullscreen.
  useEffect(() => {
    const onChange = () => {
      const inFs = document.fullscreenElement !== null;
      setFullscreen(inFs);
      if (!inFs) unlockOrientation();
    };
    const video = videoRef.current;
    const onIosEnd = () => unlockOrientation();
    document.addEventListener("fullscreenchange", onChange);
    video?.addEventListener("webkitendfullscreen", onIosEnd);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      video?.removeEventListener("webkitendfullscreen", onIosEnd);
    };
  }, []);

  // Picture-in-Picture state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const on = () => setPipActive(true);
    const off = () => setPipActive(false);
    video.addEventListener("enterpictureinpicture", on);
    video.addEventListener("leavepictureinpicture", off);
    return () => {
      video.removeEventListener("enterpictureinpicture", on);
      video.removeEventListener("leavepictureinpicture", off);
    };
  }, []);

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* not available for this stream */
    }
  };
  // The keyboard handler is registered once, so it reaches the latest togglePip through this ref.
  const pipRef = useRef<() => void>(() => undefined);
  pipRef.current = () => void togglePip();

  // Screen Wake Lock: keep the display on while playing. The browser drops the lock when the
  // page is hidden, so it is re-requested when the page becomes visible again.
  const acquireWake = async () => {
    if (!("wakeLock" in navigator) || wakeLockRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {
      /* denied or unsupported */
    }
  };
  const releaseWake = () => {
    const s = wakeLockRef.current;
    wakeLockRef.current = null;
    void s?.release().catch(() => undefined);
  };
  useEffect(() => {
    const onVisibility = () => {
      const v = videoRef.current;
      if (document.visibilityState === "visible" && v && !v.paused) void acquireWake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      releaseWake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OS media controls (lock screen, notification shade, headphone buttons).
  useEffect(() => {
    return setMediaSession(
      { title: title || "FreeTV", artist: subtitle ?? "", artwork: artwork ?? null },
      {
        play: () => void videoRef.current?.play().catch(() => undefined),
        pause: () => videoRef.current?.pause(),
        stop: () => videoRef.current?.pause(),
      },
    );
  }, [title, subtitle, artwork]);
  useEffect(() => setPlaybackState(playing ? "playing" : "paused"), [playing]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case " ":
          if (t && t.tagName === "BUTTON") return;
          e.preventDefault();
          if (v.paused) void v.play().catch(() => undefined);
          else v.pause();
          break;
        case "m":
          policyMutedRef.current = false;
          setPolicyMuted(false);
          v.muted = !v.muted;
          saveVolume(v.volume, v.muted);
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "p":
          if (canPip) {
            e.preventDefault();
            pipRef.current();
          }
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          const seek = v.seekable;
          if (seek.length === 0) return;
          e.preventDefault();
          const lo = seek.start(0);
          const hi = seek.end(seek.length - 1);
          const delta = e.key === "ArrowLeft" ? -SEEK_STEP : SEEK_STEP;
          v.currentTime = Math.min(hi, Math.max(lo, v.currentTime + delta));
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // toggleFullscreen only reads refs, so an empty dependency list is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Double-tap (or double-click) on the picture toggles fullscreen.
  const onVideoClick = (e: MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientY > rect.bottom - CONTROLS_ZONE_PX) return;
    const t = Date.now();
    const prev = lastTapRef.current;
    if (prev && t - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
      lastTapRef.current = null;
      void toggleFullscreen();
    } else {
      lastTapRef.current = { t, x: e.clientX, y: e.clientY };
    }
  };

  const unmute = () => {
    const v = videoRef.current;
    if (!v) return;
    policyMutedRef.current = false;
    setPolicyMuted(false);
    v.muted = false;
    if (v.volume === 0) v.volume = 1;
    saveVolume(v.volume, false);
    void v.play().catch(() => undefined);
  };

  const retry = () => {
    setAttempt(0);
    setRun((r) => r + 1);
  };

  const chooseSource = (value: string) => {
    setManual(value);
    setAttempt(0);
  };

  if (streams.length === 0) {
    return (
      <div className={`aspect-video w-full rounded-lg bg-zinc-900 text-zinc-300 flex items-center justify-center text-sm ${className}`}>
        This channel has no streams to play.
      </div>
    );
  }

  // Status: "Trying source N of M…" until a manifest loads, then the route and quality that won.
  let status = "";
  if (okAttempt) {
    const route = okAttempt.kind === "proxy" ? "relay" : "direct";
    const verb = playing ? "Playing" : "Ready";
    status = [`${verb} · ${route}`, okAttempt.quality].filter(Boolean).join(" · ");
  } else if (!exhausted && cur) {
    status = `Trying source ${attempt + 1} of ${plan.length}…`;
  }

  return (
    <div className={className}>
      <div ref={boxRef} className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full"
          controls
          playsInline
          webkit-playsinline="true"
          x-webkit-airplay="allow"
          onClick={onVideoClick}
          onPlay={() => {
            setPlaying(true);
            void acquireWake();
          }}
          onPause={() => {
            setPlaying(false);
            releaseWake();
          }}
          onEnded={() => {
            setPlaying(false);
            releaseWake();
          }}
          onVolumeChange={(e) => {
            if (!policyMutedRef.current) saveVolume(e.currentTarget.volume, e.currentTarget.muted);
          }}
        />

        {!exhausted && (
          <div className="absolute right-2 top-2 z-10 flex gap-2">
            {canPip && (
              <IconButton label={pipActive ? "Exit picture-in-picture" : "Picture-in-picture"} onClick={() => void togglePip()}>
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <rect x="12" y="11" width="6" height="5" rx="1" fill="currentColor" />
                </svg>
              </IconButton>
            )}
            <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => void toggleFullscreen()}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {fullscreen ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
              </svg>
            </IconButton>
          </div>
        )}

        {!exhausted && policyMuted && (
          <button
            type="button"
            onClick={unmute}
            className="absolute bottom-14 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-zinc-900 shadow hover:bg-white"
          >
            Unmute
          </button>
        )}

        {exhausted && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/95 p-6 text-center text-zinc-100">
            <p className="text-lg font-semibold">Couldn't play this channel</p>
            <p className="max-w-md text-sm text-zinc-400">
              The streams may be offline or blocked from this network. Try again, or pick a source below.
            </p>
            <button
              type="button"
              onClick={retry}
              className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Retry
            </button>
            {plan.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-auto text-left text-xs text-zinc-400">
                {plan.map((a) => (
                  <li key={a.key}>✕ {a.label}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="opacity-70">Source</span>
          <select
            value={manual}
            onChange={(e) => chooseSource(e.target.value)}
            className="min-h-11 pointer-fine:min-h-0 rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          >
            <option value="auto">Automatic</option>
            {every.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <ReducedDataToggle id="player-reduced-data" onChange={() => setAttempt(0)} />
        {saveData && (
          <span className="rounded border border-emerald-500/50 px-1.5 py-px text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Reduced data
          </span>
        )}
        <span role="status" aria-live="polite" className="opacity-70">{status}</span>
      </div>
    </div>
  );
}

export default Player;
