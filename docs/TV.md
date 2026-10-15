# FreeTV on a TV

FreeTV is a web app, so any TV that can open a web page can show it. There are four ways in, from
least setup to most:

1. **Cast or AirPlay from your phone.** Nothing installed on the TV.
2. **The TV's own browser**, at `/tv`, the 10-foot interface.
3. **A packaged app**: an Android TV / Google TV / Fire TV APK, a Samsung Tizen app, or an LG webOS app.
4. **A playlist source for a TV app you already use.** TiviMate, Kodi, Jellyfin and others read
   FreeTV's M3U playlist and XMLTV guide. This is the most reliable route on most TVs today.

The examples use `https://tv.example.com`. Replace it with your `DOMAIN`.

## 1. Casting from a phone

**Chromecast and Google TV (Android, Chrome).** Open a channel's watch page in Chrome, tap Cast and
choose the TV. The stream is handed to the TV, which fetches it directly. Your phone only controls
playback, so you can put it down or use it for something else.

**AirPlay (iPhone, iPad, Mac).** Use Safari, not Chrome. Tap the AirPlay control in the player and
choose an Apple TV or AirPlay-capable TV. As with Cast, the TV fetches the stream itself.

Requirements, for both:

- **HTTPS.** Browsers only expose Cast and AirPlay on secure pages. Set `DOMAIN` so Caddy issues a
  certificate. A plain-HTTP install on a LAN address will not show the buttons. (Verify on your
  browser version.)
- **The relay is on.** Keep the `proxy` profile enabled and `PROXY_ENABLED=true`. The relay matters for
  casting because the TV cannot use the browser's workarounds: when a stream needs a specific
  User-Agent or Referer, the relayed URL carries those headers for it. Verify this on your streams.
- **`PUBLIC_URL` is set** to your public address, for example `PUBLIC_URL=https://tv.example.com`.
  Absolute stream and playlist URLs are built from it, and the TV must be able to reach them.
- **The TV has internet access.** It does not need to be on the same network as the server.

What will not cast, or will not play once cast:

- **DRM-protected streams.** iptv-org's public list does not include DRM, so you should not see any.
- **Streams that need headers the receiver cannot send**, when the relay is off or the stream is not
  relayed.
- **Geo-restricted channels.** The stream is fetched from the TV's network, so the TV's location counts,
  not yours.
- **Dead streams.** Stream URLs rot. FreeTV falls through to the next stream for a channel in the
  browser, but a cast session uses the one it was given.

## 2. The TV's own browser

Open `https://tv.example.com/tv` in the TV's browser and bookmark it or pin it to the home screen if the
TV allows it. `/tv` is built for a remote: arrow keys move focus, Enter selects, and the browser's Back
key leaves the site.

| Platform | Browser | Notes |
|----------|---------|-------|
| Samsung Tizen (recent models) | Internet app | Built on Chromium. Use the D-pad. Verify minimum model year. |
| LG webOS (recent models) | Web Browser app | The pointer works, but the D-pad is more predictable on `/tv`. |
| Amazon Fire TV | Silk Browser | No install needed. Fullscreen behaviour varies, so verify. |
| Android TV / Google TV | Chrome | Full feature set. |

Known limits:

- **Older sets** ship browsers too old for hls.js and modern JavaScript. If `/tv` loads but nothing plays,
  try the other routes in this guide.
- **Autoplay with sound** may be blocked until you press a key. Press OK on a channel to start it.
- **Screen savers and sleep timers** can stop playback. Disable them while watching.
- **No Cast or AirPlay button** on the TV itself. You are already on the screen.

## 3. Android TV, Google TV and Fire TV: a packaged app

A Trusted Web Activity (TWA) wraps your site in a fullscreen app. The site stays the source of truth, so
web updates reach the TV without a new APK. You rebuild the APK only when the manifest, icons or package
identity change.

