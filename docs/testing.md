# Testing

The project has three kinds of test. All commands run from the `app/` folder.

| Command | What it checks | Needs a running server |
|---|---|---|
| `npm test` | 291 unit tests of the logic that runs without a browser | No |
| `npm run test:e2e` | 14 browser suites that drive the real studio with a real mouse and keyboard | Yes: the production preview on port 4420, by default |
| `npm run test:roundtrip` | That an export, applied to a fresh Starlight site, reproduces the studio's preview | Yes: the app's own production preview, plus a preview of the fresh site that the suite starts on port 4431 |

CI runs `npm test` and a production build on every pull request, and a pull request cannot merge
until that check passes. CI does not run the browser suites or the round trip. Run the ones that
cover your change, and list them in the pull request.

## Unit tests

`npm test` runs every `app/tests/core/**/*.test.js` file with Node's built-in test runner. The 291
tests cover:

- **The CSS emitter,** through golden files, with a guard that `golden:update` covers every one.
- **The `APPLY-THEME.md` emitter,** including the site title's config line, and its agent-message
  delivery, including `fenceFor`'s code-fence rule.
- **`export-files.js`:** `slugifyThemeName`, the name every file is built from, `buildExportFiles`
  naming every file after the theme, and `buildZip` holding only `theme.css` and `APPLY-THEME.md`.
- **The control manifest.**
- **Theme state:** decoding a state saved before an upgrade (`starlight: '0.42.3'`), the strict
  `tryDecodeState`, `sameTheme` and `snapToStep`.
- **Share links:** `app/src/customizer/core/share-link.js` choosing between a share link and the
  saved theme, and its share-URL builder.
- **`sanitizeState`:** every preset, the golden rich theme and the demo sidebar come back
  unchanged. Crafted values, sidebar paths, links and `attrs` are dropped or made safe. The export
  outputs stay safe even for a theme that skipped the check.
- **Sidebar safety:** the link-scheme filter and the `attrs` filter.
- **Color math,** including the color popover's RGB and HSL conversions and each preset's own
  light palette.
- **The sidebar parser.**
- **Undo and redo** in `app/src/customizer/core/history.js`.
- **The base-path helper** in `app/src/customizer/core/base-path.js`, with both trailing-slash
  shapes of `import.meta.env.BASE_URL`.
- **Studio sizing** in `app/src/customizer/core/sizing.js`: its steps and its cap in a narrow
  window.
- **The demo site's `demo/` prefix helpers** in `app/src/demo-site.mjs`, with a guard that
  `app/src/fixture-sidebar.mjs` stays free of the prefix.
- **The version guard:** `STARLIGHT_VERSION` in `app/src/customizer/core/version.js` must match
  the installed `@astrojs/starlight`.

## Golden files

`app/tests/golden/` holds the exact expected output of the two exporters for six cases: three
`theme.css` cases, the shortest and the fullest `APPLY-THEME.md`, and the agent message for that
same full theme. The case list is `app/tests/golden/cases.js`, and the unit tests read the same
list.

After an intended change to `emit-css.js` or `emit-apply.js`, run `npm run golden:update`. It
rewrites the six golden files from the current emitters. Read the diff before you commit it. The
script trusts the emitters, so it would write a regression into the golden files as faithfully as
an improvement.

## Browser suites

### Running them

The suites use `playwright-core` with the Chromium build that it expects. Install that build once:

```bash
npx playwright-core install chromium
```

Set `SVC_CHROME_PATH` to use another Chromium or Chrome instead.

Build the app, start the production preview, then run the suites one at a time against that one
server:

```bash
npm run build
npm run preview:bg
node tests/e2e/shell.mjs
```

`npm run test:e2e` runs all 14 suites in this order:
`home`, `smoke`, `ui-round2`, `treatments`, `targets`, `tiles`, `studio`, `shell`, `sizing`,
`share`, `inspect`, `editors`, `screenshot`, `export`.

