/* Thin wrapper over the Media Session API (lock-screen / notification controls). Every call is
 * feature-detected and wrapped, because support for individual actions varies by browser. */

export interface MediaSessionMeta {
  title: string;
  artist?: string;
  artwork?: string | null;
}

export interface MediaSessionHandlers {
  play(): void;
  pause(): void;
  stop(): void;
}

/** Publishes metadata and play/pause/stop handlers. Returns a cleanup that clears them. */
export function setMediaSession(meta: MediaSessionMeta, handlers: MediaSessionHandlers): () => void {
  const session = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!session || typeof MediaMetadata === "undefined") return () => undefined;

  try {
    session.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist ?? "",
      album: "FreeTV",
      artwork: meta.artwork ? [{ src: meta.artwork, sizes: "512x512" }] : [],
    });
  } catch {
    /* ignore */
  }

  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", handlers.play],
    ["pause", handlers.pause],
    ["stop", handlers.stop],
  ];
  for (const [action, handler] of actions) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      /* action not supported by this browser */
    }
  }

  return () => {
    try {
      session.metadata = null;
    } catch {
      /* ignore */
    }
    for (const [action] of actions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
  };
}

export function setPlaybackState(state: "playing" | "paused"): void {
  try {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = state;
  } catch {
    /* ignore */
  }
}
