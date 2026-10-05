# Architecture

This document is a code map. It answers two questions: where is the code that does X, and how
does data move through it? [`studio.md`](studio.md) describes what the studio does for the person
using it, [`export-format.md`](export-format.md) describes the exported files, and
[`security-model.md`](security-model.md) describes how untrusted input is handled.

The app is one Astro site in `app/`. It has three pages of its own: a product page, the studio and
an About page. It also contains a demo site built with Starlight, "Orbit Docs", under `/demo/`. The
studio themes that demo site by loading it in a same-origin frame and changing its live styles.

## Routes

| URL | Built by | Role |
|---|---|---|
| `/` | `app/src/pages/index.astro` | The product page. It explains the tool, shows the studio in four presets, and links to the studio, the About page and the repository. |
| `/studio/` | `app/src/pages/studio.astro` | The studio: the shell (top bar, toolbar, context line and preview stage) around the demo site in a frame. |
| `/about/` | `app/src/pages/about.astro` | The About page, for direct links and sharing. |
| `/demo/...` | `app/src/content/docs/demo/` | Every page of the demo site, through Starlight's content collection. |
| `/404/` | Starlight's built-in page | A `splash` page, because the demo site has no `404.md` of its own. |

The product page and the About page are deliberately not Starlight content pages. A page under
`app/src/content/docs/` would join the demo site. It would pick up the visitor's theme preview, and
it would appear in the demo site's sidebar and search.
[Decision 0006](decisions/0006-standalone-about-page.md) records this choice.

## The source tree

| Path | Contents |
|---|---|
| `app/src/pages/` | The three pages of the site's own: `index.astro`, `studio.astro` and `about.astro`. |
| `app/src/customizer/core/` | Logic with no DOM: state, the control manifest, color math, the two exporters, undo history and the sidebar model. |
| `app/src/customizer/ui/` | Code that touches a page: the panel, the studio shell, the controls, the dialogs and the tiles. |
| `app/src/about/` | The About text, `about.md`, and the component that renders it, `AboutBody.astro`. |
| `app/src/components/` | `CustomizerFooter.astro`, which mounts the `<sl-customizer>` element on every Starlight page. |
| `app/src/content/docs/demo/` | The demo site's Markdown and MDX pages. |
| `app/src/content.config.ts` | Registers that content as the `docs` collection, with Starlight's loader and schema. |
| `app/src/assets/` | The product page's screenshots and the image on the 404 page. |
| `app/src/demo-site.mjs` | The `demo/` prefix for the demo site's URLs and sidebar. |
| `app/src/fixture-sidebar.mjs` | The demo site's sidebar tree, without the prefix, because the Structure editor exports it into users' own sites. |
| `app/src/route-data.js` | Points the demo site's header title link at `/demo/` instead of the site root. |

### `customizer/core/`

Every module in `core/` stays free of the DOM: it never reads `document` or `window`. The unit
tests import these modules directly in Node, through `node --test "tests/core/**/*.test.js"` in
`app/package.json`, where no DOM exists. Each module's header comment repeats the rule.