You need the web app's manifest at `/manifest.webmanifest` and a 512 px icon under `/icons/`. You also
need Node.js, a JDK and the Android SDK. `bubblewrap doctor` checks for them and offers to install what
is missing.

**Step 1. Install Bubblewrap.**

```sh
npm i -g @bubblewrap/cli
```

**Step 2. Create a project from the manifest.**

```sh
mkdir freetv-tv && cd freetv-tv
bubblewrap init --manifest https://tv.example.com/manifest.webmanifest
```

Answer the prompts. Use your own package id; `app.freetv.tv` in this repo is a placeholder. Set the start
URL to `/tv`. Then compare the generated `twa-manifest.json` with the reference copy at
`apps/tv/android-tv/twa-manifest.json`. The values that matter are `startUrl: "/tv"`,
`display: "fullscreen"`, `orientation: "landscape"`, `themeColor: "#09090b"`, `isChromeOSOnly: false` and
`enableNotifications: false`. Enable the leanback feature in the manifest's `features` block. (Verify the
field name against your Bubblewrap version.)

**Step 3. Make it a TV app.** Bubblewrap does not always add everything Android TV needs. Check the
generated `AndroidManifest.xml`:

- `<uses-feature android:name="android.software.leanback" android:required="true"/>`, and
  `<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>`.
- On the launcher activity, an intent filter with category `android.intent.category.LEANBACK_LAUNCHER`
  as well as `LAUNCHER`, so the app appears on the TV home row.
- A 320 × 180 banner drawn as `android:banner="@drawable/banner"` on the `<application>` element.

**Step 4. Build, then prove site ownership.** The first build creates `android.keystore` and asks for
passwords. Keep that file safe: losing it means you cannot update the same package.

```sh
bubblewrap build
keytool -list -v -keystore android.keystore -alias android
```

Copy the `SHA256:` fingerprint from the `keytool` output into the assetlinks file. Use the reference
`apps/tv/android-tv/assetlinks.example.json` as a template. If you publish through Google Play with Play
App Signing, also add the app signing certificate's SHA-256 from Play Console (App integrity). The
`sha256_cert_fingerprints` array can hold both. Without a valid file, the app shows the browser address
bar.

**Step 5. Serve `assetlinks.json` from Caddy.** The file must be at
`https://tv.example.com/.well-known/assetlinks.json` with `Content-Type: application/json`, and without
redirects. The Caddyfile already serves that path from `/etc/caddy/assetlinks.json`, and `infra/caddy/`
is bind-mounted there, so no Caddyfile edit is needed:

```sh
cp apps/tv/android-tv/assetlinks.example.json infra/caddy/assetlinks.json   # edit package id + fingerprint
docker compose exec web caddy reload --config /etc/caddy/Caddyfile
curl -sS https://tv.example.com/.well-known/assetlinks.json
```

The last command must print the JSON, not the web app's `index.html`.

**Step 6. Sideload with adb.** On Android TV or Google TV, enable developer options: Settings → Device
Preferences → About → tap the build number seven times, then turn on network debugging under Developer
options. On Fire TV, go to Settings → My Fire TV → About, tap the device name seven times, then turn on
ADB debugging under Developer options. Allow installs from unknown sources for the app you install from.
Find the TV's IP address, then:

```sh
adb connect 192.168.1.50:5555
adb install -r app-release-signed.apk      # file name may differ; check the build output
adb shell monkey -p app.freetv.tv -c android.intent.category.LAUNCHER 1
```

Fire TV caveat: a TWA needs a Chromium-based browser on the device that supports Trusted Web Activities.
Fire TV does not ship Chrome, so the app may fall back to a plain browser view, or fail to open. Test on
your own device before you rely on it.

**Store notes.** Google Play for Android TV requires the leanback feature, the TV banner and a TV listing,
and it reviews TWA apps like any other. Amazon's Appstore takes Fire TV submissions through the Amazon
developer console. Check both stores' current requirements; they change. Both ask for a privacy policy
URL. FreeTV keeps favorites in the browser's local storage. If you add analytics, say so in the policy.

