// Narrow ambient typings for the parts of the Google Cast Web Sender SDK that FreeTV uses.
// Runtime objects come from https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1
// and exist only after that script has loaded. Always guard access with a runtime check.
// This file must stay a global script (no imports or exports).

interface Window {
  __onGCastApiAvailable?: (isAvailable: boolean, errorInfo?: unknown) => void;
}

declare namespace chrome.cast {
  const AutoJoinPolicy: { readonly ORIGIN_SCOPED: string; readonly PAGE_SCOPED: string; readonly TAB_AND_ORIGIN_SCOPED: string };

  class Image {
    constructor(url: string);
    url: string;
  }

  interface Device {
    friendlyName: string;
  }

  interface Session {
    addMediaListener(listener: (media: media.Media) => void): void;
  }

  namespace media {
    const DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    const StreamType: { readonly LIVE: string; readonly BUFFERED: string; readonly NONE: string };
    const MetadataType: { readonly GENERIC: number };

    interface Media {
      /** "IDLE" | "PLAYING" | "PAUSED" | "BUFFERING" */
      playerState: string | null;
      /** Set when playerState is IDLE: "ERROR" | "FINISHED" | "CANCELLED" | "INTERRUPTED" */
      idleReason?: string | null;
      addUpdateListener(listener: (isAlive: boolean) => void): void;
    }

    class GenericMediaMetadata {
      metadataType: number;
      title?: string;
      images: Image[];
    }

    class MediaInfo {
      constructor(contentId: string, contentType: string);
      streamType: string;
      metadata: GenericMediaMetadata | null;
    }

    class LoadRequest {
      constructor(media: MediaInfo);
      autoplay: boolean;
    }
  }
}

declare namespace cast.framework {
  type CastStateName = "NO_DEVICES_AVAILABLE" | "NOT_CONNECTED" | "CONNECTING" | "CONNECTED";

  const CastContextEventType: { readonly CAST_STATE_CHANGED: string };
  const RemotePlayerEventType: { readonly IS_PAUSED_CHANGED: string };

  interface CastSession {
    getCastDevice(): chrome.cast.Device;
    getSessionObj(): chrome.cast.Session;
    loadMedia(request: chrome.cast.media.LoadRequest): Promise<unknown>;
  }

  class CastContext {
    static getInstance(): CastContext;
    setOptions(options: { receiverApplicationId: string; autoJoinPolicy: string }): void;
    getCastState(): CastStateName;
    getCurrentSession(): CastSession | null;
    /** Opens the device picker. Rejects if the user dismisses it. */
    requestSession(): Promise<unknown>;
    endCurrentSession(stopCasting: boolean): void;
    addEventListener(type: string, listener: (event: { castState: CastStateName }) => void): void;
  }

  class RemotePlayer {
    isPaused: boolean;
    isConnected: boolean;
  }

  class RemotePlayerController {
    constructor(player: RemotePlayer);
    playOrPause(): void;
    addEventListener(type: string, listener: () => void): void;
  }
}
