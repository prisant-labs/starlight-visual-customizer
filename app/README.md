# Starlight Visual Customizer

Variation C rebuilds B's overlay panel into a full-viewport **studio**: the Codex prototype's look
(a top bar, a left icon rail, a toolbar, a status bar) driven entirely by B's real-Starlight engine
(real iframe rendering, the manifest-driven controls, tiles, color assists, `theme.css` +
`APPLY-THEME.md` export). Phase 1 built the shell and ported 21 Codex-only controls onto real
Starlight 0.42.4 selectors. Phase 2 added **Inspect** (click an element on the page to reach its
controls, Lens-style), primary-editor **hex color entry**, self-drawn **preset card** previews, a
restyled **Structure (advanced)** tree, and a **site title** control.

- **Tiles:** 19+ controls, always ONE column at the panel's real width (SPEC-C P5 - two columns only apply at 480px+, which this panel never reaches today). Component styles (sidebar, TOC, callouts, inline code, links, tables, tabs, header, search box, pagination) render real Starlight elements in your current colors and recolor live, trimmed to the least content that still shows the difference between options (SPEC-C P6); alignment controls render small layout diagrams; fonts are a list with each name set in its own font. Contrast level and code theme stay dropdowns (nothing to picture / build-time only). Clicking anywhere on a tile selects it - the caption (label + a check glyph when selected) sits above the preview, and the preview itself is `inert` so a cloned page control inside it can never intercept the click. Grid vs. rows is a rule, not a per-control choice (`src/customizer/ui/tiles/index.js`'s `computeTileLayout`).
- **Collapsible sections and cards:** inside a group, each manifest `section` is its own disclosure, and each control is further collapsible on its own (SPEC-C P4) - both start OPEN by default (settled with the maintainer 2026-09-24), remembered per group/section/control in `sessionStorage['svc-ui']`. A dot on a collapsed section's header means a control inside it is non-default; a collapsed card shows its current value on its own header line (e.g. "720 px", a color chip + hex, "On"). The group header's **Expand all** / **Collapse all** buttons act on both levels - Collapse all first collapses every card, then (pressed again) the sections too; Expand all opens both at once.
- **Color controls, hex-first:** hue and chroma stay sliders (Starlight's whole palette - and its five semantic hues - is a hue/chroma pair run through the official designer's algorithm, which tunes lightness per role for readability), but every one now also gets a **hex text field as the primary editor** beside a live gradient track, live swatches, and a **hex-first popover picker** (SPEC-C P3: vanilla-colorful's saturation/hue picker plus its own hex field and an eyedropper button when the browser supports it - Chrome's own native picker dialog can't be forced into hex mode, so it's gone). One consistent layout throughout: the slider row, then a hex+picker row, then the swatch strip, then the note/help. Typing a hex and pressing Enter (or blurring the field, in the row or in the popover) back-solves hue (and, for accent/gray, chroma) as **one** undo step; a drag inside the popover coalesces into one step too. Starlight's own per-role lightness tuning means the field then shows the color actually *produced*, with a short note when it differs from what you typed. A blur that doesn't change the field's text is always a no-op - it never re-solves from whatever the field happens to be displaying.
- **Role overrides (`color.role.*`):** the same hex field, plus one clear affordance - a small muted **"Auto"** tag when the role is following the generated palette, or a **✕ "Follow the palette"** button once it's overridden (never both, and no separate reset arrow duplicating the same idea).
- **Preset cards:** one column (SPEC-C P1). Each card draws its own mini page preview (header bar, sidebar with an active item, a heading set in the preset's own font, two text lines, an accent callout) from the preset's own light palette - not a generic swatch strip - beside its name; the description lives only in the card's tooltip. The selected card gets the rail's own strong treatment (accent border + check).
- **Structure (advanced):** the sidebar-IA editor, restyled in Codex's tree shape - folder/page icons, indentation guides, a note that this exports as configuration (`APPLY-THEME.md`), "+ Page"/"+ Group", drag-and-drop (a pointer-based custom drag, not the HTML5 `draggable` API - Chromium's native drag-and-drop hangs headless test runs the instant a drag starts), and a move/outdent/indent/delete toolbar (28px targets, tooltips naming each action) beneath a "Selected item" form. While dragging, a clear insertion marker shows where the drop will land - a line between rows for before/after, an outline + tint on a group row for a drop into it - and `Esc` cancels the drag with no structure change and no undo step. Every structural edit (move/indent/delete/drag-drop/rename/...) is its own undo step (a typed rename coalesces into one step, like a slider drag). No new structure capability over B's editor - only the presentation changed.
- **Site title:** a text control (Header group, "Site title" section, build-tier) that renames `.site-title` live in the preview and tells `APPLY-THEME.md` to set Starlight's own `title` config option.
- **Panel header (overlay mode only):** the light/dark toggle is a sun/moon icon button instead of a text button.
- **Pinned:** `@astrojs/starlight` 0.42.4, Astro 7.3.5, Node 22, `vanilla-colorful` 0.7.2 (the color popover, SPEC-C P3).
- **Source:** this `app/` folder, imported 2026-09-25 as one clean commit from the local prototype (Variation C, tag `variation-c-v3.3`); see [History](#history).

## Quick start (PowerShell)

```powershell
cd app
npm install            # first time only
npm run build          # build the site into dist/
npm run preview:bg     # serve dist/ in the background on http://localhost:4420
```

Open <http://localhost:4420/studio/> - the studio (see below), showing the Style guide page (`/specimen/`) by default. A top-level visit to `/` redirects here automatically.

**Stop it:** `npm run preview:stop`

## The studio (`/studio/`)

The customizer's main entry point: a full-viewport app shell, chrome always light (`--ui-*` tokens, independent of the preview's own light/dark mode). Top to bottom/left to right:

