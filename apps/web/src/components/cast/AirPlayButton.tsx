import { useEffect, useState } from "react";
import { castSupported } from "@/lib/cast";
import { AirPlayIcon, CastIcon, actionClass } from "./parts";

/** Remote Playback API surface used here (Chrome Android). */
interface RemoteLike {
  prompt(): Promise<void>;
  watchAvailability(callback: (available: boolean) => void): Promise<void>;
  cancelWatchAvailability(): Promise<void>;
}

type Mode = "webkit" | "remote" | null;

/** The page's player <video>. The Player component exposes no ref, so the page is searched. */
function pageVideo(): unknown {
  return document.querySelector("video");
}

function detectMode(): Mode {
  if (typeof window === "undefined") return null;
  // Safari (macOS and iOS): WebKit AirPlay picker.
  if ("WebKitPlaybackTargetAvailabilityEvent" in window) return "webkit";
  // Other browsers with Remote Playback. Desktop Chrome gets the Cast button instead, so
  // this is limited to browsers where Cast is not offered (Android Chrome).
  if (typeof HTMLMediaElement !== "undefined" && "remote" in HTMLMediaElement.prototype && !castSupported()) return "remote";
  return null;
}

/**
 * AirPlay (Safari) or the Remote Playback prompt (Android Chrome). Renders nothing until the
 * browser reports that a target is available.
 */
export function AirPlayButton({ channelId }: { channelId: string }) {
  const [mode] = useState<Mode>(detectMode);
  const [webkitAvailable, setWebkitAvailable] = useState(false);
  const [remoteAvailable, setRemoteAvailable] = useState(false);

  // Safari reports availability on the <video> as an event. Listen in the capture phase on
  // document so the listener survives the Player remounting its <video> for a new channel.
  useEffect(() => {
    if (mode !== "webkit") return;
    setWebkitAvailable(false);
    const onChange = (e: Event) => {
      const availability = (e as Event & { availability?: string }).availability;
      setWebkitAvailable(availability === "available");
    };
    document.addEventListener("webkitplaybacktargetavailabilitychanged", onChange, true);
    return () => document.removeEventListener("webkitplaybacktargetavailabilitychanged", onChange, true);
  }, [mode, channelId]);

  // Remote Playback: re-watch whenever the page's <video> is replaced (channel change).
  useEffect(() => {
    if (mode !== "remote") return;
    const remote = (pageVideo() as { remote?: RemoteLike } | null)?.remote;
    if (!remote) return;
    let live = true;
    setRemoteAvailable(false);
    remote.watchAvailability((available) => {
      if (live) setRemoteAvailable(available);
    }).catch(() => undefined);
    return () => {
      live = false;
      remote.cancelWatchAvailability().catch(() => undefined);
    };
  }, [mode, channelId]);

  if (mode === "webkit" && webkitAvailable) {
    const onClick = () => {
      (pageVideo() as { webkitShowPlaybackTargetPicker?: () => void } | null)?.webkitShowPlaybackTargetPicker?.();
    };
    return (
      <button type="button" onClick={onClick} className={actionClass}>
        <AirPlayIcon /> AirPlay
      </button>
    );
  }

  if (mode === "remote" && remoteAvailable) {
    const onClick = () => {
      void (pageVideo() as { remote?: RemoteLike } | null)?.remote?.prompt().catch(() => undefined);
    };
    return (
      <button type="button" onClick={onClick} className={actionClass}>
        <CastIcon /> Cast
      </button>
    );
  }

  return null;
}
