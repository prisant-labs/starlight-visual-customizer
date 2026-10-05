# Accessibility

This document covers two different questions:

1. Does the studio's own interface work without a mouse or without good vision? That interface is
   the editor at `/studio/`, the product page at `/` and the About page.
2. Does a theme that someone builds with the studio stay readable once it ships?

The sections below describe the code and tests that exist today. They make no conformance claim.
[`docs/studio.md`](docs/studio.md) explains the names of the studio's parts, such as the rail, the
panel column and the context line.

## Goals

The studio aims to be operable by keyboard. It aims to expose its own state through ARIA roles,
not through color or shape alone. It aims to give every generated theme a readable contrast floor
by default. These are goals the project works toward, not a guarantee. Nothing here claims that
the studio or a theme it produces meets any WCAG level.

## What the studio supports today

- **Keyboard shortcuts.** `Ctrl`/`Cmd+E` opens Export. `Ctrl`/`Cmd+Z` undoes, and `Ctrl`/`Cmd+Shift+Z`
  or `Ctrl+Y` redoes. A bare `\` collapses or expands the panel column. Every shortcut is ignored
  while a text field has focus, even one several shadow roots deep. All of them stand down while
  the About dialog is open (`app/src/customizer/ui/studio.js`, `isTypingTarget()`).
- **Escape** turns off Inspect mode (`app/src/customizer/ui/inspect.js`). It closes the export,
  share-link, and contrast-warnings dialogs (`app/src/customizer/ui/export.js`,
  `app/src/customizer/ui/share-dialog.js`). It closes the color popover and returns focus to the
  swatch button that opened it (`app/src/customizer/ui/color-picker.js`). It also cancels an
  in-progress row drag in the Structure editor (`app/src/customizer/ui/ia-editor.js`). A native
  modal `<dialog>` takes priority: while the About dialog is open, Escape reaches it first.
- **The "Elements" list is a keyboard alternative to hovering.** The toolbar's "Elements" button
  opens a popover that lists every styleable element on the page, by panel section. Choosing an
  entry reaches the same controls that a click in Inspect mode would. Focus moves to the first item
  as soon as the popover opens (`app/src/customizer/ui/inspect.js`, `toggleElementsPopover()`).
- **The Structure editor's toolbar is an alternative to drag and drop.** Dragging a row with the
  mouse is pointer-only: `mousedown`/`mousemove`/`mouseup`, not native HTML5 drag-and-drop. A
  comment says that native API hung the project's pinned headless Chromium build. The toolbar's
  Move up, Move down, Outdent, Indent, and Delete buttons act on the selected row. Each row is
  also a `role="treeitem"` with a roving `tabIndex`. Arrow Up and Arrow Down move the selection,
  and Enter or Space selects the row again (`app/src/customizer/ui/ia-editor.js`). The toolbar's
  buttons are `1.75rem` (28px) square. A comment in `app/src/customizer/ui/styles.js` says that the
  earlier `1.4rem` (22.4px) size was "under a comfortable tap/click target."
- **Only the About dialog is a native `<dialog>`,** opened with `.showModal()`. The browser
  supplies the top layer, the focus trap, and Escape-to-close, and focus returns to the opening
  button on close (`app/src/pages/studio.astro`, `app/src/customizer/ui/studio.js`). The export,
  share-link, and contrast-warnings dialogs are each a plain `<div role="dialog" aria-modal="true">`
  instead. Escape still closes them, and opening one moves focus to a specific control, but none
  wires a Tab key handler. Tab can therefore reach something behind the dialog
  (`app/src/customizer/ui/export.js`, `createContrastDialog()` in
  `app/src/customizer/ui/controls.js`).
- **ARIA roles and focus styles.** The rail is `role="tablist"` (`aria-orientation="vertical"`).
  Each group button is `role="tab"` with `aria-selected` and a roving `tabIndex`. Arrow Up, Arrow
  Down, Home and End move and activate the selection (`app/src/customizer/ui/panel.js`).
- **Tiles are native radio groups.** Each set of tiles, including the preset gallery, is a group of
  `<input type="radio">` elements, so the browser supplies arrow-key navigation and a focus ring. A
  tile's own sample preview is `inert`, so its cloned controls can never take focus or a pointer
  event (`app/src/customizer/ui/tiles/tile-grid.js`).
- **Focus and live regions.** `:focus-visible` outlines appear more than a dozen times in
  `app/src/customizer/ui/styles.js`. The Studio sizing value is `aria-live="polite"`
  (`app/src/customizer/ui/panel.js`). The contrast text and the save-status text are not live
  regions (see "Known barriers").
- **The contrast walk of the studio chrome.** `runContrastWalk()` in `app/tests/e2e/shell.mjs`
  walks every visible text node in the chrome and the panel's shadow root. It requires 7:1
  contrast by default, relaxed to 4.5:1 for "muted" text or white text on the accent fill. It runs
  against the plain panel and again with each dialog, the color popover, the Structure group, and
  Inspect active. It also checks one non-text pair, a card's border against its section
  background. This is a self-test of the chrome, separate from the theme check below; see
  [`docs/testing.md`](docs/testing.md) for how the full test suite runs.
- **Studio sizing and the narrow-window drawer.** The chrome zooms to 80, 90, 100, 110 or 120
  percent, and the choice is remembered across visits. The preview frames never zoom. Below a
  900-pixel window, the panel becomes a drawer that opens from a top-bar button, and it starts
  closed. Any size above 100 percent is capped to 100 there, because that layout "has no room to
  spare" (`app/src/customizer/core/sizing.js`, `app/src/pages/studio.astro`).
- **Reduced motion is not handled.** No media query or script under `app/src` reads
  `prefers-reduced-motion`. The chrome runs a few short CSS transitions, such as 0.15 seconds on
  carets and a 0.4-second fade on the target-highlight overlay (`app/src/customizer/ui/styles.js`).
  None of them respects that preference.
- **The color popover's keyboard support** comes from `vanilla-colorful` 0.7.2. Its
  saturation area and its hue bar are each a `role="slider"` with `tabindex="0"`, an `aria-label`,
  and `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. The arrow keys, Page Up, Page Down, Home
  and End move the color in fixed steps (`app/node_modules/vanilla-colorful/lib/components/`). The
  wrapper in `app/src/customizer/ui/color-picker.js` adds `aria-haspopup="dialog"` and
  `aria-expanded` to the swatch button. It moves focus to the first field when the popover opens,
  and it returns focus to the swatch button on Escape.
