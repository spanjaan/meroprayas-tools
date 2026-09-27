# Fix: PWA install button never displays on iOS / Android

## Root cause (verified by live diagnostics, not guesswork)

The install button is revealed **exclusively** by the `beforeinstallprompt` event:

- `index.html:311` — `<button class="btn btn-ghost" id="installBtn" hidden>Install</button>`
- `js/ui.js:1648` — `els.installBtn.hidden = false;` (only ever called from here)
- `js/app.js:15-19` — the only caller of `UI.setInstallHandler()`

**iOS:** Safari does not implement `beforeinstallprompt`. The event never fires, so
`#installBtn` stays `hidden` permanently. There is no iOS fallback anywhere in the repo.

Compounding this, `index.html:16` only has the legacy `mobile-web-app-capable` name, which
iOS ignores. Without `apple-mobile-web-app-capable`, even a manual Add-to-Home-Screen
launches a browser tab instead of a standalone app.

**Android Chromium:** works, but degraded. Verified in real Chromium (Pixel 7 emulation,
persistent profile — the incognito default makes `Page.getInstallabilityErrors` return
`in-incognito`, which is a test artifact, not a real defect):
- `beforeinstallprompt` fires, SW activates and claims the page, button reaches `display:flex`
- Chrome reports **zero** installability errors; the manifest parses clean
- BUT `event.preventDefault()` is never called → Chrome shows its own native mini-infobar
  *in addition to* the custom button
- BUT `js/ui.js:1649-1654` hides the button unconditionally after any click, even when
  `outcome === 'dismissed'` → one accidental tap removes it for the whole session
- Any browser without `beforeinstallprompt` (in-app browsers: Facebook/Instagram/WhatsApp/
  LinkedIn; Firefox for Android) shows **no button at all**

**Ruled out:** layout. Measured at 320 / 390 / 412px — no clipping, no overflow,
`documentElement.scrollWidth === innerWidth`. CSS (`.top-actions`, `.btn`, `[hidden]`) is fine.
Also ruled out: the manifest and service worker are valid.

## Architecture of the fix

Stop making a one-shot event the sole trigger. **Button visibility is driven by platform
capability; the `beforeinstallprompt` event only upgrades the button from "show
instructions" to "real native prompt".**

```
if (isStandalone())              -> hidden
else if (isIOS())                -> visible, click opens iOS instruction sheet
else if (isChromium())           -> visible, click uses deferred prompt or generic sheet
else if (beforeinstallprompt)    -> visible, native (safety net)
else                             -> hidden
```

This makes the button work in Android in-app browsers too (Chromium-based, so it shows;
no deferred prompt on click, so it falls back to the instruction sheet).

---

## Changes

### 1. `index.html`
- Add `<meta name="apple-mobile-web-app-capable" content="yes">` next to `index.html:16`.
  Required for iOS standalone launch.
- Add the install-help `<dialog>` after the existing `cropDialog` (`index.html:1714`),
  before the script tags at `index.html:1923-1931`. Reuse the `<dialog>` + `.sr-only`
  close-button conventions. Contains: title, ordered step list, close button.
- Two copy variants inside (iOS / generic), toggled by a `data-variant` attribute.

### 2. `js/app.js` (currently 47 lines)
- Add `INSTALLABLE_DISPLAY_MODES` media-query constant (hoisted out of the inline
  `matchMedia` at `js/app.js:11`).
- `isStandalone()` — extracted, reusable.
- `isIOS()` — UA/platform sniff, including the iPadOS 13+ desktop-UA case
  (`navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1`).
- `isChromium()` — UA sniff for `Chrome/ | Chromium/ | CriOS/ | Edg/ | OPR/`.
- `beforeinstallprompt`: **add `event.preventDefault()`** to suppress Chrome's own
  mini-infobar.
- Add a `matchMedia(...).addEventListener('change', ...)` handler so a transition into
  standalone mode is detected live (currently `isInstalled` is frozen at `js/app.js:9-11`),
  with `addListener` fallback for older Safari.
- Call the new `UI.configureInstall(mode)` once at startup.

### 3. `js/ui.js:1646-1660` — rewrite the install controller
Replace the fire-and-forget `setInstallHandler` with a real controller:
- Module state becomes an explicit `installMode` (`'native' | 'ios' | 'chromium' | 'hidden'`)
  plus `syncInstallButton()` to derive `hidden` / label from it.
- `configureInstall(mode)` — new, called from `app.js`.
- `setInstallHandler(event)` — sets mode `'native'`; **keeps** the event.
- `markInstalled()` — mode `'hidden'`.
- Click handler moves from `onclick =` to a single `addEventListener` in `bind()`,
  consistent with the rest of the file.
- On click with a deferred prompt: `await prompt()` then `await userChoice`.
  - `outcome === 'accepted'` → `markInstalled()`
  - `outcome === 'dismissed'` → **keep the button visible and re-enabled** (fixes the
    one-shot regression)
  - wrap in try/catch; on throw fall back to the instruction sheet
- Guard against the consumed-prompt case: a `prompt()` event is single-use, so a second
  click correctly routes to `openInstallHelp()`.
- `openInstallHelp()` — populates the sheet copy for the current mode and `showModal()`s it.
- Add the new functions to the export object at `js/ui.js:1676`.

### 4. `css/style.css`
- `.install-help` dialog styles built from the existing glass dialog recipe
  (alongside `dialog` at `css/style.css:1509+` and `.offline-banner` at `css/style.css:4500`).
- `.install-steps` list styling.
- Keep it minimal — no new design tokens.

### 5. `sw.js`
- `sw.js:50` — `'./assets/developer-avatar.svg'` → `'./assets/developer.webp'`.
  Confirmed 404 via curl; the real file is `assets/developer.webp` (referenced at
  `index.html:1090`) and was never in the precache list. Fixes a 404 on every SW install
  and adds the avatar to the offline cache.
- Bump `CACHE` at `sw.js:1` from `pixelpress-v40` to `pixelpress-v41` so the corrected
  precache is actually deployed (the `activate` handler deletes all other caches, so the
  bump is required for the fix to take effect).

### 6. `tests/install.spec.js` (new)
Zero existing coverage for `#installBtn`. Add Playwright specs driving
`UI.configureInstall()` / `UI.setInstallHandler()` with a fake prompt event:
- hidden by default
- `configureInstall('ios')` → visible; click → sheet opens with iOS copy
- `configureInstall('chromium')` → visible
- `setInstallHandler(fake)` → click → `accepted` → button hides
- `setInstallHandler(fake)` → click → `dismissed` → button **stays visible and enabled**
  (regression test for the one-shot bug)
- `markInstalled()` → hides
- consumed-prompt second click → falls back to the sheet

Note: these drive the app API directly, so the incognito-context limitation that blocks
a real `beforeinstallprompt` in Playwright does not affect them.

---

## Out of scope (audited, reported, not changing)
- `theme-color` ordering at `index.html:8-9` — the unconditional tag precedes the
  `media`-scoped dark one, so dark mode never applies to browser chrome.
- No ESLint config exists, so `npm run lint` silently passes without checking anything.
- `manifest.webmanifest` has no `lang`/`orientation`/`shortcuts` and only a `wide`
  screenshot.
- `apple-touch-icon` is 192×192 rather than the 180×180 iOS prefers.

## Verification
- `node tests/server.js` + Playwright with `channel: 'chromium'` and a **persistent**
  context (required — the default incognito context always reports `in-incognito`).
- Assert `Page.getInstallabilityErrors` is `[]`.
- Confirm button `display:flex` and a 0-width overflow at 320px.
- Run `npx playwright test`.
