# Starlight Visual Customizer

A full-viewport **studio** for theming an [Astro Starlight](https://starlight.astro.build/) docs
site: a top bar, a left icon rail, a toolbar, and a status bar, driven by a real Starlight build
(real iframe rendering of your own pages, manifest-driven controls, tiled option previews, color
assists) and exporting `theme.css` + `APPLY-THEME.md`.

- **Tiles:** 19+ controls, always ONE column at the panel's real width. Component styles (sidebar, TOC, callouts, inline code, links, tables, tabs, header, search box, pagination) render real Starlight elements in your current colors and recolor live, trimmed to the least content that still shows the difference between options; alignment controls render small layout diagrams; fonts are a list with each name set in its own font. Contrast level and code theme stay dropdowns (nothing to picture / build-time only). Clicking anywhere on a tile selects it - the caption (label + a check glyph when selected) sits above the preview, and the preview itself is `inert` so a cloned page control inside it can never intercept the click. Grid vs. rows is a rule, not a per-control choice (`src/customizer/ui/tiles/index.js`'s `computeTileLayout`).
- **Collapsible sections and cards:** inside a group, each manifest `section` is its own disclosure, and each control is further collapsible on its own - both start OPEN by default, remembered per group/section/control in `sessionStorage['svc-ui']`. A dot on a collapsed section's header means a control inside it is non-default; a collapsed card shows its current value on its own header line (e.g. "720 px", a color chip + hex, "On"). The group header's **Expand all** / **Collapse all** buttons act on both levels - Collapse all first collapses every card, then (pressed again) the sections too; Expand all opens both at once.
- **Color controls, hex-first:** hue and chroma stay sliders (Starlight's whole palette - and its five semantic hues - is a hue/chroma pair run through the official designer's algorithm, which tunes lightness per role for readability), but every one now also gets a **hex text field as the primary editor** beside a live gradient track, live swatches, and a **hex-first popover picker** (vanilla-colorful's saturation/hue picker plus its own fields and an eyedropper button when the browser supports it - Chrome's own native picker dialog can't be forced into hex mode, so it's gone). A **HEX | RGB | HSL** switch above the popover's fields brings back the format choice that dialog had: hex by default, RGB and HSL as three whole-number boxes each, and the last format picked is remembered in this browser (`localStorage['svc-color-format']`). One consistent layout throughout: the slider row, then a hex+picker row, then the swatch strip, then the note/help. Typing a hex and pressing Enter (or blurring the field, in the row or in the popover) back-solves hue (and, for accent/gray, chroma) as **one** undo step, snapped to each control's own slider step (whole degrees, chroma in 0.005 or 0.001 steps) so the number box never shows a raw float; a drag inside the popover coalesces into one step too. Starlight's own per-role lightness tuning means the field then shows the color actually *produced*, with a short note when it differs from what you typed. A blur that doesn't change the field's text is always a no-op - it never re-solves from whatever the field happens to be displaying.
- **Role overrides (`color.role.*`):** the same hex field, plus one clear affordance - a small muted **"Auto"** tag when the role is following the generated palette, or a **✕ "Follow the palette"** button once it's overridden (never both, and no separate reset arrow duplicating the same idea).
- **Preset cards:** one column. Each card shows an anchor chip in the preset's accent color, then the preset's name over a seven-swatch strip drawn from its own light palette (accent-low, accent, accent-high, then four grays); the description lives only in the card's tooltip. The selected card gets an accent border and a check.
- **Structure (advanced):** the sidebar-IA editor - folder/page icons, indentation guides, a note that this exports as configuration (`APPLY-THEME.md`), "+ Page"/"+ Group", drag-and-drop (a pointer-based custom drag, not the HTML5 `draggable` API - Chromium's native drag-and-drop hangs headless test runs the instant a drag starts), and a move/outdent/indent/delete toolbar (28px targets, tooltips naming each action) beneath a "Selected item" form. While dragging, a clear insertion marker shows where the drop will land - a line between rows for before/after, an outline + tint on a group row for a drop into it - and `Esc` cancels the drag with no structure change and no undo step. Every structural edit (move/indent/delete/drag-drop/rename/...) is its own undo step (a typed rename coalesces into one step, like a slider drag).
- **Site title:** a text control (Header group, "Site title" section, build-tier) that renames `.site-title` live in the preview and tells `APPLY-THEME.md` to set Starlight's own `title` config option.
- **Pinned:** `@astrojs/starlight` 0.42.4, Astro 7.3.5, Node 22, `vanilla-colorful` 0.7.2 (the color popover).

## Quick start (PowerShell)

```powershell
cd app
npm install            # first time only
npm run build           # build the site into dist/
npm run preview:bg      # serve dist/ in the background on http://localhost:4420
```

Open <http://localhost:4420/> for the product page, or <http://localhost:4420/studio/> for the studio itself (see below), which shows the Style guide page (`/demo/specimen/`) by default.

**Where things live.** The product page is at `/`, the studio at `/studio/`, and the About page at `/about/`. Every page of the demo site ("Orbit Docs") lives under `/demo/`, because its content sits in `src/content/docs/demo/`. Starlight's built-in 404 page stays at `/404/`. The Starlight sidebar gets its `demo/` prefix in `astro.config.mjs` through `src/demo-site.mjs`, while `src/fixture-sidebar.mjs` stays prefix-free, because the Structure editor exports that tree into users' own sites. `src/route-data.js` points the demo's header title link at `/demo/` instead of the site root.

**Stop it:** `npm run preview:stop`

## The studio (`/studio/`)

The customizer's main entry point: a full-viewport app shell, chrome always light (`--ui-*` tokens, independent of the preview's own light/dark mode). Top to bottom/left to right:

- **Top bar** - on the left, the brand ("Starlight Visual Customizer"), the theme name (editable, `state.meta.name`), undo and redo, and the change count as plain text ("24 changes"; its tooltip says "from Starlight default"). The count comes after undo and redo, so a change in its number of digits never moves them. On the right, About (an info button that opens the About dialog), a labeled GitHub pill (the repo, in a new tab), Import, and Export (primary). Saving needs no message, so nothing shows while it works; if storage is blocked, "Not saved (storage blocked)" appears in amber right after the theme name. As the window narrows, the bar sheds text rather than controls: below 900px the brand name, below 720px the change count, the GitHub/Import/Export labels and the separators (the failure text shortens to "Not saved" but stays), below 480px part of the theme name's width.
- **Rail** (72px, left) - one icon per manifest group plus "Structure (advanced)", in `core/manifest.js`'s own order with separators between clusters. A `tablist`; the selected item gets a solid accent fill + a 3px inner-edge bar; a dot marks a group with any non-default control. Selecting most groups scrolls the preview to that group's first visible `target` - not Presets, Colors, Typography, Page options, or Structure. Clicking the already-selected item re-selects the group like any other rail click, so it re-scrolls to the group's target the same as a fresh selection does; the panel column stays open. Collapsing the panel column (more room for the preview) happens only via the collapse button in the panel header or the `\` key; any rail item click reopens a collapsed panel. At the bottom of the rail, **Studio sizing** (minus, the percentage, plus) zooms the studio's own chrome - the top bar, the page toolbar, the context line, the rail and the panel with its dialogs - from 80% to 120% with CSS `zoom`. The preview is never zoomed; it simply gains or loses room (at 90% in a 1440px window the page toolbar fits on one row again). The choice is kept in `localStorage` (`svc-studio-sizing`), and a head script in `studio.astro` applies it before the first paint. In a window narrower than 900px, sizes above 100% are capped and "Larger studio" is disabled, because the narrow layout has no room to spare; widening the window restores the stored size. Code that places something by measured screen position inside the zoomed panel (the color popover, the target-highlight box, the Structure drop line) divides by the zoom; `src/customizer/ui/studio-sizing.js` explains why.
- **Panel column** (340px, beside the rail) - a control filter, an eyebrow/title/description/reset-group header, then that group's sections/controls (collapsible sub-sections, tiles, color gradient tracks, hex fields, swatches, picker, the WCAG contrast readout). `rem`-unit controls show/accept px in the number field with a secondary rem readout; `px`-unit controls (except radius/shadow) show a secondary rem readout - the slider always stays in the control's own stored unit.
- **Toolbar** - four page-switcher tabs (Style guide default, Document, Landing, 404 - see below); a **Light | Dark | Split** segmented control (Split shows two lanes, forced light/dark, sharing one state); a device control (**Fit | Laptop 1280 | Desktop 1440 | Wide 1920 | Ultra-wide 2560 | Tablet 820 | Mobile 390**) and a **zoom** control (minus, the percentage, plus, **Fit**; 25 to 150 percent; above fit the lane pans sideways, the page itself still scrolls vertically); an **Inspect** toggle and its **Elements** list (see below); "open in new tab" (the page as a visitor sees it, see below). Scaling uses `transform`, and no host ancestor of a preview frame can scroll (`overflow: clip`), so scrolling the page to a control's target never shifts or clips the frame.
- **Context line** - a breadcrumb for the frame's current page on the left. On the right, the contrast check (green "Contrast AA" when every text pair passes WCAG AA in both light and dark, computed from the palette actually in effect; amber "N contrast warnings" otherwise; a click opens the full contrast table), then "Real Starlight 0.42.4 build · CSS live" and the scale label.

