# Cross-device responsive audit

Scope: the non-TV parts of `apps/web/src`. Audited on the `vite preview` build (Chromium, Playwright device presets).
Screenshots are in the scratchpad (not the repo): `shots-before/` and `shots-after/`, dark scheme only.

## Method and limits

- Devices: iPhone SE, iPhone 13, iPhone 14 Pro Max, Pixel 5, Pixel 7, Galaxy S9+ (phones); Galaxy Tab S4, iPad Mini,
  iPad Pro 11 (tablets); 1280x800 and 1920x1080 (desktop). Phones and tablets in portrait and landscape where the
  preset allows it. Each in dark and light colour schemes. 208 runs per audit (both before and after).
- Pages: `/`, `/?category=news&country=US`, `/watch/BBCNews.uk`, `/guide` (favourites seeded), `/about`, and the
  filter drawer on every viewport below 1024 px.
- **WebKit is not installed.** The iPhone presets run in Chromium with an iOS user agent. Safari-specific behaviour
  (rubber-banding, `env()` insets, native select pickers, input zoom) is not measured. Those items below are checked by
  reading the code, not by running it.
- `env(safe-area-inset-*)` resolves to 0 in emulation, so safe-area handling is verified statically.
- Non-app hosts are blocked during the run, so channel logos fall back to initials. Layout is measured with the fallback.
- Tap targets: a control counts as small when its hit box is under 44 x 44 on touch presets. Two cases are not
  counted as findings: (a) card title links stretched over the whole card (`after:inset-0`), measured on the card's box;
  (b) checkboxes and radios inside a label of at least 44 px, measured on the label.

## Before and after (device x page, touch presets)

Columns: horizontal overflow (page-level), smallest text under 12 px, small controls, small labels. "Stretched" card links
are not findings (they cover the card, at least 44 px).

| Device (orientation, scheme) | Page | Before | After |
|---|---|---|---|
| All phones and tablets, all orientations | `/`, `/?category`, `/guide`, `/about` | No overflow. Text 10 px (tag badges, `text-[10px]`). Filter count badge 11 px. | No overflow. No text under 12 px. |
| Phones and tablets | Browse drawer | Text 10 px. 2 to 4 filter list labels under 44 px (checkbox rows). 2 small controls (not identified in the audit output). | No findings. |
| iPhone 13 / Pixel 7 / Galaxy S9+ | `/guide` | 2 small controls (`<summary>`), 1 small label. | None. |
| iPad Mini / iPad Pro 11 landscape (sidebar) | `/`, `/?category` | 2 small labels (Toggle rows) and 2 small controls per page. | None. |
| Desktop 1280x800 | `/?category` | Page overflow 14 px (card title inline `a.truncate` ran to x=1294). Text 10 px. | No overflow. No text under 12 px. |
| Desktop 1920x1080 | all | Text 10 px on browse. | No text under 12 px. |
| Phones, watch `/watch/BBCNews.uk` | watch | No overflow. 12 px minimum. **Landscape (844x390): stacked, so the video plus info exceed one screen.** | Landscape at 640 to 1023 px wide and 500 px high or shorter now uses a split layout (player left, info right). |
| Phones, guide `/guide` | guide | No overflow. Timeline height 70vh. Fixed 200 px channel column on phones. | Timeline 70dvh. 168 px channel column below 640 px. |

Summary: horizontal overflow fell from 1 page (desktop 1280) to 0. Small text fell from every browse page to 0. Small
targets fell from about 2 to 4 per page to 0 on touch devices.

Grid columns: unchanged for the measured widths (phones 2, 768 and 834 portrait 3, 1194 4, 1280 and 1920 5 or 6). A new
4-column step at 900 px only changes widths between 900 and 1023 px. No preset falls in that range.

## What changed

- `src/index.css`
  - Touch-only sizing: `input` fields and `button`/`select`/`a.btn` get a 44 px minimum. Checkboxes and radios are
    excluded. The old global rule forced filter checkboxes from 14 px to 44 px (checked with a probe on iPad Pro 11
    landscape). Checkbox rows now get their 44 px from the label.
  - 16 px floor for form fields on touch (`input`, `select`, `textarea`), so iOS does not zoom on focus.
  - `html.dark` and `html:not(.dark)` set `color-scheme`, so native select popups and scrollbars follow the app's theme
    choice (previously only the OS setting).
  - `.watch-split` landscape layout (640 to 1023 px wide, 500 px high or shorter, landscape).
  - `prefers-reduced-motion`: disables smooth scrolling, transitions and animations.