Every suite drives real `page.mouse` and `page.keyboard` input at element centers. It does not
call `.click()` from a script. Some behavior only reproduces under a real click: for example, a
real click blurs a focused field, and a scripted click does not.

### The suites

| Suite | Area | Checks |
|---|---|---|
| `home.mjs` | The product page at `/` | 30 |
| `smoke.mjs` | A quick end-to-end pass of the customizer | 11 |
| `ui-round2.mjs` | The overlay panel's preload, filter and state | 22 |
| `treatments.mjs` | Every treatment control's effect | 129 |
| `targets.mjs` | Every control's target selector | 78 |
| `tiles.mjs` | Tiled controls | 264 |
| `studio.mjs` | The studio's frame, pages and export | 60 |
| `shell.mjs` | The studio's chrome, contrast and layout | 181 |
| `sizing.mjs` | Studio sizing | 32 |
| `share.mjs` | Share links | 44 |
| `inspect.mjs` | Inspect | 32 |
| `editors.mjs` | Hex entry, the color popover and the Structure editor | 129 |
| `screenshot.mjs` | PNG screenshot export | 54 |
| `export.mjs` | The Export dialog | 67 |

**`home.mjs`** checks the product page at `/`:

- It renders instead of forwarding, and it keeps `noindex`.
- It makes no third-party request, and it loads its self-hosted Inter font.
- Its links respect the base path and reach a working studio.
- A real tab click swaps the screenshots.
- It shows one chip per preset, in the order of `presets.js`.
- It carries the social preview card's tags: `og:image` as an absolute URL built from `TOOL_URL`,
  `twitter:card`, and matching image alt text. The local preview serves `og.png` as `image/png`.
- It has no horizontal scroll at 375 pixels.
- A root link that carries `#svc=` (with `?page=`) forwards to the studio, which applies the
  shared theme.

**`smoke.mjs`** checks that the panel mounts, that a control and a preset visibly recolor the
page, and that a sidebar rename persists.

**`ui-round2.mjs`** checks the CSS preload that prevents a flash of the old theme, and the control
filter. It also checks the overlay's Navigation tree, panel state that persists across navigation,
and "follow on page".

**`treatments.mjs`** checks the computed-style effect of every treatment control, in light and
dark mode.

**`targets.mjs`** checks that every control's `target` selector resolves on a real page.

**`tiles.mjs`** checks every tiled control's grid or rows layout, and that each option looks
visibly different. It also checks that every tile fits one column at the panel's real width. And
it checks that no tile leaves more than about 12 pixels of empty space below its content.