Below 900px wide the panel column becomes a drawer over the workarea, toggled from the top bar; the rail stays visible.

## The product page (`/`)

`src/pages/index.astro` explains the tool and links to the studio, the About page, and the repo. Four tabs swap a screenshot of the studio between presets, and a strip below shows one color chip per preset. The chips, the preset count in the strip's heading, and the tab dots are computed at build time from `core/presets.js` through `getPresetLightPalette` in `core/color.js`, the function the studio's preset cards use, so they follow any preset change. The screenshots do not: they are PNG files in `src/assets/home/`, which Astro converts to WebP at three widths, so recapture them when the studio's look changes. The logo is `public/logo.svg`, a work-in-progress mark that the branding work may replace.

A root link that carries a shared theme (`/#svc=...`) still opens it: an inline script in the page's head forwards such a link to `/studio/`, with its query string and hash, before the page paints. The page sets its text in Inter, self-hosted from the `@fontsource-variable/inter` package: Astro bundles the font files into the build, and only this page's stylesheet loads them. No font comes from Google Fonts or any other host, because the About page tells visitors that the only third-party requests are web-font previews from jsDelivr. It keeps `noindex` until launch, like every other page.

### About (dialog and `/about/`)

The prose lives in `src/about/about.md`; edit that file to change it. `src/about/AboutBody.astro` adds the facts line under it (the Starlight version, the repo and hub links), and both places that show it render that one component at build time:

