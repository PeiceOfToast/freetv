# TV packaging

Reference files for putting FreeTV on TVs. The operator guide is [docs/TV.md](../../docs/TV.md). Nothing
here is built by Docker Compose; these are templates for the tools each platform uses.

| Path | Platform | Used by |
|------|----------|---------|
| `android-tv/twa-manifest.json` | Android TV, Google TV, Fire TV (Trusted Web Activity) | `bubblewrap init` / `bubblewrap build` |
| `android-tv/assetlinks.example.json` | Same | Served at `/.well-known/assetlinks.json` |
| `caddy-assetlinks.snippet` | Caddy | Explains how the file is served (no Caddyfile edit needed) |
| `tizen/config.xml` | Samsung Tizen (hosted web app) | Tizen Studio `tizen package` |
| `webos/appinfo.json`, `webos/index.html` | LG webOS (redirect to hosted app) | `ares-package` |

## Placeholders to replace

- `tv.example.com`: your `DOMAIN`, in every file.
- `app.freetv.tv`: your package id (Android, webOS). Tizen generates its own id; see docs/TV.md.
- `REPLACE:WITH:YOUR:UPLOAD:KEY:SHA256:FINGERPRINT`: the certificate fingerprint (below).
- Icons: `webos/icon.png` (80 × 80) and `webos/icon-large.png` (130 × 130) are not committed. Create them
  from the web app's icons before packaging.

## The SHA-256 fingerprint

Android verifies that the site trusts the app through `assetlinks.json`. The fingerprint must match the
certificate that signs the APK:

- Bubblewrap creates `android.keystore` on the first build. Print its fingerprint with
  `keytool -list -v -keystore android.keystore -alias android` and copy the `SHA256:` line.
- Fingerprints are 32 colon-separated uppercase hex pairs.
- If the app is distributed through Google Play with Play App Signing, add the app signing certificate
  fingerprint from Play Console as well. The array can hold more than one.
- Keep `android.keystore` and its passwords out of git.

## Serving it

The Caddyfile serves `/.well-known/assetlinks.json` from `/etc/caddy/assetlinks.json`; `infra/caddy/` is
bind-mounted there. Copy `android-tv/assetlinks.example.json` to `infra/caddy/assetlinks.json` (gitignored),
edit it, and `docker compose exec web caddy reload --config /etc/caddy/Caddyfile`.