**`studio.mjs`** checks frame targeting, navigation inside the frame, the page switcher, device
widths, "follow on page", light and dark mode, tiles and export. It also checks that clicking the
already-selected rail item never collapses the panel, while the collapse button and the `\` key
still do.

**`shell.mjs`** checks the studio's chrome:

- The rail, including a regression check for the re-click behavior above.
- A full contrast walk covers the chrome text, the panel, the dialogs, and the hex fields in
  Colors. It also covers the color popover, the Structure tree and form with its enlarged
  toolbar, and both shapes of the share-link dialog.
- The hit-test audit, undo and redo, and group reset.
- The top bar's change count, and the context line's contrast check.
- The save-failure text under blocked storage, and its place after the theme name.
- Undo and redo keeping their position as the change count grows.
- Split view, including a dark lane that finished loading before the studio's own script ran. The
  suite forces that order by holding the script back.
- Scaling, the narrow-width drawer, and a pixel check that every range thumb sits centered on its
  track.
- Every section and card starting open, with working collapse, expand, Expand all and Collapse all.
- The top bar's branding and GitHub pill, including a logo that loads from the base-aware
  `logo.svg`.
- The About dialog, opened and closed by real clicks and keys, with the shortcuts standing down
  behind it, and the `/about/` page with its logo.
- No top-bar overflow at eleven widths, each chosen on one side of a width step in `studio.astro`:
  1119 (Screenshot and Share's labels), 839 (the other labels), and 539 (Screenshot and Share leave
  the bar; Export still opens the same dialog at either export). The list also keeps 520, where
  Firefox once overflowed by 8 pixels.
- A Footer rail click on a page with an empty pagination wrapper (Landing) opens the Style guide.

**`sizing.mjs`** checks Studio sizing:

- The control sits at the bottom of the rail, outside the rail's tablist.
- The zoom reaches the top bar, the toolbar, the context line and the panel, but never the stage
  or the frames. The preview gains room instead.
- The choice survives a reload, and the control stops at 80 and 120 percent.
- The color popover opens under its swatch at 80 and 120 percent.
- The target-highlight box and the Structure drop line land on their targets at 90 percent.
- The Export dialog fits the viewport at 120 percent, at 1440 and 390 pixels wide.
- Below 900 pixels, a stored 120 percent is capped to 100 percent and "Larger studio" is disabled.
  The drawer and the top bar fit, and widening the window restores 120 percent.
- At 820 pixels, 90 percent still applies, and the drawer opens at its scaled width.

**`share.mjs`** checks share links:

- "Copy share link" carries `?page=` and the theme, and the copied link opens both.
- A link opens directly when nothing is saved, over saved defaults, and for the same theme. The
  studio still drops the hash after reading it.
- A link that differs from saved work asks "Open the shared theme?", with the saved theme still
  showing and Keep focused. Keep (surviving a reload), Escape, Open and Undo are each checked.
  Open applies and saves the shared theme and recolors the preview.
- A damaged link keeps the saved theme, or shows the defaults, and says that the link is damaged.
- A root link forwards to the same question.
- A theme name that carries markup shows as text and runs nothing.
- A shared sidebar's `javascript:` links render as `#`, including ones hidden behind a space and a
  tab. An `https` link is kept.
- A crafted link's values reach neither `APPLY-THEME.md` nor the agent message, and neither
  `theme.css` nor the agent message's own `theme.css` section. The suite tries config code in the
  table-of-contents and pagination values, a multi-line site title, and CSS in a role color. A
  separate check confirms the agent message still carries the real `theme.css` whole, inside its
  fence.

**`inspect.mjs`** checks turning Inspect on by button and by the `I` key. It also checks hover
outlines, click-to-select and the panel state it sets, the Elements list, Split lanes, and `Esc`.

**`editors.mjs`** checks:

- Hex entry, including a regression check for undo after blur, for an accent slider and for a role
  override.
- Hex fields staying current after undo, redo, a preset, a group reset, Reset all and an import.
- Preset card previews: one column, with no description in the body text.
- The Structure tree's drag and drop and its toolbar, and `APPLY-THEME.md` reflecting a reorder.
- The site title.
- The hex-first color popover: opening it, committing the hex field, and a real hue-bar drag that
  becomes one undo step. Closing it works with Escape or an outside click.
- A Structure undo regression check covers a preset, a reorder, Undo and Redo, a rename, and the
  rename's no-op guard under a long pause. It also covers a toolbar move, indent and delete, and
  an edit after Undo.
- The drag insertion marker's geometry for before, after and into a group, and Escape cancelling
  the drag.

**`screenshot.mjs`** checks the Export dialog's PNG capture, Full page and Visible area, in light
and dark mode. It decodes each image and compares it pixel by pixel with the live page.

**`export.mjs`** checks the Export dialog as a whole, against `export-files.js`'s own output run in
Node on the studio's own state:

- Each of the five outcomes takes one click: the agent message onto the clipboard, the zip, the
  settings file, the share link, and the PNG.
- Every file tab downloads its own file, by name and content, including the agent message as a
  `.md` file, and its Copy icon copies the same text.
- The zip holds one folder with `theme.css` and `APPLY-THEME.md`, and nothing else.
- The small screenshot renders on open, opens the Screenshot tab, and renders again after a theme
  change.
- A status replaces the line of the action it confirms, and the previous line returns.
- Focus, Escape, Tab and the arrow keys behave as in any modal dialog.
- A dark capture leaves the preview's mode, the stored `starlight-theme` and the toolbar as they
  were, and Split view captures from its dark lane without switching anything.
