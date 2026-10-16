// Per-app setup steps for the connect page. Wording follows docs/TV.md section 6; keep the two in step.
// Menu names change between app versions. Where we are not sure of a label, the step says so.
import type { FeaturedApp } from "@/lib/api";

export const FEATURED_APP_LABELS: Record<FeaturedApp, string> = {
  tivimate: "TiviMate",
  vlc: "VLC",
  kodi: "Kodi",
  plex: "Plex Live TV",
  jellyfin: "Jellyfin",
  smarters: "IPTV Smarters",
  generic: "Any other app",
};

export const FEATURED_APP_ORDER: FeaturedApp[] = ["tivimate", "vlc", "kodi", "plex", "jellyfin", "smarters", "generic"];

export interface AppGuide {
  id: FeaturedApp;
  name: string;
  /** Where the app runs, shown next to the name. */
  platform: string;
  steps: string[];
}

export const APP_GUIDES: Record<FeaturedApp, AppGuide> = {
  tivimate: {
    id: "tivimate",
    name: "TiviMate",
    platform: "Android TV, Google TV, Fire TV",
    steps: [
      "Open Settings (the gear icon), then Playlists, then Add playlist.",
      "Choose the option for a playlist by URL and paste the Playlist URL above. Give it a name and save.",
      "Wait for the channels to load, then go back to Settings and open the EPG sources.",
      "Add an EPG source by URL and paste the Guide URL above. Save and let it download.",
      "If some channels show no programmes, run the EPG mapping for the playlist. TiviMate matches channels by their tvg-id.",
    ],
  },
  vlc: {
    id: "vlc",
    name: "VLC",
    platform: "Desktop: Windows, macOS, Linux",
    steps: [
      "Open VLC and choose Media, then Open Network Stream (Ctrl+N, or Cmd+N on macOS).",
      "Paste the Playlist URL above into the network address box and press Play.",
      "Open the playlist view (Ctrl+L, or Cmd+Option+P on macOS) to browse channels, then double-click one.",
      "VLC has no guide support, so channels play without programme listings. Use TiviMate, Kodi or Jellyfin for the guide.",
    ],
  },
  kodi: {
    id: "kodi",
    name: "Kodi",
    platform: "Kodi 21 or later, with PVR IPTV Simple Client",
    steps: [
      "Install PVR IPTV Simple Client: Settings, Add-ons, Install from repository, PVR clients, PVR IPTV Simple Client, Install.",
      "Open its configuration: Settings, Add-ons, My add-ons, PVR clients, PVR IPTV Simple Client, Configure.",
      "On the General tab, set the M3U play list URL to the Playlist URL above.",
      "On the EPG tab, set the XMLTV URL to the Guide URL above.",
      "Click OK, then restart Kodi so the PVR client loads both sources. Open TV to see the channels.",
    ],
  },
  plex: {
    id: "plex",
    name: "Plex Live TV",
    platform: "Plex Server with Plex Pass; availability depends on region",
    steps: [
      "Live TV needs Plex Pass. Custom M3U and XMLTV sources are not offered everywhere, so check Plex's Live TV help first.",
      "In Plex Web, open Settings, then Live TV and DVR. Where Plex offers a custom M3U source, add one and paste the Playlist URL above.",
      "Add the Guide URL above as the XML guide source when Plex asks for one.",
      "Let Plex refresh the guide, then map channels if it asks you to.",
      "If Plex only offers its own lineup where you live, use Jellyfin or Kodi instead.",
    ],
  },
  jellyfin: {
    id: "jellyfin",
    name: "Jellyfin",
    platform: "Jellyfin server, any client",
    steps: [
      "Open the Dashboard, then Live TV. Add a tuner device of type M3U and paste the Playlist URL above. Save.",
      "On the same page, under TV guide data providers, add an XMLTV provider and paste the Guide URL above. Save.",
      "Choose the channels you want to show, then run the guide refresh once from Scheduled Tasks.",
      "Labels vary a little between Jellyfin versions. If one is not where this says, look for the M3U or XMLTV option.",
    ],
  },
  smarters: {
    id: "smarters",
    name: "IPTV Smarters",
    platform: "Smarters Pro and Smarters Player apps",
    steps: [
      "On the first screen, choose to load a playlist by URL, sometimes labelled Load Your Playlist or File/URL.",
      "Choose the M3U URL option, paste the Playlist URL above, give it a name and save.",
      "Open the playlist's settings and set the EPG URL to the Guide URL above (verify the field name in your version).",
    ],
  },
  generic: {
    id: "generic",
    name: "Any other app",
    platform: "Any app that reads M3U playlists",
    steps: [
      "Look for M3U, Playlist URL, Add playlist by URL or Network playlist. Paste the Playlist URL above.",
      "For the guide, look for EPG, XMLTV or TV guide URL. Paste the Guide URL above.",
      "The playlist header already names the guide, so some apps fill that field in for you.",
      "If the app cannot find the M3U field, check its help for playlist or channel-list sources.",
    ],
  },
};

export const REFRESH_NOTE = "Refresh interval: 12 h for the guide, daily for the playlist.";