- **Top bar** - brand ("Starlight Studio", a small "C" tag), the theme name (editable, `state.meta.name`), save status ("Saved locally" / "Not saved (storage blocked)"), Undo/Redo, Import, and Export (primary).
- **Rail** (72px, left) - one icon per manifest group plus "Structure (advanced)", in `core/manifest.js`'s own order with separators between clusters. A `tablist`; the selected item gets a solid accent fill + a 3px inner-edge bar; a dot marks a group with any non-default control. Selecting most groups scrolls the preview to that group's first visible `target` - not Presets, Colors, Typography, Page options, or Structure. Clicking the already-selected item re-selects the group like any other rail click (the panel column stays open - an earlier build collapsed it on re-click; the maintainer removed that), so it re-scrolls to the group's target the same as a fresh selection does. Collapsing the panel column (more room for the preview) happens only via the collapse button in the panel header or the `\` key; any rail item click reopens a collapsed panel.
- **Panel column** (340px, beside the rail) - a control filter, an eyebrow/title/description/reset-group header, then that group's sections/controls (collapsible sub-sections, tiles, color gradient tracks, hex fields, swatches, picker, the WCAG contrast readout). `rem`-unit controls show/accept px in the number field with a secondary rem readout; `px`-unit controls (except radius/shadow) show a secondary rem readout - the slider always stays in the control's own stored unit.
- **Toolbar** - four page-switcher tabs, consolidated from B's original seven (Style guide default, Document, Landing, 404 - see below); a **Light | Dark | Split** segmented control (Split shows two lanes, forced light/dark, sharing one state); a device control (**Fit | Laptop 1280 | Desktop 1440 | Wide 1920 | Ultra-wide 2560 | Tablet 820 | Mobile 390**) and a **zoom** control (minus, the percentage, plus, **Fit**; 25 to 150 percent; above fit the lane pans sideways, the page itself still scrolls vertically); an **Inspect** toggle and its **Elements** list (see below); "open in new tab" (the page as a visitor sees it, see below). Scaling uses `transform`, and no host ancestor of a preview frame can scroll (`overflow: clip`), so scrolling the page to a control's target never shifts or clips the frame.
- **Context line** - a breadcrumb for the frame's current page and "Real Starlight 0.42.4 build · CSS live" plus the scale label.
- **Status bar** - "N changes from Starlight default" (left), a contrast summary that opens a table dialog on click (middle - computed for both light and dark from the palette actually in effect, not DOM probes of one mode), and version/legend chips (right).

