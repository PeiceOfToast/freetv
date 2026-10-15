import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { StreamInfo } from "@/lib/api";

export interface PlayerProps {
  streams: StreamInfo[];
  autoplay?: boolean;
  className?: string;
}

interface Attempt {
  key: string; // `${streamPosition}:${kind}`
  kind: "direct" | "proxy";
  label: string;
  url: string;
}

const TIMEOUT_MS = 8000;
const VOL_KEY = "freetv:volume";
const SEEK_STEP = 10;

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

function streamLabel(s: StreamInfo, pos: number): string {
  const parts = [s.quality, s.feed].filter(Boolean);
  return parts.length ? parts.join(" · ") : s.title || `Stream ${pos + 1}`;
}

/** Every candidate in playback order: all direct URLs first, then all relay URLs. */
function allAttempts(streams: StreamInfo[]): Attempt[] {
  const out: Attempt[] = [];
  streams.forEach((s, pos) => {
    if (s.url) out.push({ key: `${pos}:direct`, kind: "direct", label: `Direct · ${streamLabel(s, pos)}`, url: s.url });
  });
  streams.forEach((s, pos) => {
    if (s.proxyUrl) out.push({ key: `${pos}:proxy`, kind: "proxy", label: `Relay · ${streamLabel(s, pos)}`, url: s.proxyUrl });
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

export function Player({ streams, autoplay = true, className = "" }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const policyMutedRef = useRef(false);

  const [manual, setManual] = useState<string>("auto");
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [policyMuted, setPolicyMuted] = useState(false);
  const [via, setVia] = useState<"direct" | "proxy" | null>(null);

  const every = useMemo(() => allAttempts(streams), [streams]);
  const plan = useMemo(
    () => (manual === "auto" ? every : every.filter((a) => a.key === manual)),
    [every, manual],
  );
  const planKey = plan.map((a) => a.key).join("|");
  const cur = plan[attempt];
  const exhausted = plan.length === 0 || attempt >= plan.length;

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
      setVia(a.kind);
      if (autoplay) tryPlay(video, () => { policyMutedRef.current = true; setPolicyMuted(true); });
    };

    timer = window.setTimeout(() => {
      if (!parsed) fail();
    }, TIMEOUT_MS);

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, ok);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) fail();
      });
      hls.loadSource(a.url);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari / iOS).
      video.addEventListener("loadedmetadata", ok);
      video.addEventListener("error", fail);
      video.src = a.url;
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
          if (document.fullscreenElement) void document.exitFullscreen();
          else void boxRef.current?.requestFullscreen?.().catch(() => undefined);
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
  }, []);

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

  let status = "";
  if (!exhausted && cur) {
    status = `Trying source ${attempt + 1} of ${plan.length}…`;
  } else if (playing && via === "proxy") {
    status = "Playing via relay";
  }

  return (
    <div className={className}>
      <div ref={boxRef} className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full"
          controls
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onVolumeChange={(e) => {
            if (!policyMutedRef.current) saveVolume(e.currentTarget.volume, e.currentTarget.muted);
          }}
        />

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
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          >
            <option value="auto">Automatic</option>
            {every.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {status && <span className="opacity-70">{status}</span>}
      </div>
    </div>
  );
}

export default Player;