- `components/layout/Layout.tsx`: `min-h-dvh` for the page shell (`min-h-screen` fallback).
- `pages/browse/BrowsePage.tsx`: sticky search and sidebar offsets include `env(safe-area-inset-top)`. Fluid heading.
  Sidebar scroll contained.
- `components/browse/ChannelGrid.tsx`: breakpoints `sm:3`, `min-[900px]:4`, `xl:5`, `2xl:6`. The skeleton uses the same grid.
- `components/browse/ChannelCard.tsx`: title link is `block truncate` (the inline version overflowed the card by 14 px at
  1280). Badges and categories raised from 10 and 11 px to 12 px.
- `components/browse/FilterDrawer.tsx`: `h-dvh` wrapper. Header, footer and left edge pad for safe areas. Scroll area
  uses `overscroll-contain`. Backdrop uses `touch-none`, so touch scroll does not reach the page behind it.
- `components/browse/FilterPanel.tsx`: 44 px label rows on touch (`pointer-coarse:min-h-11`).
- `components/browse/Toolbar.tsx`: count badges to 12 px.
- `pages/watch/WatchPage.tsx`: `watch-split` grid class. Breadcrumb link 44 px tall on touch. Fluid heading.
- `pages/watch/Schedule.tsx`: `overscroll-contain`.
- `pages/guide/GuidePage.tsx`: `<summary>` 44 px tall on touch. Fluid heading. (The file was changed on disk during the
  run by another process; my edits applied on top of its current content.)
- `components/guide/TimelineGrid.tsx`: `max-h-[70dvh]` and `overscroll-contain`. Channel column 168 px below 640 px wide,
  200 px above, with a media-query listener.
- `components/guide/ProgrammePopover.tsx`: bottom offset includes `env(safe-area-inset-bottom)`. Description scroll
  contained.
- `components/guide/ChannelSearch.tsx`: results list `overscroll-contain`.
- `pages/about/AboutPage.tsx`: fluid heading.

## Browser differences (iOS Safari vs Android Chrome) by code review

| Concern | Status |
|---|---|
| (a) `100vh` vs dynamic viewport | Fixed: Layout shell, guide timeline, drawer wrapper use `dvh` (with `vh`/`screen` fallback). Browse sidebar already used `100dvh`. |
| (b) Safe-area insets | Already on header, footer, install hint, update toast. Added to: browse sticky search and sidebar, filter drawer header/left/footer, guide popover. Not measured in emulation. |
| (c) Input zoom under 16 px | Fixed: global 16 px floor for fields on touch. Covers the sort select, theme select, player source select, filter and channel search fields. |
| (d) `-webkit-tap-highlight-color` | Already transparent on `body` (inherited). No change. |
| (e) Overscroll and rubber-banding | Contained in the drawer, timeline, schedule, popover and channel search list. Page scroll left as is (Android pull-to-refresh is not blocked). |
| (f) Native select styling | Dark mode now sets `color-scheme` from the app theme. The pickers themselves still differ by platform (iOS wheel, Android dropdown). Not changed. |
| (g) Sticky inside overflow | Schedule date headings sit in a scroller with `overflow-y-auto`, which is fine. The guide's sticky channel column sits in an `overflow-auto` container. This works in Chromium. WebKit is not verified. |
| (h) `position: fixed` and the Android keyboard | Only the filter search field is inside a fixed element, and that element is `h-dvh`. Recommendation: add `interactive-widget=resizes-content` to the viewport meta in `apps/web/index.html`. That file is outside the allowed scope, so it is not changed. |

## Not done (outside scope or not measurable)

- `apps/web/index.html`: `interactive-widget=resizes-content` (see h).
- Phone landscape at 568 px (iPhone SE) stays stacked, because the split starts at 640 px. The video is about 320 px high
  and the page scrolls.
- Real-device checks on iOS and Android: not run.
- `src/pages/tv/**`, `src/components/tv/**`, `spatial-nav.ts`, `App.tsx`, `lib/api.ts`: not touched.

## Build

`npm run build` passes with zero TypeScript errors (`tsc -b` then `vite build`).