Below 900px wide the panel column becomes a drawer over the workarea, toggled from the top bar; the rail stays visible.

### Export and import

- **Export** (top bar, or `Ctrl/Cmd+E`) opens a dialog listing `theme.css`, `APPLY-THEME.md` and the state file, each with Copy and Download, plus **Download all (.zip)** (all three in one zip named after the theme, via `fflate`) and **Copy share link** (the whole theme in the URL).
- **Screenshot (PNG)** in the same dialog captures the previewed page at its real width in its current light or dark mode: **Full page** (the whole scroll height; accurate) or **Visible area** (what the frame shows now, including a scrolled position - the fixed header, left sidebar with its own scroll position, and right "On this page" TOC all reproduce their real on-screen spot, and the theme/language `<select>`s show their current value). It draws the page into an image in the browser (`modern-screenshot`, loaded only when used), so it has limits: large pages such as Document take 30 seconds or more; effects like `backdrop-filter` may be missing. For a pixel-exact image, use the browser's own screenshot tool.
- **Import** (top bar) loads a state file exported earlier. It is one undo step. Verified 2026-09-25 with a real file picker: export, reset, import restored the accent color, the change count and the theme name.

### The page switcher, in Starlight's own terms

The toolbar's four tabs are **pages of the demo site**, chosen because each exercises something different. Starlight has no per-page "layouts" or "templates" you design yourself: every page is a Markdown or MDX file in `src/content/docs/`, and one shared layout renders all of them. Pages differ in three ways only:

- **The `template` frontmatter field:** `doc` (the default: header, left sidebar, content, table of contents on the right) or `splash` (a wide page without sidebars, usually with a `hero`).
- **Per-page frontmatter options:** for example `hero`, `banner`, `tableOfContents`, `prev`/`next`, `lastUpdated`, `sidebar` (label, order, badge), `pagefind`, `editUrl`.
- **Their content:** length, heading depth, which components they use.

| Tab | URL | Template | What makes it different |
|---|---|---|---|
| **Style guide** (renamed from "Specimen"; the file is still `specimen.mdx`) | `/specimen/` | `doc` | One short instance of every themeable element: type scale, links, inline code, lists, callouts, a table, code blocks, tabs, steps, file tree, cards, link buttons, badges. Also has a `banner`, custom `prev`/`next`, and a TOC set to levels 2 to 4. The default, because it shows the most controls at once |
| **Document** (renamed from "Long doc"; the file is still `guides/kitchen-sink.mdx`) | `/guides/kitchen-sink/` | `doc` | The same kinds of content at full length: about 300 lines and 36 headings down to h4. Tests a deep table of contents, scrolling, and long-form reading. Also carries `lastUpdated`, so the footer shows a "last updated" line |
| **Landing** | `/` | **`splash`** | A `splash` page (the other is 404): no sidebars, no TOC, a `hero` (title, tagline, image, action buttons). This is where the hero controls show |
| **404** | `/404/` | `splash` | Starlight's built-in not-found page (a `splash` page with a hero), since the demo site has no custom `404.md` |

Only **Landing** and **404** use the `splash` template; **Style guide** and **Document** use `doc`.

**Article** (`/resources/changelog/`), **Short doc** (`/guides/getting-started/`) and **Reference** (`/reference/manifest/`) were dropped from the switcher - all three share Document's `template: doc` layout, so they added length/frontmatter/sidebar variety but no new page shape to check a theme against. They're still in the demo site, reachable through its own sidebar; visiting one shows the switcher's existing "Other: /path/" state.