## 4. Samsung Tizen (Smart TV)

The reference package is `apps/tv/tizen/config.xml`. It is a hosted web app: the package holds a manifest
that points at `https://tv.example.com/tv`, so the TV always runs the live site. Edit `DOMAIN`, then copy
`config.xml` and an icon into a folder.

**Step 1. Set up Tizen Studio.** Install Tizen Studio and the TV extensions from its package manager.

**Step 2. Turn on Developer mode on the TV.** Open the Apps panel on the TV and turn on Developer mode,
then enter your computer's IP address. The exact menu has changed between model years, so verify it on
your set.

**Step 3. Create a certificate profile.** Use Certificate Manager in Tizen Studio. Installing on your own
TV needs a profile. Publishing through Samsung's store needs a Samsung account and distributor
certificate. Check Samsung's current developer documentation for the store route.

**Step 4. Package and install.** Connect to the TV, package, then install:

```sh
sdb connect 192.168.1.60
sdb devices
tizen package -t wgt -s <your-profile> -- /path/to/tizen-folder
tizen install -n FreeTV.wgt -t <tv-name-from-device-manager>
```

Verify the exact CLI syntax for your Tizen Studio version. The `tizen:application id` and `package`
must be generated for your account; the placeholder in `config.xml` will not install.

**Step 5. Register the remote keys.** Channel and media keys only reach the page after the app registers
them. The `config.xml` already requests `http://tizen.org/privilege/tv.inputdevice`. In the `/tv` page,
guarded so that it does nothing on other platforms:

```js
if (window.tizen && tizen.tvinputdevice) {
  ["ChannelUp", "ChannelDown", "MediaPlayPause", "MediaStop", "MediaRewind", "MediaFastForward"]
    .forEach((key) => { try { tizen.tvinputdevice.registerKey(key); } catch (e) {} });
}
```

The web app must handle these key events itself. Check `tizen.tvinputdevice.getSupportedKeys()` for the
exact key names on your model. Verify before relying on them.

## 5. LG webOS

The reference files are `apps/tv/webos/appinfo.json` and `apps/tv/webos/index.html`. The package is a
tiny redirect to the hosted `/tv` page. Add two icons next to `appinfo.json` before packaging, named as in
`appinfo.json`: an 80 × 80 `icon.png` and a 130 × 130 `icon-large.png`.

**Step 1. Install the webOS TV CLI.** The tool is `ares-cli`, distributed through npm (verify the current
package name in the webOS TV developer docs).

**Step 2. Turn on Developer Mode on the TV.** Install the Developer Mode app from the LG Content Store,
sign in on the LG developer site, turn on developer mode and the key server, and note the TV's IP. The
app's expiry means you must renew it periodically (verify).

**Step 3. Register the TV.**

```sh
ares-setup-device                         # add a device: name, IP, port, login
ares-novacom --device tv --getkey         # generate the device key (verify flags)
```

**Step 4. Package, install, launch.**

```sh
ares-package apps/tv/webos -o dist/webos
ares-install --device tv dist/webos/app.freetv.tv_1.0.0_all.ipk
ares-launch --device tv app.freetv.tv
```

The package file name follows the app id and version. Check the output of `ares-package`.

Notes: `appinfo.json` must use an id you control in reverse-domain form. Avoid reserved prefixes such as
`com.webos` and `com.lge` (verify). Store submission goes through the LG developer portal; check its
current requirements.

## 6. Using FreeTV as a source for a TV app

This route works on most TVs, gives you a proper remote UI, EPG grids and recording where the app
supports it, and needs no packaging. FreeTV exports two URLs:

| What | URL |
|------|-----|
| Playlist (M3U) | `https://tv.example.com/api/playlist.m3u` |
| Guide (XMLTV) | `https://tv.example.com/api/guide.xml` |

The playlist header carries `x-tvg-url`, pointing at the guide, so apps that read it pick up the guide
automatically. You can still paste the guide URL separately.

