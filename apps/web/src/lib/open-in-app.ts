// "Open in app": hand a stream URL to a player app on the viewer's own device. Nothing here touches
// the stream; these are plain links and a file download. See docs/notes/hub-web-openinapp.md for the
// exact schemes and their caveats.
import { api, type StreamInfo } from "./api";

export type Platform = "ios" | "android" | "mac" | "windows" | "linux" | "tv" | "other";

export const VLC_PACKAGE = "org.videolan.vlc";
export const VLC_IOS_STORE = "https://apps.apple.com/app/vlc-mobile/id650377962";
export const VLC_ANDROID_STORE = `https://play.google.com/store/apps/details?id=${VLC_PACKAGE}`;

/** Platform from the user agent. TV checks come first because TV browsers also say "Linux" or "Android". */
export function detectPlatform(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
  touchPoints: number = typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0,
): Platform {
  if (/SMART-TV|SmartTV|Tizen|Web0S|webOS|CrKey|AFTS|BRAVIA|HbbTV|Roku|NetCast|Android TV|GoogleTV/i.test(ua)) return "tv";
  // iPadOS 13+ reports a Mac desktop UA, so a Mac with touch points is an iPad.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "other";
}

/** Absolute URL for a path the API returned relative to this origin (relay URLs are relative). */
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).href;
}

/**
 * The address a player app should open for one stream. Streams that need a User-Agent or Referer
 * (relayOnly) get the relay URL when there is one, because a player opened from a link cannot send
 * those headers. Everything else plays from its own URL, which needs no relay.
 */
export function appStreamUrl(s: Pick<StreamInfo, "url" | "proxyUrl" | "relayOnly">): string {
  if (s.relayOnly && s.proxyUrl) return absoluteUrl(s.proxyUrl);
  return s.url;
}

/** Absolute URL of the per-channel M3U (opens in VLC, IINA, MPV and most TV apps). */
export function channelPlaylistAbsoluteUrl(channelId: string): string {
  return absoluteUrl(api.channelPlaylistUrl(channelId));
}

// ---- link builders -------------------------------------------------------------------------------

/** VLC for iOS, x-callback form. Needs VLC 3 or later. Opens VLC only when it is installed. */
export function vlcIosCallbackLink(u: string): string {
  return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(u)}`;
}

/** VLC for iOS, plain scheme form. Older VLC builds accept it; the URL follows the scheme as is. */
export function vlcIosSchemeLink(u: string): string {
  return `vlc://${u}`;
}

/**
 * Android system chooser. Chrome on Android resolves intent: URLs with the whole stream URL after
 * the scheme. Fragments in the stream URL would be read as intent extras, so they are not supported.
 */
export function androidChooserLink(u: string): string {
  return `intent:${u}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
}

/** Android intent that names VLC directly. Uses the host/path form Chrome requires for an explicit scheme. */
export function androidVlcLink(u: string): string {
  const url = new URL(u);
  const scheme = url.protocol.replace(/:$/, "");
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=${VLC_PACKAGE};type=video/*;action=android.intent.action.VIEW;end`;
}

// ---- per-platform plan ---------------------------------------------------------------------------

export type OpenAction =
  | { id: string; label: string; kind: "link" | "download"; href: string; hint?: string }
  | { id: string; label: string; kind: "copy"; text: string; hint?: string };

export interface OpenPlan {
  platform: Platform;
  primary: OpenAction;
  secondary: OpenAction[];
}

/**
 * What to offer on this platform. The primary action is the one most likely to work on its own;
 * everything else is secondary. "Copy URL" is always available, so the stream can be pasted anywhere.
 */
export function openPlan(platform: Platform, streamUrl: string, playlistUrl: string): OpenPlan {
  const copy: OpenAction = { id: "copy", label: "Copy URL", kind: "copy", text: streamUrl, hint: "The stream address, for pasting into any player." };
  const playlist: OpenAction = {
    id: "playlist",
    label: "Download .m3u playlist",
    kind: "download",
    href: playlistUrl,
    hint: "Opens in VLC, IINA or MPV if one of them handles .m3u files.",
  };

  switch (platform) {
    case "ios": {
      const vlc: OpenAction = {
        id: "vlc",
        label: "Open in VLC",
        kind: "link",
        href: vlcIosCallbackLink(streamUrl),
        hint: "Needs VLC 3 or later. If VLC is not installed, nothing opens. Get it from the App Store.",
      };
      return {
        platform,
        primary: vlc,
        secondary: [
          { id: "vlc-scheme", label: "Open in VLC (alternate link)", kind: "link", href: vlcIosSchemeLink(streamUrl), hint: "Try this if the first link does nothing." },
          { id: "get-vlc", label: "Get VLC for iOS", kind: "link", href: VLC_IOS_STORE },
          playlist,
          copy,
        ],
      };
    }
    case "android": {
      const chooser: OpenAction = {
        id: "chooser",
        label: "Open in app",
        kind: "link",
        href: androidChooserLink(streamUrl),
        hint: "Shows the apps that can play video. Works in Chrome on Android.",
      };
      return {
        platform,
        primary: chooser,
        secondary: [
          { id: "vlc", label: "Open in VLC", kind: "link", href: androidVlcLink(streamUrl), hint: "Needs VLC for Android installed." },
          { id: "get-vlc", label: "Get VLC for Android", kind: "link", href: VLC_ANDROID_STORE },
          playlist,
          copy,
        ],
      };
    }
    case "mac":
    case "windows":
    case "linux":
      return { platform, primary: playlist, secondary: [copy] };
    case "tv":
      return {
        platform,
        primary: { ...copy, hint: "TVs cannot open this link. Add the channel in your TV app instead." },
        secondary: [playlist],
      };
    default:
      return { platform, primary: playlist, secondary: [copy] };
  }
}