### Inspect (click an element to reach its controls)

Toggle it from the toolbar's **Inspect** button, or press **`I`** (ignored while a text field has focus); **`Esc`** turns it off and clears every outline. While on, hovering an element on the previewed page draws a solid ring around the innermost element that matches any control's `target`, and a dashed ring around every other element sharing that scope, with a small "Group › Section" tag near the pointer. Clicking it opens that group in the panel (without scrolling the page), expands every section holding one of its controls, and lists them in an "Inspecting: …" chip. The **Elements** button beside it lists every surface present on the current page, grouped, as a keyboard-reachable alternative to hovering. Works in either Split lane and survives in-frame navigation. See `src/customizer/ui/inspect.js`.

### Undo/redo and keyboard shortcuts

`Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redoes, `Ctrl/Cmd+E` opens Export - all ignored while a text field has focus, including inside the panel's shadow root. A slider drag, a preset apply, a group reset, "Reset all", an import, and a Structure (advanced) edit (move/indent/delete/drag-drop/rename/...) are each one undo step; a hex field commit is also exactly one step (typing + Enter, then clicking elsewhere, must not silently record a second, slightly different step from whatever color the field happens to be displaying at that moment - `core/history.js` coalesces by a stable key, and every hex field's blur handler is a no-op unless its own text actually changed since the last commit). A typed Structure rename gets the identical treatment: `input`/`change` share one coalescing key per item, and panel.js drops a `change` that would otherwise re-record an unchanged tree.

**Everything the panel does - theming, TOC-level stamping, sidebar re-render, "follow on page" highlighting, tile samples, light/dark, Inspect - operates on the frame's document(s)**, not the studio's own host document, via one indirection (`getPageDoc()`/`getPageWin()`/`getPageDocs()` in `src/customizer/ui/page-doc.js`). Re-attaching on every frame navigation is idempotent per document and never resets panel state or scroll.

**Outside the studio** (a direct visit to any page other than `/`, or "open in new tab"), a page shows exactly what a visitor would see with your saved theme applied, plus a small **Open in Studio** button in the corner. B's overlay panel is retired from C's interface; it still mounts only when the URL carries `?svc-overlay`, which the engine test suites (`smoke`, `ui-round2`, `treatments`, `targets`, `tiles`) use.

Known gap: tile samples are built once, from the primary lane's first ready page (normally the Style guide), not rebuilt on later navigation - matching B's existing behavior.

## Ports

| Project | Dev server (hot reload) | Production preview |
|---|---|---|
| This app | **4700** | **4420** |

Each port is its own browser origin, so the dev server and the preview keep separate saved settings.

## Two ways to run

| | Dev server | Production preview |
|---|---|---|
| Serves | Source files, with hot reload | The built `dist/` folder |
| Start in background | `npm run dev:bg` | `npm run build` then `npm run preview:bg` |
| Start in foreground (Ctrl+C stops) | `npm run dev` | `npm run preview` |
| Status / stop / logs | `npm run dev:status` / `dev:stop` / `dev:logs` | `npm run preview:status` / `preview:stop` / `preview:logs` |
| Picks up code edits | Immediately | After `npm run build` (then refresh; no restart needed) |
| Use it for | Editing the customizer | Checking the real thing; running the e2e tests |

Background mode (Astro 7.2+) is per folder: `status`, `stop`, and `logs` act on the server started from this folder, tracked in `.astro/dev.json` / `.astro/preview.json`. Starting twice reports the running server instead of launching a duplicate.

### If stop doesn't work

```powershell
Get-NetTCPConnection -LocalPort 4420 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

## Serving under a sub-path

