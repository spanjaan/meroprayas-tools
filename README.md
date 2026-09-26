# MeroPrayas — Tools Dashboard PWA

A browser-only PWA with a clean tools dashboard. Everything runs locally — no server upload.

## Routes

| Route | Tool |
| --- | --- |
| `/` | MeroPrayas Tools dashboard (3 tool cards) |
| `/compressor` | Image Compressor |
| `/unicode` | Unicode Converter (Unicode ⇄ Preeti) |
| `/pdf-editor` | PDF Tools (merge / split / compress / jpg-to-pdf / pdf-to-jpg) |

Routing is a lightweight `history.pushState` router (`js/router.js`); direct URLs, refresh,
back and forward are supported. `tests/server.js` serves the app shell for extensionless
routes so direct navigation works in tests and on any static host with an SPA fallback.

## PDF tools

`/pdf-editor` (subroutes `/pdf-editor/split`, `/pdf-editor/compress`, ...) is backed by
`js/pdf-editor.js`, loaded lazily with the vendored `pdf-lib`, `pdf.js` and `jszip` builds
under `vendor/` so the home page and image tools stay lightweight:

- Merge multiple PDFs with drag & drop reordering
- Split by page ranges, selected pages, or one file per page
- Compress by re-encoding pages as JPEG at three quality levels (honest reporting when a
  PDF cannot be reduced — the original file is preserved)
- JPG/JPEG/PNG to PDF with A4 / Letter / original page sizes and fit modes
- PDF pages to JPG with DPI presets, custom resolution/quality, ZIP download-all

Everything runs locally in the browser; no file ever leaves the device.

## Image tools

The compressor workspace (`/compressor`) is backed by `js/compressor.js` + `js/ui.js`:

- JPG, PNG, WebP, GIF, BMP and SVG input
- Multiple images and drag & drop
- Original preview + original file size and dimensions
- Quality slider
- JPEG / WebP / PNG / original output selection
- Interactive crop tool with Free, 1:1, 4:3, 16:9, 3:2 and 9:16 presets
- 90° left/right rotation, horizontal/vertical flip
- Perspective correction: drag the four corner handles to straighten skewed photos or documents
- Auto Detect: one-click document corner detection, entirely on-device
- Corner magnifier while dragging perspective handles for pixel-precise placement
- Width and height resize presets (480–1920 px) plus custom size with aspect-ratio lock
- Live crop/rotate editing preview before compression
- Undo/redo and reset inside the editor (perspective applies are undoable too)
- Keyboard access: arrow keys nudge the crop selection (Shift = ×10)
- Compressed output appears only after pressing Compress all
- Changing quality, format or resize invalidates the old compressed result
- Actual output size and saved percentage
- Individual, per-image removal and batch downloads
- Remembers your last quality / format / size / theme across visits
- Light/dark theme
- Installable PWA
- Offline app shell
- No server upload; processing stays in the browser

## Unicode converter

`/unicode` converts Nepali text between Unicode and the classic Preeti legacy font using
the key map in `js/preeti-map.js` as the single source of truth
(`js/unicode-converter.js`). Conversion is layout-faithful — every legacy keystroke maps
per the key map, including digits (`"1"` → ज्ञ in Preeti) — and round-trips exactly:

- Both conversion directions (Unicode ⇄ Preeti)
- Live conversion (250 ms debounce) or a manual Convert button
- Swap formats, paste/copy, download as UTF-8 `.txt`, char counts via Unicode code points
- Non-blocking notice when a character cannot be represented in the target format
- The Preeti font is used for preview only; conversion is pure text mapping, 100% on-device

## Run locally

A service worker requires a secure context. Use VS Code Live Server, for example:

1. Open this folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `index.html`.
4. Choose **Open with Live Server**.

Or use another local HTTP server.

Do not open `index.html` directly as `file://` if you want PWA/offline service-worker behavior.

## Testing

Playwright tests cover the compressor logic, perspective warping, document detection,
the full UI flow, the PDF tools, the unicode converter (engine round-trips and the full
UI) and offline caching (93 tests):

```bash
npm install
npm test
```

The first run downloads a browser; the suite needs Node 18+.

## Notes

- Animated GIF input is decoded as a single browser-rendered frame and exported as a static image.
- SVG is rasterized by the browser and can be exported to WebP/JPEG/PNG.
- PNG encoding is lossless in the browser; the quality slider has little/no effect on PNG.
- Very large images can hit browser canvas memory limits.
