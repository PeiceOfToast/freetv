# Web track: connect page and admin site settings (hub round)

## Built
- `apps/web/src/lib/qr.ts` (new): byte-mode QR encoder, EC level M, versions 1 to 10 (up to 213 bytes). `encodeQr(text)` returns the module grid, or `null` when the text is too long. `qrPathData(grid)` returns SVG path data. No dependency.
  Verified: ten test strings, including the version-10 limit, decode with jsQR in a scratch install (not a project dependency). A 214-byte input is refused as expected.
- `apps/web/src/lib/admin-api.ts` (additive): `adminApi.settingsGet(token)` and `adminApi.settingsPut(token, patch)`, with `AdminSettings` and `AdminSettingsPatch` types. Uses a new `sendJson` helper; the existing `request` is unchanged.
- `apps/web/src/pages/connect/`:
  - `ConnectPage.tsx` (default export kept): hero with the site name, the three-way strip, Playlist and Guide cards (copy button, read-only link, inline SVG QR), Customise, and per-app sections. Falls back to `window.location.origin` if settings fail.
  - `Customise.tsx`: countries (filterable checkboxes, from `api.countries()`), categories, quality radios, "My favorites only" (disabled at zero favorites; warning above 150), and `streams=all`.
  - `urls.ts`: pure URL builders (`buildPlaylistUrl`, `buildGuideUrl`).
  - `apps.ts`: per-app steps for TiviMate, VLC (desktop, plus phone notes), Kodi, Plex, Jellyfin, IPTV Smarters, and Any other app. Mirrors docs/TV.md section 6. Every section ends with the refresh line.
  - `QrCode.tsx`: QR component; shows a text note when the URL is too long for version 10.
  - `useSettings.ts`: module-wide cache for `api.settings()`. Failures are not cached. `loadSettings(force)` refetches.
- `apps/web/src/pages/admin/SettingsPanel.tsx`: "Site settings" card with name, public URL (with "Use env default (...)"), contact, notes, featured apps, Save, Discard, and "Preview connect page". Client-side validation. Server errors appear inline on the matching field when the message names it, otherwise as a form-level alert. Success and failure toasts go through the AdminPage toast. A save calls `loadSettings(true)`.
- `apps/web/src/pages/admin/AdminPage.tsx`: renders `SettingsPanel` below the status grid. This is the only edit outside new files.

## Integrator to-dos
1. **Layout and About should adopt `useSettings()`** (`pages/connect/useSettings.ts`) for the header brand text (`siteName`) and About's operator text. Not done here because Layout is outside this track.
2. **Layout header overflows at 390 px.** The theme select and "?" button push the document to about 477 px wide on every page, including /connect and /admin. The page content itself does not overflow. Fix in `components/layout/Layout.tsx`, for example by hiding the theme label or wrapping the header row.
3. The admin "Docs" link still points at `/about` (unchanged).

## Verification
- `cd apps/web && npm run build`: zero errors.
- The API was not live on :3000, so screenshots used Playwright route mocks for `/api/settings`, `/api/countries`, `/api/categories` and `/api/admin/settings`, shaped as in docs/API.md. Checked at 1280 and 390 wide: no overflow from connect or admin content; playlist, guide and customised URLs are correct; inline validation and server-error mapping work; the save toast fires; no page errors.
- Not checked against the real API. Field-level mapping of 400 errors depends on the error text naming the field. If the API returns structured field errors, `SettingsPanel` should read them instead.
- Per-app menu names come from docs/TV.md. They are marked "verify" where unsure: the Smarters EPG field, Plex availability, and VLC phone behaviour.