- **The About dialog** - the top bar's info button opens it in the studio as a native modal `<dialog>` (`src/pages/studio.astro`). Escape, the close button, and a click on the backdrop close it; its external links open in a new tab; the studio's keyboard shortcuts (and Inspect's `I`/Escape) stand down while it is open.
- **The `/about/` page** - the same text as a standalone page, for direct links and sharing (`src/pages/about.astro`), with base-aware "Open the studio" links. It is deliberately not a Starlight content page: a page in `src/content/docs/` would join the demo site, pick up the visitor's current theme preview through the no-flash preload, and appear in the demo site's sidebar and search.

The repo and hub URLs live in one module, `src/customizer/core/project.js`.

### Export and import

- **Export** (top bar, or `Ctrl/Cmd+E`) opens a dialog listing `theme.css`, `APPLY-THEME.md` and the state file, each with Copy and Download, plus **Download all (.zip)** (all three in one zip named after the theme, via `fflate`) and **Copy share link** (the whole theme in the URL, plus `?page=` for the page being viewed; no other query parameter travels with it). The dialog also carries a short privacy note ("Your theme stays in your browser; web fonts load from jsDelivr").
- **Screenshot (PNG)** in the same dialog captures the previewed page at its real width in its current light or dark mode: **Full page** (the whole scroll height; accurate) or **Visible area** (what the frame shows now, including a scrolled position - the fixed header, left sidebar with its own scroll position, and right "On this page" TOC all reproduce their real on-screen spot, and the theme/language `<select>`s show their current value). It draws the page into an image in the browser (`modern-screenshot`, loaded only when used), so it has limits: large pages such as Document take 30 seconds or more; effects like `backdrop-filter` may be missing. For a pixel-exact image, use the browser's own screenshot tool.
- **Import** (top bar) loads a state file exported earlier. It is one undo step.
- **Opening a share link** (`#svc=...`) applies its theme directly when nothing worth keeping is saved in the browser: nothing, the defaults a first visit saves, or the same theme. When the link's theme differs from a theme you saved, the studio keeps yours and asks **Open the shared theme?**; Keep my theme (which has focus), Escape and a backdrop click all keep it, and Open shared theme is one undo step. A link that cannot be read (usually cut off in transit) keeps the saved theme and says the link is damaged. The rules are in `src/customizer/core/share-link.js`. The customizer removes the hash from the address once it has read it, so a reload never brings back a stale link's theme over your later edits; share with **Copy share link** rather than the address bar. A link can carry a sidebar structure, so sidebar links keep only relative, `http`, `https` and `mailto` targets (anything else, such as `javascript:`, becomes `#`), and their `attrs` lose event handlers, both in the preview and in the exported config (`safeLinkHref` and `safeLinkAttrs` in `src/customizer/core/ia.js`).

### How an export is applied

`APPLY-THEME.md` is generated per theme (`src/customizer/core/emit-apply.js`) as a deterministic,
idempotent set of steps for a target Starlight site:

1. Copy the exported `theme.css` to `src/styles/` in the target repo.
2. In `astro.config.mjs`'s `starlight({ ... })` options, add (or keep, and append) a `customCss`
   array entry pointing at that file - **as the last entry**, so this theme's intentionally
   unlayered CSS wins any tie with another stylesheet on the same selector.
3. If the theme uses any non-default web font, `npm install` the matching
   `@fontsource-variable/<font>` package(s) and add their CSS imports.
4. Rebuild (`astro build` or restart `astro dev`).

The `tests/roundtrip` suite (see "Tests" below) proves this actually reproduces the studio's live
preview by applying a real export to a freshly-scaffolded Starlight site and diffing computed
styles against the studio - not just trusting that the instructions read correctly.

### The page switcher, in Starlight's own terms

The toolbar's four tabs are **pages of the demo site**, chosen because each exercises something different. Starlight has no per-page "layouts" or "templates" you design yourself: every page is a Markdown or MDX file in `src/content/docs/`, and one shared layout renders all of them. Pages differ in three ways only:

- **The `template` frontmatter field:** `doc` (the default: header, left sidebar, content, table of contents on the right) or `splash` (a wide page without sidebars, usually with a `hero`).
- **Per-page frontmatter options:** for example `hero`, `banner`, `tableOfContents`, `prev`/`next`, `lastUpdated`, `sidebar` (label, order, badge), `pagefind`, `editUrl`.
- **Their content:** length, heading depth, which components they use.

| Tab | URL | Template | What makes it different |
|---|---|---|---|
| **Style guide** (the file is `demo/specimen.mdx`) | `/demo/specimen/` | `doc` | One short instance of every themeable element: type scale, links, inline code, lists, callouts, a table, code blocks, tabs, steps, file tree, cards, link buttons, badges. Also has a `banner`, custom `prev`/`next`, and a TOC set to levels 2 to 4. The default, because it shows the most controls at once |
| **Document** (the file is `demo/guides/kitchen-sink.mdx`) | `/demo/guides/kitchen-sink/` | `doc` | The same kinds of content at full length: about 300 lines and 36 headings down to h4. Tests a deep table of contents, scrolling, and long-form reading. Also carries `lastUpdated`, so the footer shows a "last updated" line |
| **Landing** (the file is `demo/index.mdx`) | `/demo/` | **`splash`** | A `splash` page (the other is 404): no sidebars, no TOC, a `hero` (title, tagline, image, action buttons). This is where the hero controls show |
| **404** | `/404/` | `splash` | Starlight's built-in not-found page (a `splash` page with a hero), since the demo site has no custom `404.md` |

Only **Landing** and **404** use the `splash` template; **Style guide** and **Document** use `doc`.

**Article** (`/demo/resources/changelog/`), **Short doc** (`/demo/guides/getting-started/`) and **Reference** (`/demo/reference/manifest/`) aren't in the switcher - all three share Document's `template: doc` layout, so they add length/frontmatter/sidebar variety but no new page shape to check a theme against. They're still in the demo site, reachable through its own sidebar; visiting one shows the switcher's existing "Other: /path/" state.

### Inspect (click an element to reach its controls)

Toggle it from the toolbar's **Inspect** button, or press **`I`** (ignored while a text field has focus); **`Esc`** turns it off and clears every outline. While on, hovering an element on the previewed page draws a solid ring around the innermost element that matches any control's `target`, and a dashed ring around every other element sharing that scope, with a small "Group › Section" tag near the pointer. Clicking it opens that group in the panel (without scrolling the page), expands every section holding one of its controls, and lists them in an "Inspecting: …" chip. The **Elements** button beside it lists every surface present on the current page, grouped, as a keyboard-reachable alternative to hovering. Works in either Split lane and survives in-frame navigation. See `src/customizer/ui/inspect.js`.

### Undo/redo and keyboard shortcuts

`Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redoes, `Ctrl/Cmd+E` opens Export - all ignored while a text field has focus, including inside the panel's shadow root. A slider drag, a preset apply, a group reset, "Reset all", an import, and a Structure (advanced) edit (move/indent/delete/drag-drop/rename/...) are each one undo step; a hex field commit is also exactly one step (typing + Enter, then clicking elsewhere, must not silently record a second, slightly different step from whatever color the field happens to be displaying at that moment - `core/history.js` coalesces by a stable key, and every hex field's blur handler is a no-op unless its own text actually changed since the last commit). A typed Structure rename gets the identical treatment: `input`/`change` share one coalescing key per item.

**Everything the panel does - theming, TOC-level stamping, sidebar re-render, "follow on page" highlighting, tile samples, light/dark, Inspect - operates on the frame's document(s)**, not the studio's own host document, via one indirection (`getPageDoc()`/`getPageWin()`/`getPageDocs()` in `src/customizer/ui/page-doc.js`). Re-attaching on every frame navigation is idempotent per document and never resets panel state or scroll.

**Outside the studio** (a direct visit to any page other than `/`, or "open in new tab"), a page shows exactly what a visitor would see with your saved theme applied, plus a small **Open in Studio** button in the corner. An older overlay-style panel also still mounts, but only when the URL carries `?svc-overlay`, which the engine test suites (`smoke`, `ui-round2`, `treatments`, `targets`, `tiles`) use.

Known gap: tile samples are built once, from the primary lane's first ready page (normally the Style guide), not rebuilt on later navigation.

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
| `SVC_SITE_BASE` | `/` | The base path to deploy under. Include the trailing slash (e.g. `/starlight-visual-customizer/`) - Astro's own `trailingSlash` config (left at its default here) then keeps that slash on `import.meta.env.BASE_URL` too. |
| `SVC_SITE_URL` | unset | Optional: the deployed origin (e.g. `https://projects.prisantlabs.com`), for canonical URLs/sitemaps only. Internal navigation never depends on it. |

**Never** set a plain `BASE_URL` when building this app - it is a different, unrelated name (it
silently turns `astro build`'s internal links absolute if it leaks in from a parent shell) that
`astro.config.mjs` never reads.

```powershell
npm run preview:stop   # if the default-base preview from above is still running in this folder
$env:SVC_SITE_BASE = '/starlight-visual-customizer/'
npx astro build
npx astro preview --port 4420   # SVC_SITE_BASE must stay set through this too - astro preview
                                 # re-reads astro.config.mjs, so unsetting it first serves dist/
                                 # (built with every href under the sub-path) back at plain `/`
Remove-Item Env:SVC_SITE_BASE
```

In Git Bash (not PowerShell), prefix both the build and the preview command with
`MSYS_NO_PATHCONV=1` - MSYS otherwise rewrites a leading-slash value like `SVC_SITE_BASE` into a
Windows path (`/starlight-visual-customizer/` becomes `C:/Program Files/Git/starlight-visual-customizer/`,
which breaks the build), e.g.
`MSYS_NO_PATHCONV=1 SVC_SITE_BASE=/starlight-visual-customizer/ npx astro build` and, since
`astro preview` re-reads `astro.config.mjs` too,
`MSYS_NO_PATHCONV=1 SVC_SITE_BASE=/starlight-visual-customizer/ npx astro preview --port 4420`.

Open `http://localhost:4420/starlight-visual-customizer/` - the product page, whose links point at
the studio and the About page under that same base, exactly as `/` does at the default base. Rebuild at the default base afterward
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

### The live deployment

`.github/workflows/deploy.yml` (at the repo root) builds this app on every merge to `main` that
touches `app/`, with `SVC_SITE_BASE=/starlight-visual-customizer/` and
`SVC_SITE_URL=https://projects.prisantlabs.com`, and deploys it to GitHub Pages. The site appears
at `https://projects.prisantlabs.com/starlight-visual-customizer/` because the org's own Pages site
(`prisant-labs/prisant-labs.github.io`) carries the custom domain `projects.prisantlabs.com`, and
GitHub serves every other Pages site in the org under that domain at `/<repo-name>/`. The base
must therefore equal this repo's name: renaming the repo means changing `SVC_SITE_BASE` (and the
workflow's `if:` guard) to match. The workflow's jobs run only in
`prisant-labs/starlight-visual-customizer`, so a fork deploys nothing until it changes that guard
and the two env values for its own address.

### Running the e2e suites against a sub-path build

The browser suites take the app's full origin **and** base together in one env var,
`SVC_BASE_URL`:

```powershell
$env:SVC_BASE_URL = 'http://localhost:4420/starlight-visual-customizer'
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
| `npm test` | 239 unit tests: CSS emitter (golden files), manifest, state (including decoding a pre-upgrade `starlight: '0.42.3'` state, the strict `tryDecodeState` and `sameTheme`, and `snapToStep`), `core/share-link.js`'s choice between a share link and the saved theme and its share-URL builder, the sidebar-link scheme and `attrs` filter, color (including the color popover's RGB/HSL conversions and each preset's own light palette), sidebar IA parser, `APPLY-THEME.md` emitter (including the site title config line), `core/history.js`'s undo/redo stack, `core/base-path.js`'s `withBase`/`stripBase` (both trailing-slash shapes of `import.meta.env.BASE_URL` - see "Serving under a sub-path" above), `core/sizing.js`'s Studio sizing steps and narrow-window cap, `src/demo-site.mjs`'s `demo/` prefix helpers (including a guard that `src/fixture-sidebar.mjs` stays prefix-free), and a guard that `core/version.js`'s `STARLIGHT_VERSION` matches the installed `@astrojs/starlight` | No |
| `npm run test:e2e` | 13 browser suites, real mouse/keyboard throughout (see below) | Yes, the **production preview on 4420** by default |
| `npm run test:roundtrip` | Applies an exported `theme.css` + `APPLY-THEME.md` to a real, freshly-scaffolded Starlight site and compares it against the live preview - proves the export/preview promise holds outside the studio, not just inside it (see `tests/roundtrip/README.md`) | Yes, the app's own production preview (`SVC_BASE_URL`, default 4420, a root-only origin with no base suffix - see "Serving under a sub-path" above); it starts/stops its own fresh-site preview on 4431 |

The 13 e2e suites, run one at a time in this order (`home && smoke && ui-round2 && treatments && targets && tiles && studio && shell && sizing && share && inspect && editors && screenshot`):

| Suite | Covers | Checks |
|---|---|---|
| `home.mjs` | The product page at `/`: it renders instead of forwarding, keeps `noindex`, makes no third-party request and loads its self-hosted Inter font, has base-aware links that reach a working studio, swaps screenshots on a real tab click, shows one chip per preset in `presets.js` order, has no horizontal scroll at 375px, and forwards a root link carrying `#svc=` (with `?page=`) to the studio, which applies the shared theme | 25 |
| `smoke.mjs` | Panel mounts; a control and a preset visibly recolor the page; an IA rename persists | 11 |
| `ui-round2.mjs` | No-flash preload CSS; the filter; the overlay's Navigation tree; panel UI state persisting across navigation; "follow on page" | 22 |
| `treatments.mjs` | Every treatment control's computed-style effect, light + dark | 129 |
| `targets.mjs` | Every control's `target` selector resolves on a real page | 78 |
| `tiles.mjs` | Every tiled control's grid/rows layout and per-option visual distinctness; that every tile is one column at the panel's real width, and that no tile leaves more than ~12px of empty space below its last content | 264 |
| `studio.mjs` | Frame targeting, in-frame navigation, page switcher, device widths, follow-on-page, light/dark, tiles, export, and that re-clicking the already-selected rail item never collapses the panel (the collapse button and `\` still do) | 60 |
| `shell.mjs` | The rail (including a dedicated regression check for the re-click behavior above), a full contrast walk (chrome text, panel, dialogs, Colors' hex fields, the popover, the Structure tree/form and its enlarged toolbar), the hit-test audit, undo/redo, group reset, the top bar's change count and the context line's contrast check (no bottom status bar), the save-failure text under blocked storage and its place after the theme name, undo and redo holding their position as the count grows, Split, scaling, the narrow-width drawer, a pixel check that every range thumb is centered on its track, that every section/card starts open with working collapse/expand and Expand all/Collapse all, the top bar's branding and GitHub pill, the About dialog (opened and closed by real clicks and keys, shortcuts standing down behind it) and the `/about/` page, and no top-bar overflow at five widths; the contrast walk also covers both shapes of the share-link dialog | 151 |
| `sizing.mjs` | Studio sizing: the control sits at the bottom of the rail, outside its tablist; the zoom reaches the top bar, toolbar, context line and panel but never the stage or the frames, and the preview gains room; the choice survives a reload; the end stops at 80% and 120%; the color popover opens under its swatch at 80% and 120%; the target-highlight box and the Structure drop line land on their targets at 90%; the Export dialog fits the viewport at 120% (1440px and 390px); under 900px a stored 120% is capped to 100% with "Larger studio" disabled, the drawer and top bar fit, and widening restores 120%; 90% still applies at 820px, where the drawer opens at its scaled width | 32 |
| `share.mjs` | Share links: "Copy share link" carries `?page=` and the theme, and the copied link opens both; a link opens directly with nothing saved, over saved defaults, and for the same theme, and the studio still drops the hash after reading it; a link that differs from saved work asks "Open the shared theme?" with the saved theme still showing, Keep focused, and Keep (surviving a reload), Escape, Open (applying and saving the shared theme, recoloring the preview) and Undo each checked; a damaged link keeps the saved theme (or shows the defaults) and says so; a root link forwards to the same question; a theme name carrying markup shows as text and runs nothing; a shared sidebar's `javascript:` links (plain, and hidden behind a space and a tab) render as `#` while an `https` link is kept | 39 |
| `inspect.mjs` | Toggle by button and `I`; hover outlines; click-to-select scope + panel state; the Elements list; Split lanes; `Esc` | 32 |
| `editors.mjs` | Hex entry (including an undo-after-blur regression repro, for an accent slider and a role override), hex-field freshness after undo/redo/preset/group-reset/reset-all/import, preset card previews (one column, no body-text description), the structure tree's drag-and-drop and toolbar, `APPLY-THEME.md` reflecting a reorder, the site title, the hex-first color popover (open, hex-field commit, a real hue-bar drag coalescing into one undo step, Escape/outside-click close), a Structure-undo regression repro (preset + reorder + Undo/Redo, a rename, its no-op guard under a long pause, a toolbar move/indent/delete, an edit after Undo), and the drag insertion marker's geometry (before/after/into-group, Escape-cancel) | 128 |
| `screenshot.mjs` | The Export dialog's PNG screenshot capture (Full page and Visible area, light and dark), decoded and diffed pixel-by-pixel against the live page | 54 |

Against the dev server instead:

```powershell
$env:SVC_BASE_URL = 'http://localhost:4700'; npm run test:e2e; Remove-Item Env:SVC_BASE_URL
```

The browser suites use `playwright-core` with the Chromium build it expects (install it once with `npx playwright install chromium`); set `SVC_CHROME_PATH` to use another Chromium or Chrome. Every suite drives real `page.mouse.click`/`down`/`move`/`up` and `page.keyboard.type` at element centers rather than script-dispatched `.click()` calls, because some interactions (a real click blurs a focused field; a script-invoked action does not) only reproduce correctly under a real click.

## Source layout notes

```
src/customizer/ui/tiles/
  index.js        decides, per select control, tiles vs dropdown and which renderer; also owns
                  computeTileLayout, the grid-vs-rows rule every tiled control's data-layout comes from
  tile-grid.js    the tile widget: native radio group, one tile per option (caption + check glyph
                  above an inert preview), in a 2-column grid or full-width rows
  page-styles.js  clones the page's stylesheets into each grid's own shadow root so real Starlight
                  styles apply to the samples
  samples.js      live-sample markup per control (cloned from the page where Starlight scopes styles
                  to its components, hand-built where its styles are global)
  scope-css.js    rewrites each option's CSS so it only matches inside its own tile
  wireframes.js   layout-diagram tiles for the alignment controls
  fonts.js        font list (faces load only when Typography is opened)
```

`src/customizer/ui/controls.js`'s `COLOR_ASSIST` map (parallel to `samples.js`'s sample data) drives the gradient tracks, live swatches, hex field, and color picker on the Colors group's hue/chroma sliders and every `color.role.*` override; `src/customizer/core/color.js`'s `hexToOklchHueChroma`/`hexToHslHue` do the hex-to-hue(+chroma) conversion. `src/customizer/ui/color-picker.js` is the hex-first popover itself - a small wrapper around vanilla-colorful's `<hex-color-picker>` plus our own hex field/eyedropper button, imported only from `controls.js` (its side-effecting `customElements.define` import must never reach the Node-run test suites). `src/customizer/ui/ia-editor.js` exports two builders off one dispatcher - `createOverlayTreeEditor` (the overlay panel's original tree DOM shape) and `createStudioTreeEditor` (the studio's own tree styling, plus its own drag insertion marker and Escape-cancel) - chosen once at panel-mount time by whether the page is in studio or overlay mode.

Known weakness: the header "Default border" and "No border" tiles are hard to tell apart, because Starlight's real border is a faint 1px line. The tiles show it truthfully rather than exaggerating it.

## License

MIT - see [`LICENSE`](../LICENSE) at the repository root. Third-party notices:
[`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
