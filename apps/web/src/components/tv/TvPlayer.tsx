// Chrome-less HLS player for the 10-foot UI. Uses hls.js directly (no controls, no hover UI).
// Tries direct URLs, then relay URLs (or the reverse when preferRelay), advancing on fatal
// error or a timeout (5 s for direct, 8 s for relay). Calls onState so the watch overlay can show what is happening.
import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { StreamInfo } from "@/lib/api";
import { tvSettings } from "./tvSettings";
import { DIRECT_TIMEOUT_MS, MAX_ATTEMPTS, RELAY_TIMEOUT_MS, isMixedContent } from "@/components/player/plan";

export interface TvPlayerState {
  playing: boolean;
  via: "direct" | "relay" | null;
  attempt: number;
  of: number;
  failed: boolean;
}

interface Attempt { kind: "direct" | "relay"; url: string }

// The API orders streams for playback: known-online, never-probed, known-offline; https before http;
// then quality. We keep that order. The preferred quality only moves matching streams to the front
// inside each health group, so an online SD stream still comes before an offline 4K one.
function preferQuality(streams: StreamInfo[], quality: string): StreamInfo[] {
  if (quality === "any") return streams;
  const out: StreamInfo[] = [];
  for (const rank of [0, 1, 2]) {
    const group = streams.filter((s) => (s.online === true ? 0 : s.online === null ? 1 : 2) === rank);
    out.push(...group.filter((s) => s.quality === quality), ...group.filter((s) => s.quality !== quality));
  }
  return out;
}

function planFor(streams: StreamInfo[], preferRelay: boolean, quality: string): Attempt[] {
  const ordered = preferQuality(streams, quality);
  // relayOnly streams need a User-Agent/Referer the browser cannot send, and plain-http URLs are
  // blocked as mixed content on an https page, so neither gets a direct attempt.
  const direct: Attempt[] = ordered
    .filter((s) => s.url && !s.relayOnly && !isMixedContent(s.url))
    .map((s) => ({ kind: "direct" as const, url: s.url }));
  const relay: Attempt[] = ordered.filter((s) => s.proxyUrl).map((s) => ({ kind: "relay" as const, url: s.proxyUrl as string }));
  return (preferRelay ? [...relay, ...direct] : [...direct, ...relay]).slice(0, MAX_ATTEMPTS);
}

export function TvPlayer({
  streams,
  onState,
  retryKey = 0,
}: {
  streams: StreamInfo[];
  onState?: (s: TvPlayerState) => void;
  retryKey?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [via, setVia] = useState<"direct" | "relay" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const { preferRelay, preferredQuality } = tvSettings.get();
  const plan = useMemo(() => planFor(streams, preferRelay, preferredQuality), [streams, preferRelay, preferredQuality]);
  const planKey = plan.map((p) => p.url).join("|");

  // Reset the attempt counter whenever the channel or retry request changes.
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setVia(null);
  }, [planKey, retryKey]);

  useEffect(() => {
    const video = videoRef.current;
    const a = plan[attempt];
    if (!video) return;
    if (!a) {
      setFailed(true);
      return;
    }
    let dead = false;
    let parsed = false;
    let timer: number | undefined;
    setVia(null); // this attempt has not connected yet

    const teardown = () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (video.getAttribute("src")) { video.removeAttribute("src"); video.load(); }
    };
    const fail = () => {
      if (dead) return;
      dead = true;
      if (timer !== undefined) window.clearTimeout(timer);
      teardown();
      setAttempt((n) => n + 1);
    };
    const ok = () => {
      if (dead || parsed) return;
      parsed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      setVia(a.kind);
      const p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // Autoplay blocked: mute and retry (TV browsers usually allow muted playback).
          video.muted = true;
          video.play().catch(() => undefined);
        });
      }
    };

    timer = window.setTimeout(() => { if (!parsed) fail(); }, a.kind === "direct" ? DIRECT_TIMEOUT_MS : RELAY_TIMEOUT_MS);

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, maxBufferLength: 20, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, ok);
      hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) fail(); });
      hls.loadSource(a.url);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.addEventListener("loadedmetadata", ok);
      video.addEventListener("error", fail);
      video.src = a.url;
    } else {
      fail();
    }

    return () => {
      dead = true;
      if (timer !== undefined) window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", ok);
      video.removeEventListener("error", fail);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, attempt, retryKey]);

  useEffect(() => {
    onState?.({ playing, via, attempt, of: plan.length, failed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, via, attempt, plan.length, failed]);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 h-full w-full bg-black object-contain"
      playsInline
      autoPlay
      muted={false}
      onPlay={() => setPlaying(true)}
      onPlaying={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onWaiting={() => setPlaying(false)}
    />
  );
}

export default TvPlayer;