| Module | Purpose |
|---|---|
| `base-path.js` | `withBase()` and `stripBase()` convert between internal paths and real paths, so the app works at `/` or under a sub-path. |
| `color.js` | A port of the color algorithm from Starlight's own theme designer. It builds the light and dark palettes from hue and chroma, and it holds the hex, HSL and RGB conversions and the contrast math. |
| `emit-apply.js` | Writes `APPLY-THEME.md`. |
| `emit-css.js` | Writes `theme.css`. |
| `history.js` | The undo and redo stack over theme snapshots. It merges edits that share a key within a short time window. |
| `ia.js` | Converts between Starlight's `sidebar` config, the editor's own tree, and pasted text. It also holds the link filters `safeLinkHref` and `safeLinkAttrs`. |
| `manifest.js` | The control manifest: every control's id, type, default, options and `target` selector, as data only. |
| `presets.js` | The nine presets: `starlight-default` (Starlight's own look), four ported from Starlight's official theme designer, and four "character" presets of the studio's own. |
| `project.js` | The project's public addresses: `REPO_URL`, `HUB_URL` and `TOOL_URL`. |
| `share-link.js` | Decides which theme a visit opens with when a share link competes with a saved theme, and builds share URLs. |
| `sizing.js` | The steps and limits of Studio sizing. |
| `state.js` | The `ThemeState` helpers: `defaultState`, `getValue`, `setValue`, `applyPreset`, `encodeState`, `decodeState` and `sanitizeState`. |
| `treatments.js` | The exact CSS for each option of each select control, keyed by control id and option value. Its selectors come from the installed Starlight source. |
| `version.js` | `STARLIGHT_VERSION`, the one pinned version string. A unit test compares it with the installed package. |

### `customizer/ui/`

| Module | Purpose |
|---|---|
| `color-picker.js` | The hex-first color popover. It wraps `vanilla-colorful`'s `<hex-color-picker>` with a hex field, a format switch and an eyedropper button. |
| `controls.js` | Builds the panel's body: the preset gallery, the collapsible sections, each control, and the contrast readout. |
| `export.js` | The Export dialog, with the zip download and the PNG screenshot capture. |
| `ia-editor.js` | The Structure editor for the sidebar tree. |
| `inspect.js` | Inspect: click an element on the preview to reach the controls that style it. |
| `page-doc.js` | `getPageDoc()`, `getPageWin()` and `getPageDocs()`: the one route from any code to the previewed page. |
| `panel.js` | The `<sl-customizer>` element. It owns the theme state, the panel in its shadow root, saving, and the wiring between the other modules. |
| `preview-approx.js` | Stamps each table-of-contents entry with its heading level, so the preview CSS can filter the table of contents by level. |
| `share-dialog.js` | The two share-link dialogs: "Open the shared theme?" and the damaged-link message. |
| `sidebar-render.js` | Re-renders the demo site's sidebar after a Structure edit. It clones real rendered elements, so Astro's scoped style classes carry over. |
| `studio-sizing.js` | Applies Studio sizing to the chrome, and exposes `getChromeZoom()` for code that measures positions inside the zoomed chrome. |
| `studio.js` | The studio shell's logic: the top bar, the toolbar, the context line, and the preview stage with one or two lanes. |
| `styles.js` | The stylesheet for `<sl-customizer>`'s shadow root, with its own fixed palette. |
| `target-highlight.js` | Draws the box that shows which element a control changes, without touching that element. |

### `customizer/ui/tiles/`

| Module | Purpose |
|---|---|
| `index.js` | Decides whether a select control shows tiles or a dropdown, and which renderer it uses. It owns `computeTileLayout`. |
| `tile-grid.js` | The tile widget: a native radio group with one tile per option. |
| `page-styles.js` | Copies the page's stylesheets into each tile group's own shadow root, so real Starlight styles apply to the samples. |
| `samples.js` | The sample markup for each control. It clones elements from the page where Starlight scopes styles to a component, and builds them by hand where Starlight's styles are global. |
| `scope-css.js` | Rewrites an option's CSS so it only matches inside that option's tile. |
| `wireframes.js` | Layout diagrams, as inline SVG, for the alignment controls. |
| `fonts.js` | The font list, with each name set in its own font. It loads the font files only when Typography opens. |

## How data flows

1. **The manifest defines the controls.** `app/src/customizer/core/manifest.js` lists every
   control, with its type, default, options and `target` selector.
2. **The state holds the choices.** `ThemeState` in `app/src/customizer/core/state.js` stores only
   the values that differ from their defaults. Its helpers return new objects and never change the
   old ones. `app/src/customizer/ui/panel.js` holds the current state for the session.
3. **Every edit is an undo step.** `app/src/customizer/core/history.js` records each change. It
   merges a run of edits that share a key, such as one slider drag, into a single step.
4. **The state restyles the preview.** The panel writes styles into the previewed page, not into
   the studio's own document. It reaches that page through `app/src/customizer/ui/page-doc.js`.
5. **The browser keeps the theme.** `panel.js` saves the encoded state to
   `localStorage['svc-state']`. It also saves the preview's CSS to `localStorage['svc-css']`. A
   script in the head of every demo page, set in `app/astro.config.mjs`, paints that CSS before
   the page appears. So a navigation never flashes the default theme.
6. **The exporters write the files.** `emitCss` in `app/src/customizer/core/emit-css.js` writes
   `theme.css`, and `emitApplyTheme` in `app/src/customizer/core/emit-apply.js` writes
   `APPLY-THEME.md`. Both read the same state, manifest and `treatments.js` data, so the two files
   cannot disagree. `app/src/customizer/ui/export.js` presents them.
7. **Share links carry the state.** A share link holds the encoded state after `#svc=`.
   `app/src/customizer/core/share-link.js` decides whether an arriving link opens directly or asks
   first, and `app/src/customizer/ui/share-dialog.js` asks.

Every theme that arrives from outside the studio passes through `sanitizeState` in
`app/src/customizer/core/state.js` before anything else reads it. That covers a share link, the
saved theme and an imported file. [`security-model.md`](security-model.md) explains the checks.

## Subsystems

### The route to the previewed page

`app/src/customizer/ui/page-doc.js` is the one route by which any code reaches the previewed page.
Theming, table-of-contents stamping, sidebar re-rendering, "follow on page" highlighting, the tile
samples, light and dark mode, and Inspect all go through it. In the studio, `getPageDoc()` and
`getPageWin()` return the preview frame's document and window. `getPageDocs()` returns both lanes'
documents in Split view. Attaching to a document again after the frame navigates does nothing new,
so it never resets the panel's state or scroll position.

### Overlay mode

Every demo-site page loads the customizer through Starlight's `Footer` override,
`app/src/components/CustomizerFooter.astro`. On such a page outside the studio, the customizer
applies the saved theme and shows a small "Open in Studio" button.

When the URL carries `?svc-overlay`, the page mounts an older floating panel instead. No preview
frame exists in that mode, so `page-doc.js` returns the page's own document. The browser suites
`smoke`, `ui-round2`, `treatments`, `targets` and `tiles` use overlay mode to drive the panel
without the studio shell.

### Base paths

Every internal URL that the customizer builds at runtime goes through `withBase()` or `stripBase()`
in `app/src/customizer/core/base-path.js`. They build on Astro's resolved
`import.meta.env.BASE_URL`. [`development.md`](development.md#how-the-code-handles-the-base-path)
explains which values stay free of the base, and why.

### Tiles

`app/src/customizer/ui/tiles/index.js` decides whether each select control shows tiles or a
dropdown. For tiles, `computeTileLayout` chooses a two-column grid or full-width rows. It returns
rows for every control when the panel is narrower than 480 pixels, and the studio's panel is 340
pixels wide. So in the studio, every tiled control renders in one column. The grid only applies to
a wider panel.

Each tile renders a real sample. `page-styles.js` copies the page's stylesheets into the tile
group's shadow root, `samples.js` supplies the markup, and `scope-css.js` limits each option's CSS
to its own tile.

### Color assists and the color popover

The `COLOR_ASSIST` map in `app/src/customizer/ui/controls.js` drives the gradient tracks, the live
swatches, the hex field and the picker. These appear on the Colors group's hue and chroma sliders,
and on every `color.role.*` override. `hexToOklchHueChroma` and `hexToHslHue` in
`app/src/customizer/core/color.js` turn a hex value back into hue and chroma.

`app/src/customizer/ui/color-picker.js` is the popover. Only `controls.js` imports it. Its import
calls `customElements.define` as a side effect, and that call must never reach the unit tests that
run in Node.

### The Structure editor

`app/src/customizer/ui/ia-editor.js` exports two tree builders from one dispatcher:
`createOverlayTreeEditor` and `createStudioTreeEditor`. The panel chooses one when it mounts, by
whether the page is in the studio or in overlay mode. The studio's builder adds its own drag marker
and Escape-to-cancel.

On the first edit, the editor copies the demo site's sidebar from `app/src/fixture-sidebar.mjs`
into `state.ia`. It then edits its own working copy and calls back into `panel.js`, which saves
the change and re-renders the sidebar.

### The product page's preset data

`app/src/pages/index.astro` builds its preset chips, the preset count in its heading and its tab
dots at build time. It reads `app/src/customizer/core/presets.js` through
`getPresetLightPalette` in `app/src/customizer/core/color.js`. The studio's preset cards use the
same function, so both follow any preset change.

The product page's screenshots do not follow on their own. They are PNG files in
`app/src/assets/home/`, which Astro converts to WebP at three widths. Capture them again when the
studio's look changes. The logo is `app/public/logo.svg`, a mark that is still a work in progress.

The product page sets its text in Inter, self-hosted from the `@fontsource-variable/inter`
package. Astro bundles the font files, and only this page's stylesheet loads them. No font comes
from another host, because the About page promises that the only third-party requests are
web-font previews from jsDelivr.

### One source for the About text

The About text lives in `app/src/about/about.md`. `app/src/about/AboutBody.astro` renders it and
adds a facts line with the Starlight version and the repository and hub links. The About dialog in
`app/src/pages/studio.astro` and the page `app/src/pages/about.astro` both render that one
component at build time.

The repository and hub addresses live in one module, `app/src/customizer/core/project.js`. It also
exports `TOOL_URL`, the product page's address. The header of `theme.css` and the last line of
`APPLY-THEME.md` both link to it. So every site that uses an export carries a path back to the tool.

## Tests

`app/tests/core/` holds the unit tests, which run in Node with no DOM. `app/tests/e2e/` holds the
13 browser suites. `app/tests/golden/` holds the expected export files, which
`app/scripts/update-golden.mjs` rewrites after an intended change. `app/tests/roundtrip/` applies a
real export to a freshly scaffolded Starlight site and compares the result with the preview.
[`testing.md`](testing.md) explains how to run each one.

## To change X, start in Y

| To change | Start in |
|---|---|
| A control, or add one | `app/src/customizer/core/manifest.js`, then `app/src/customizer/core/emit-css.js` or `treatments.js` for its CSS |
| The exported CSS | `app/src/customizer/core/emit-css.js` and `app/src/customizer/core/treatments.js` |
| The steps in `APPLY-THEME.md` | `app/src/customizer/core/emit-apply.js` |
| A preset, or add one | `app/src/customizer/core/presets.js` |
| The color algorithm or a color conversion | `app/src/customizer/core/color.js` |
| A tile's sample | `app/src/customizer/ui/tiles/samples.js`, or `wireframes.js` for a diagram |
| The Structure editor | `app/src/customizer/ui/ia-editor.js`, with the data model in `app/src/customizer/core/ia.js` |
| The rules for share links | `app/src/customizer/core/share-link.js`, with the dialog in `app/src/customizer/ui/share-dialog.js` |
| What is checked on the way in | `sanitizeState` in `app/src/customizer/core/state.js`, and the link filters in `app/src/customizer/core/ia.js` |
| The studio's chrome | `app/src/pages/studio.astro` and `app/src/customizer/ui/studio.js` |
| The panel's look | `app/src/customizer/ui/styles.js` |
| A demo page | `app/src/content/docs/demo/` |
| The demo site's sidebar | `app/src/fixture-sidebar.mjs`, with the `demo/` prefix in `app/src/demo-site.mjs` |
| The product page | `app/src/pages/index.astro` |
| The About text | `app/src/about/about.md` |

## Known gaps

- **Tile samples are built once,** from the primary lane's first ready page, which is normally the
  Style guide. They are not rebuilt after later navigation.
- **Two header tiles look almost the same.** "Default border" and "No border" are hard to tell
  apart, because Starlight's real border is a faint 1-pixel line. The tiles show it truthfully
  rather than exaggerating it.