By default the app builds and runs at `/` (this README's own commands above, unchanged). The app
can also be served under a sub-path instead - for example a GitHub Pages **project** site at
`https://<user>.github.io/<repo>/`, or any fork's `https://<user>.github.io/<repo>/` - without
touching root behavior at all.

Two build-time env vars, both read only in `astro.config.mjs`:

| Var | Default | Meaning |
|---|---|---|
| `SVC_SITE_BASE` | `/` | The base path to deploy under. Include the trailing slash (e.g. `/astro-starlight-visual-customizer/`) - Astro's own `trailingSlash` config (left at its default here) then keeps that slash on `import.meta.env.BASE_URL` too. |
| `SVC_SITE_URL` | unset | Optional: the deployed origin (e.g. `https://prisant-labs.github.io`), for canonical URLs/sitemaps only. Internal navigation never depends on it. |

**Never** set a plain `BASE_URL` when building this app - it is a different, unrelated name (a
previous builder found it silently turns `astro build`'s internal links absolute if it leaks in
from a parent shell) that `astro.config.mjs` never reads.

```powershell
npm run preview:stop   # if the default-base preview from above is still running in this folder
$env:SVC_SITE_BASE = '/astro-starlight-visual-customizer/'
npx astro build
npx astro preview --port 4420   # SVC_SITE_BASE must stay set through this too - astro preview
                                 # re-reads astro.config.mjs, so unsetting it first serves dist/
                                 # (built with every href under the sub-path) back at plain `/`
Remove-Item Env:SVC_SITE_BASE
```

In Git Bash (not PowerShell), prefix both the build and the preview command with
`MSYS_NO_PATHCONV=1` - MSYS otherwise rewrites a leading-slash value like `SVC_SITE_BASE` into a
Windows path (`/astro-starlight-visual-customizer/` becomes `C:/Program Files/Git/astro-starlight-visual-customizer/`,
which breaks the build), e.g.
`MSYS_NO_PATHCONV=1 SVC_SITE_BASE=/astro-starlight-visual-customizer/ npx astro build` and, since
`astro preview` re-reads `astro.config.mjs` too,
`MSYS_NO_PATHCONV=1 SVC_SITE_BASE=/astro-starlight-visual-customizer/ npx astro preview --port 4420`.

Open `http://localhost:4420/astro-starlight-visual-customizer/` - it redirects to the studio at
that same base, exactly as `/` does at the default base. Rebuild at the default base afterward
(`npm run preview:stop` first, then plain `npm run build`, no env var) before committing `dist/` to
anything that expects root.

Every internal URL the customizer builds at runtime - the studio's page tabs and frame navigation,
"Open in Studio", the sidebar re-render after a Structure edit - goes through one helper,
`src/customizer/core/base-path.js`'s `withBase()`/`stripBase()`, built on Astro's resolved
`import.meta.env.BASE_URL`. The studio's own `?page=` query value and its
`sessionStorage['svc-ui']` state stay base-free by design, so a saved link, a share screenshot, or
a bookmark look identical at any base. Demo content's own hand-written links (`specimen.mdx`,
`kitchen-sink.mdx`, `index.mdx`'s hero actions, a couple of `prev`/`next` frontmatter overrides)
are relative instead, since Starlight does not base-prefix a hand-written Markdown/frontmatter
link the way it does its own sidebar/pagination.

### Running the e2e suites against a sub-path build

The browser suites take the app's full origin **and** base together in one env var,
`SVC_BASE_URL` (renamed from `BASE_URL` - no fallback to the old name; see "Tests" below):

```powershell
$env:SVC_BASE_URL = 'http://localhost:4420/astro-starlight-visual-customizer'
npm run test:e2e
Remove-Item Env:SVC_BASE_URL
```

No trailing slash on `SVC_BASE_URL` - every suite joins it with a leading-slash path
(`` `${SVC_BASE_URL}/studio/` ``), so one would double up (`...customizer//studio/`).

`tests/roundtrip` reads the SAME var name for a DIFFERENT, narrower purpose - "the app's own
preview origin to compare a themed export against" (see the Tests table below), never a base path,
because that suite always builds its own throwaway comparison site at `/` and only ever runs
against a root build of the app itself. Point it at a plain origin with no base suffix
(`$env:SVC_BASE_URL = 'http://localhost:4420'`) when running `npm run test:roundtrip` - don't reuse
whatever value it was carrying for the e2e suites' sub-path run above.

## Tests

| Command | What it covers | Needs a running server |
|---|---|---|
| `npm test` | 193 unit tests: CSS emitter (golden files), manifest, state (including decoding a pre-upgrade `starlight: '0.42.3'` state), color, sidebar IA parser, `APPLY-THEME.md` emitter (including the site title config line), `core/history.js`'s undo/redo stack, `core/base-path.js`'s `withBase`/`stripBase` (both trailing-slash shapes of `import.meta.env.BASE_URL` - see "Serving under a sub-path" below), and a guard that `core/version.js`'s `STARLIGHT_VERSION` matches the installed `@astrojs/starlight` | No |
| `npm run test:e2e` | 9 browser suites, real mouse/keyboard throughout (see below) | Yes, the **production preview on 4420** by default |
| `npm run test:roundtrip` | Applies an exported `theme.css` + `APPLY-THEME.md` to a real, freshly-scaffolded Starlight site and compares it against the live preview - proves the export/preview promise holds outside the studio, not just inside it (see `tests/roundtrip/README.md`) | Yes, the app's own production preview (`SVC_BASE_URL`, default 4420, a root-only origin with no base suffix - see "Serving under a sub-path" above); it starts/stops its own fresh-site preview on 4431 |

The 9 e2e suites, run one at a time in this order (`smoke && ui-round2 && treatments && targets && tiles && studio && shell && inspect && editors`):

| Suite | Covers | Checks |
|---|---|---|
| `smoke.mjs` | Panel mounts; a control and a preset visibly recolor the page; an IA rename persists | 11 |
| `ui-round2.mjs` | No-flash preload CSS; the filter; the overlay's Navigation tree (unchanged); panel UI state persisting across navigation; "follow on page" | 22 |
| `treatments.mjs` | Every treatment control's computed-style effect, light + dark | 129 |
| `targets.mjs` | Every control's `target` selector resolves on a real page | 78 |
| `tiles.mjs` | Every tiled control's grid/rows layout and per-option visual distinctness; SPEC-C P5 (every tile is one column at the panel's real width) and P6 (no more than ~12px of empty space below a sample's last content) | 264 |
| `studio.mjs` | Frame targeting, in-frame navigation, page switcher, device widths, follow-on-page, light/dark, tiles, export, F3 (re-clicking the already-selected rail item no longer collapses the panel; the collapse button and `\` still do) - studio-shape equivalents of B's own checks | 59 |
| `shell.mjs` | The rail (including a dedicated F3 regression check: re-click stays open, the collapse button and `\` still collapse/reopen), the A4 contrast walk (chrome text, panel, dialogs, Colors' hex fields, the popover, the Structure tree/form and its enlarged toolbar), the hit-test audit, undo/redo, group reset, status bar, Split, scaling, the narrow-width drawer; SPEC-C P2 (a pixel check that every range thumb is centered on its track), P4 (every section/card starts open, card collapse/expand, Expand all/Collapse all, the section/card/band contrast levels) | 104 |
| `inspect.mjs` | Toggle by button and `I`; hover outlines; click-to-select scope + panel state; the Elements list; Split lanes; `Esc` | 32 |
| `editors.mjs` | Hex entry (including the exact undo-after-blur bug repro, for an accent slider and a role override), hex-field freshness after undo/redo/preset/group-reset/reset-all/import, preset card previews (SPEC-C P1: one column, no body-text description), the structure tree's drag-and-drop and toolbar, `APPLY-THEME.md` reflecting a reorder, the site title, SPEC-C P3's hex-first color popover (open, hex-field commit, a real hue-bar drag coalescing into one undo step, Escape/outside-click close), the coordinator's Structure-undo bug fix (preset + reorder + Undo/Redo repro, a rename, its no-op guard under a long pause, a toolbar move/indent/delete, an edit after Undo), and Sa's drag insertion marker (before/after/into-group geometry, Escape-cancel) | 116 |

(815 checks total, 0 failures, confirmed via `npm run test:e2e` end to end. `treatments.mjs`/`tiles.mjs`/`targets.mjs` counts reflect this worktree's current state as observed, not changes made here.)

Against the dev server instead:

```powershell
$env:SVC_BASE_URL = 'http://localhost:4700'; npm run test:e2e; Remove-Item Env:SVC_BASE_URL
```

The browser suites use `playwright-core` with the Chromium build it expects (install it once with `npx playwright install chromium`); set `SVC_CHROME_PATH` to use another Chromium or Chrome. Every suite drives real `page.mouse.click`/`down`/`move`/`up` and `page.keyboard.type` at element centers - never a script-dispatched `.click()` - because a prior round shipped an unclickable rail that only script clicks had exercised, and this round's own hex-entry bug only reproduced under a real click (it blurs the field; a script-invoked undo never does).

## What's different from A

```
src/customizer/ui/tiles/
  index.js        decides, per select control, tiles vs dropdown and which renderer; also owns
                  computeTileLayout, the grid-vs-rows rule every tiled control's data-layout comes from
  tile-grid.js    the tile widget: native radio group, one tile per option (caption + check glyph
                  above an inert preview), in a 2-column grid or full-width rows
  page-styles.js  clones the page's stylesheets into each grid's own shadow root so real Starlight
                  styles apply to the samples
  samples.js      live-sample markup per control (cloned from the page where Starlight scopes styles
                  to its components, hand-built where its styles are global); SAMPLE_INTENDED_HEIGHT
                  is the measured aspect data computeTileLayout reads
  scope-css.js    rewrites each option's CSS so it only matches inside its own tile
  wireframes.js   layout-diagram tiles for the alignment controls; WIREFRAME_SIZE is each one's own
                  canvas size (wide crops for the four rows-layout diagrams, page-chrome mockups
                  for the rest)
  fonts.js        font list (faces load only when Typography is opened)
```

`src/customizer/ui/controls.js`'s `COLOR_ASSIST` map (parallel to `samples.js`'s sample data - UI-only metadata, not a manifest schema change) drives the gradient tracks, live swatches, hex field, and color picker on the Colors group's hue/chroma sliders and every `color.role.*` override; `src/customizer/core/color.js`'s `hexToOklchHueChroma`/`hexToHslHue` do the hex-to-hue(+chroma) conversion. `src/customizer/ui/color-picker.js` (SPEC-C P3) is the hex-first popover itself - a small wrapper around vanilla-colorful's `<hex-color-picker>` plus our own hex field/eyedropper button, imported only from `controls.js` (its side-effecting `customElements.define` import must never reach the Node-run test suites). `src/customizer/ui/ia-editor.js` exports two builders off one dispatcher - `createOverlayTreeEditor` (B's original DOM shape, still byte-identical; its label-input handlers got the same undo-coalescing-key touch `createStudioTreeEditor`'s did, fixing the Structure-undo bug for overlay mode too) and `createStudioTreeEditor` (the Codex-shaped restyle, plus its own drag insertion marker and Escape-cancel) - chosen once at panel-mount time by whether the page is in studio or overlay mode.


Known weakness: the header "Default border" and "No border" tiles are hard to tell apart, because Starlight's real border is a faint 1px line. The tiles show it truthfully rather than exaggerating it.

## History

Before it moved into this repository, the customizer was developed as three local prototypes: Variation A (an overlay panel over a real Starlight site), Variation B (A plus visual option tiles and a docked studio) and Variation C (B's engine in a full studio layout, plus Inspect, hex-first color entry and preset previews). This folder is Variation C, imported as one clean commit from its local tag `variation-c-v3.3` (Starlight 0.42.4, Astro 7.3.5). The prototypes' own commit history stays outside this repository. Comments in the source that mention "SPEC-C" or workstream letters refer to that prototype's internal build contract.
