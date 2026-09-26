# Export round-trip test

Proves that an exported `theme.css` + `APPLY-THEME.md`, applied to a real Starlight site,
reproduces what this app's own live preview shows. Unlike the other test suites, this one's
"target site" isn't the app itself - it's a second, independently-scaffolded `@astrojs/starlight`
project this suite builds for you (see "First run" below), because the whole point is to check the
export against something the studio's own preview approximations can't quietly cheat on.

## Running

```powershell
npm run build
npm run preview:bg
npm run test:roundtrip
```

`test:roundtrip` needs the app's own production preview already running (`SVC_BASE_URL`, default
`http://localhost:4420` - the port `npm run preview:bg` uses). Point it elsewhere with `$env:SVC_BASE_URL`:

```powershell
$env:SVC_BASE_URL = 'http://localhost:4422'; npm run test:roundtrip; Remove-Item Env:SVC_BASE_URL
```

It manages its OWN second server on **:4431** for the fresh site (start/stop are automatic - make
sure nothing else is already bound to that port).

## First run vs. later runs

**First run** (or after `SVC_ROUNDTRIP_FORCE_INSTALL=1`): scaffolds a fresh Starlight site under
an OS temp directory (default; override with `FRESH_SITE_DIR`) - copies this app's own demo content
(`src/content/docs/**`, `src/content.config.ts`, `tsconfig.json`, `src/fixture-sidebar.mjs`,
`src/assets/houston.webp`, `public/favicon.svg`) and a matching `astro.config.mjs` with the
customizer's own wiring stripped out (no studio route, no footer override, no preload/redirect head
scripts), pinned to this repo's own exact `astro`/`@astrojs/starlight`/`sharp` versions (read live
from `package.json`/`package-lock.json`, never hand-copied), then runs `npm install` there. **This
step needs network access** and is the slow part of a first run.

**Later runs** reuse that same directory (fixed default path, not re-randomized) and skip
`npm install` entirely as long as `node_modules/@astrojs/starlight` is already present - only the
demo content and config are re-copied (cheap, no network), so a later run picks up any content
change without a full reinstall.

**Duration:** roughly 60-120 seconds on a typical dev machine for a warm run (one `astro build` for
the control plus one per theme, ~16 browser navigations, `npm i` calls that are no-ops once font
packages are installed); a cold first run adds the time `npm install` takes on your connection.

## What it checks

- **Control:** the fresh site with no theme applied vs. the app with `localStorage` cleared (true
  stock Starlight), both `/specimen/` and `/guides/kitchen-sink/`, both light and dark. Must be 0
  mismatches before any theme is trusted.
- **Per theme** (`editorial-serif` preset, `high-contrast-mono` preset, and a hand-tuned theme: hex
  accent `#0f766e`, a `color.role.link` override, the `newsreader` web font, and three treatments
  across sidebar/header/asides): ~40 surfaces x properties, both pages, both light and dark, plus a
  `document.fonts.check(...)` confirmation that every chosen web font actually loaded on **both**
  sides (so a CDN hiccup on the app's side is never misread as an emitter bug).
- **Tolerances:** colors compared as rgb channel deltas <=2; px lengths <=0.5px; everything else
  (font-family, text-transform, border style, box-shadow, display, position...) exact after
  whitespace/quote normalization. Stated in `harness.mjs`'s `valuesMatch`.

## What it does NOT do

The "apply the export" step is a **fixed, scripted interpretation** of `APPLY-THEME.md` (copy
`theme.css`, idempotently ensure one `customCss` line as the LAST array entry, `npm i` the theme's
font packages, `npx astro build`) - not a literal read-and-follow by a coding agent with no
foreknowledge of this tool. A literal walkthrough, done by hand once per theme against a separate
fresh site, is what originally surfaced the instruction-clarity gaps `emit-apply.js` now closes
(see its own file header and the commits that fixed them); re-running this suite only proves this
one interpretation still reproduces the live preview, not that the instructions read unambiguously
to someone encountering them cold.

## What a failure means

- **Control fails (any mismatch):** something is broken in Starlight itself, in how this suite
  scaffolds the fresh site, or in how it seeds/reads the app's own stock state - not in the
  customizer. Fix this before trusting any theme result below it.
- **A theme fails and the mismatched surface's control was never touched by that theme:** likely
  the same bug class as the W1 finding this suite was written to catch - a `forPreview`
  approximation in `emit-css.js` firing for an untouched control (check `isExplicit` gating in
  `buildPreviewApprox`).
- **A theme fails and the mismatched surface's control WAS touched:** likely a real emitter bug -
  `theme.css`'s build-mode CSS for that control doesn't match its live-preview CSS. Compare the
  two directly: `.output/exports/<theme>/theme.css` (what got applied) against
  `emitCss(state, { forPreview: true })` for the same state (what the preview showed).
- **A font's `document.fonts.check` reports `false` on one side only:** a real machine/network
  difference (a Fontsource CDN hiccup, a blocked font request), not an emitter bug - re-run before
  investigating further.

## Output

Writes `roundtrip-results.json` (per-theme, per-page, per-mode mismatch lists) and, unless
`SVC_ROUNDTRIP_SCREENSHOTS=0`, before/after/side-by-side PNGs, all under `.output/` next to this
file (gitignored - regenerated every run, never a baseline to diff against in review). The console
also prints a per-theme summary and a `TOTAL MISMATCHES` line; the process exits non-zero if that
total is greater than 0, so this composes into a CI-style pipeline like the other test commands.

## Files

| File | What it does |
|---|---|
| `core-modules.mjs` | Imports the app's own pure core modules (`state.js`, `presets.js`, `emit-css.js`, `emit-apply.js`, `manifest.js`, `treatments.js`, `color.js`, `version.js`) by relative path - this suite lives inside `app/`, so a plain `import` already resolves against `app/node_modules`. |
| `surfaces.mjs` | The ~40 checked surfaces (selector + computed-style properties), taken from `manifest.js`'s own `target` fields so the probe checks the exact DOM hooks the customizer claims to control. |
| `harness.mjs` | Playwright helpers: launches this repo's own installed `playwright-core`/pinned Chromium (no second install; override with `SVC_CHROME_PATH`), seeds the app's live-preview state via its real code path, forces light/dark via Starlight's own `localStorage['starlight-theme']`, reads computed styles, diffs with the tolerances above. |
| `fresh-site.mjs` | Scaffolds, resets, and builds the fresh site; starts/stops its :4431 preview server. |
| `roundtrip.mjs` | **The entry point** (`npm run test:roundtrip` runs this). Builds the three theme states, emits exports, applies each to the fresh site, and compares against the app. |

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `SVC_BASE_URL` | `http://localhost:4420` | The app's own preview origin to compare against. |
| `FRESH_SITE_DIR` | an OS-temp path, fixed across runs | Where the fresh site lives. |
| `SVC_CHROME_PATH` | `playwright-core`'s own pinned Chromium | Browser executable. |
| `SVC_ROUNDTRIP_OUTPUT_DIR` | `.output/` next to this file | Where the JSON report/screenshots go. |
| `SVC_ROUNDTRIP_SCREENSHOTS` | on | Set to `0` to skip screenshots (faster). |
| `SVC_ROUNDTRIP_FORCE_INSTALL` | off | Set to `1` to force a fresh `npm install` in the fresh site. |