**Filters.** Add any of these to the playlist URL. They combine with `&`:

| Want | Example |
|------|---------|
| One country and category | `…/api/playlist.m3u?country=US&category=news` |
| A language | `…/api/playlist.m3u?language=eng` |
| A search | `…/api/playlist.m3u?q=sport` |
| Only favorites | `…/api/playlist.m3u?favorites=BBCNews.uk,CNN.us` |
| Minimum quality | `…/api/playlist.m3u?quality=720p` |
| Every stream per channel | `…/api/playlist.m3u?streams=all` (default is `streams=best`) |
| Relayed URLs | `…/api/playlist.m3u?proxy=true` |

Country codes are ISO 3166 alpha-2 (`US`, `GB`). Channel ids look like `BBCNews.uk`. Comma lists are OR.
The playlist returns every match, up to 20,000 channels, and only channels with at least one stream.
Adult channels stay hidden unless the request includes `nsfw=true`, following the operator's
`HIDE_NSFW_DEFAULT` setting.

**When to use `proxy=true`.** Leave it off first. The TV app fetches streams itself, so the browser's CORS
rules do not apply. Turn relayed URLs on when a stream needs a User-Agent or Referer that your app cannot
send. The relay adds them. Every relayed byte also crosses your server, so mind the bandwidth and the
`PROXY_MAX_CONCURRENT` cap. It needs `PROXY_ENABLED=true` and the `proxy` profile running.

**Refresh intervals.**

- **Playlist:** the catalog is rebuilt every `INGEST_INTERVAL_HOURS` (default 6). Refreshing once a day
  is enough; refreshing more often adds nothing.
- **Guide:** the grabber runs every `EPG_INTERVAL_HOURS` (default 12), and the API picks up a new file
  within about a minute. Refresh the guide every 6 to 12 hours. Until the first grab finishes,
  `guide.xml` returns 404.

**Caveats.**

- **Favorites live in the browser.** The server cannot see them, so pass them explicitly with
  `favorites=`. Changing the list changes the URL, so update the playlist address in your TV app.
- **`online=true` only filters when health data exists.** The stream health prober is not part of v1, so
  do not rely on it yet.
- **Not every channel has a guide.** Channels without guide data show empty schedules.
- **Geography.** Geo-restricted streams are fetched from the TV's network.

**Setting it up in common apps.** Menu names change between app versions, so check the app's own help if
a label differs.

- **TiviMate (Android TV, Fire TV):** Settings → Playlists → add a playlist by URL and paste the M3U
  address. Then add the guide under the EPG settings with the XMLTV address.
- **Kodi (PVR IPTV Simple Client):** install the PVR IPTV Simple Client add-on. In its configuration, set
  the M3U playlist URL on the General tab and the XMLTV URL on the EPG tab, then restart the PVR client.
  Kodi should honour the `#EXTVLCOPT` header lines (verify).
- **Jellyfin:** Dashboard → Live TV. Add a tuner device of type M3U with the playlist URL, then add a TV
  guide data provider of type XMLTV with the guide URL. Refresh the guide once after adding it (verify
  labels).
- **Plex:** Live TV and DVR needs Plex Pass, and custom M3U and XMLTV sources depend on your region and
  Plex's current feature set. Check Plex's Live TV help before you start. If it does not offer custom
  sources where you live, use Jellyfin.
- **VLC:** Media → Open Network Stream, then paste the M3U address to load the playlist. VLC honours the
  `#EXTVLCOPT` header lines, but it has no guide support. Use it for playlists, not for an EPG.
- **IPTV Smarters:** add a playlist by URL with the M3U address, and set the EPG URL in the playlist
  settings to the XMLTV address (verify the field).

**If it does not work.** If the playlist loads but channels do not play, open one channel's stream in a
browser first, then try `proxy=true`. If the guide is empty, check `lastEpgImport` in
`https://tv.example.com/api/meta` and the `epg` container's logs.