- A page switch during a capture does not hold up the next page's picture.
- The Document page's lazy image does not hold up its picture, which shows within 10 seconds, and
  the image keeps its `loading` attribute.
- A capture never runs a custom element's constructor on its copy. A probe element counts its own
  constructor calls, so the check works on every engine, and afterward Starlight's custom elements
  copy themselves normally again.
- A downloaded settings file imports back to the same theme.
- A theme name shows as text, never as markup.
- The dialog fits a phone-width window, and the overlay panel's dialog works without the small
  screenshot.

### Against the dev server

```powershell
$env:SVC_BASE_URL = 'http://localhost:4700'; npm run test:e2e; Remove-Item Env:SVC_BASE_URL
```

### Against a sub-path build

The suites take the app's origin and base together in one variable, `SVC_BASE_URL`. Build and
preview the app under the sub-path first, as [`docs/development.md`](development.md#serving-under-a-sub-path)
describes. Then:

```powershell
$env:SVC_BASE_URL = 'http://localhost:4420/starlight-visual-customizer'
npm run test:e2e
Remove-Item Env:SVC_BASE_URL
```

Leave the trailing slash off `SVC_BASE_URL`. Every suite joins it with a path that starts with a
slash, such as `` `${SVC_BASE_URL}/studio/` ``, so a trailing slash would double up.

### On Firefox and WebKit

Six of the 14 suites also run on Firefox or WebKit: `home`, `smoke`, `studio`, `shell`, `sizing`
and `share`. They use the same `playwright-core` package through a shared launcher,
`app/tests/e2e/browser.mjs`. Install the two engines once, then set `SVC_BROWSER`:

```powershell
npx playwright-core install firefox webkit
$env:SVC_BROWSER = 'firefox'   # or 'webkit'
node tests/e2e/shell.mjs
Remove-Item Env:SVC_BROWSER
```

- `SVC_BROWSER` defaults to `chromium`. `SVC_CHROME_PATH` applies only to Chromium.
- Some checks need a browser permission that only Chromium grants. `share.mjs` reads and writes
  the clipboard for "Copy share link", but Firefox grants neither permission, and WebKit lacks
  `clipboard-write`. Under Firefox or WebKit, such a check prints `SKIP - <check> (<reason>)`. A
  skip counts as neither a pass nor a failure, and the suite's summary line counts its skips.
- The other eight suites have not been checked on Firefox or WebKit. Under either engine, each one
  prints `SKIP - <suite> runs on Chromium only` and exits successfully. So `npm run test:e2e` still
  runs the six, and never reports a Chromium run as another engine's pass.
- Playwright's WebKit build on Windows is not Apple's Safari. It is WebKit's upstream Windows port,
  which is closer to the GTK WebKit on Linux than to Safari on macOS. A pass there is evidence for
  the engine, not a promise about Safari.

The WebKit runs found one real bug, since fixed. A Split view dark lane that finished loading
before the studio's own script ran was never attached, so it ignored every edit. `shell.mjs` now
forces that load order on every engine, so Chromium catches a regression too.

## The round trip

`npm run test:roundtrip` applies an exported `theme.css` and `APPLY-THEME.md` to a real, freshly
scaffolded Starlight site. Then it compares the computed styles on that site with the studio's
live preview. It proves that the export works outside the studio, not only inside it.
[`app/tests/roundtrip/README.md`](../app/tests/roundtrip/README.md) explains the suite in full.

The round trip reads `SVC_BASE_URL` too, but for a narrower purpose: the origin of the app's own
preview, to compare against. It never takes a base path, because it builds its own comparison site
at `/` and runs only against a root build of the app. Point it at a plain origin:

```powershell
$env:SVC_BASE_URL = 'http://localhost:4420'
npm run test:roundtrip
```

Do not reuse a value that still carries the sub-path from an e2e run.

Run the round trip on its own, and run `smoke.mjs` separately afterward. A smoke run straight
after the round trip has lost two checks before, and a smoke run on its own passed.
