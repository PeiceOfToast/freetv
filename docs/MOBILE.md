# FreeTV on your phone

FreeTV is a web app, and it can be installed to your home screen. Installed, it opens full-screen without
browser bars and browses like an app. Nothing to download from an app store.

## Install

**iPhone and iPad (Safari only).** Other iOS browsers cannot install web apps.

1. Open the site in Safari.
2. Tap Share, then Add to Home Screen.
3. Check the name and tap Add. Open FreeTV from its icon.

**Android (Chrome, Edge or Samsung Internet).**

1. Open the site. Chrome usually offers an Install prompt. If it does not, open the three-dot menu and
   choose Install app or Add to Home screen.
2. Confirm. FreeTV opens in its own window and appears in your app drawer.

## Watching: in the browser or in an app

Most channels play on the site, in the browser. When a stream cannot play in a browser, the watch page shows
**Open in app** instead.

- **Open in app** hands the stream to a player app on your phone, such as VLC. The app fetches the stream itself.
  - On Android, the link opens your player. It works reliably in Chrome; see [TROUBLESHOOTING](TROUBLESHOOTING.md) if nothing happens.
  - On iPhone, Safari hands the link only to a player app that is installed and registers with iOS. FreeTV installs no
    player, so install one first (for example VLC).
- **Lists for your apps.** `/connect` on your site gives the playlist and guide URLs for TV and phone apps, with steps
  for each.

## What works offline

The app itself and the channel lists and guide data you have already loaded can be browsed without a
connection. Video does not work offline. Live streams need the network, so opening a channel with no
connection shows an error. Verify the exact cache coverage on the build you are using.

## Playback on the phone

- **Lock screen and Control Centre.** Play and pause from the lock screen work when the player reports
  its media state to the system. Verify on your device.
- **Picture-in-picture.** On Android, use the picture-in-picture control in the player (verify whether it
  also triggers when you leave the app). On iPhone, Safari supports picture-in-picture for video played
  in the page, if the player exposes the control.
- **Fullscreen and landscape.** Tap the fullscreen control in the player. On Android, an installed app
  honours the landscape orientation for fullscreen video. On iPhone, fullscreen plays in Apple's own
  player, and turning the phone sideways switches to landscape. Verify both on your models.

## Data use

Live TV streams continuously and uses data the whole time. Typical bitrates:

- **720p:** around 2 Mbps, about 0.9 GB an hour.
- **1080p:** around 4 to 5 Mbps, roughly 2 GB an hour.

Individual streams vary. On a metered connection, use Wi-Fi for long viewing, or pick a lower quality in
the player if it offers one.

In an app the bitrates are the same, but the app fetches the stream itself, so the server's bandwidth is not used.

## Casting

Chrome on Android shows a Cast button on the watch page. Safari on iPhone and Mac offers AirPlay from the
video controls. Both need the site served over HTTPS, and the stream is played by the TV rather than your
phone. With the relay off (the default), only streams the TV can fetch directly can be cast. Requirements and limits
are in [TV.md](TV.md).