- **Language attributes.** `app/src/pages/studio.astro`, `app/src/pages/index.astro`, and
  `app/src/pages/about.astro` each set `<html lang="en">`.

## The contrast check, for themes you create

Every ratio comes from culori's `wcagContrast()`, wrapped as `contrastRatio()` in
`app/src/customizer/core/color.js`. Three checks use it.

- **Palette generation.** `getPalettes()` builds a dark and a light palette from the chosen accent
  and gray hue/chroma. It then nudges five shades until each clears the chosen floor against one
  fixed partner. In dark mode that is `gray-2` against `gray-5`, and `gray-3` against `black`. In
  light mode it is `accent` against `gray-6`, `gray-2` against `gray-6`, and `gray-3` against
  `black` (`contrastColor()` and `getPalettes()` in the same file). The floor is a control,
  "Contrast floor," AA (4.5:1, the default) or AAA (7:1) (`app/src/customizer/core/manifest.js`).
  When the nudge changes a hand-typed hex, the Colors group notes "Starlight adjusts lightness for
  readable contrast" (`app/src/customizer/ui/controls.js`).
- **The context-line check.** `computeStatusContrastReport()` checks nine named pairs of text and
  background, each in light mode and in dark mode, for 18 rows in all
  (`app/src/customizer/ui/panel.js`). The pairs are:
  - body text, links and muted text against the page background
  - sidebar text against the sidebar background
  - the site title against the header background
  - the title color of each of the four aside kinds against its own aside background (the aside's
    body text is not checked)

  Every color is read from the live generated CSS, so a role override or a change to a semantic
  hue is included. This check drives the context line's "Contrast AA" or "Contrast AAA" status and
  the table in the contrast-warnings dialog.
- **The Colors group's readout** is narrower. It checks body text and the link color against the
  page background, in dark mode and in light mode. It shows each ratio against both the AA and the
  AAA threshold, whatever floor is chosen (`app/src/customizer/ui/panel.js`,
  `app/src/customizer/ui/controls.js`).

As far as `app/src/customizer/core/color.js` and `app/src/customizer/ui/panel.js` show, these
checks leave several things out:

- **Non-text contrast,** such as borders, icons and focus rings.
- **Font size and legibility.**
- **Text over an image.** Every background that the checks read is a flat CSS color token.
- **The code theme's colors,** which appear in neither list of pairs.
- **Any other pair of text and background.** An override to a token outside the lists above is
  never evaluated.

## Known barriers

- No screen-reader testing is recorded anywhere in this repository: no mention of NVDA, JAWS, or
  VoiceOver in the source or the test suite.
- **Three dialogs neither trap focus nor return it.** The Export, share-link and contrast-warnings
  dialogs have no focus trap, and they do not return focus to the control that opened them. Only
  the native About dialog does both (`app/src/customizer/ui/export.js`,
  `app/src/customizer/ui/share-dialog.js`, `app/src/customizer/ui/controls.js`).
- **Escape can stop working in the Export dialog.** Tab can move focus behind the dialog. A code
  comment in `app/src/customizer/ui/export.js` notes that once focus drifts outside, "Escape does
  nothing". The Escape listener sits on the backdrop, so it only hears key events that pass
  through it.
- **The Export dialog's file tabs ignore the arrow keys.** They carry `role="tab"`, but unlike the
  rail they wire no arrow keys, so Tab and Shift+Tab reach them instead
  (`app/src/customizer/ui/export.js`).
- **Nothing responds to `prefers-reduced-motion`.** A handful of short transitions always run,
  such as the 0.4-second fade on the target-highlight overlay (`app/src/customizer/ui/styles.js`).
- The contrast-warning text and the save-status text are not announced through an `aria-live`
  region, unlike the Studio-sizing value. The narrow-window drawer toggle sets only an
  `aria-label`, not `aria-expanded`, unlike the panel-collapse button beside it
  (`app/src/customizer/ui/studio.js`).
- The studio's preview frames always show the project's own demo site, "Orbit Docs" under
  `/demo/specimen/`, never a visitor's own site (`app/src/pages/studio.astro`). Judging a theme's
  effect on real content means picturing it on different pages.
- Dragging a sidebar row is pointer-only (`app/src/customizer/ui/ia-editor.js`). The keyboard
  alternative above has not been exercised with a screen reader. Touch dragging is unverified too,
  since the drag code binds mouse events, not touch or pointer events.

## How to report a barrier

If something here does not work for you, open a bug report under
[Issues](https://github.com/prisant-labs/starlight-visual-customizer/issues/new/choose). Put
"accessibility" in the title. Include what you were trying to do, the assistive technology or
input method you were using, and your browser. A question rather than a specific barrier goes to
[Discussions, under Q&A](https://github.com/prisant-labs/starlight-visual-customizer/discussions/categories/q-a)
instead.
