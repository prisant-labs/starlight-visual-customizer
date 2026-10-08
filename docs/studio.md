# The studio, part by part

This page describes what the studio at `/studio/` shows and does, and names the code behind each
part. [`docs/architecture.md`](architecture.md) maps the code itself, and
[`docs/export-format.md`](export-format.md) covers what the studio exports.

The studio is a full-window app shell. Its own chrome always uses light colors, from the `--ui-*`
tokens, whatever mode the preview shows. `app/src/pages/studio.astro` builds the page.

## Top bar

- **On the left:** the logo and the product name ("Starlight Visual Customizer"), the theme name, undo and redo, and
  the change count as plain text, such as "24 changes". The theme name is editable and lives in
  `state.meta.name`. The count's tooltip says "from Starlight default". The count comes after undo
  and redo, so a change in its number of digits never moves the buttons.
- **On the right:** About (an info button that opens the About dialog), a labeled GitHub pill that
  opens the repository in a new tab, then Import, Screenshot, Share and Export, in that order.
  Export is the primary button. Screenshot and Share each open the Export dialog already showing
  their own export; "The Export dialog" below says which. Import loads a settings file exported
  earlier, as one undo step.
- **Saving shows nothing while it works.** If the browser blocks storage, "Not saved (storage
  blocked)" appears in amber right after the theme name.
- **The bar sheds text, not controls, as the window narrows.** Below 1120 pixels it drops the
  labels on Screenshot and Share, leaving their icons. Below 1000 pixels it drops the brand name.
  Below 840 pixels it drops the change count, the labels on GitHub, Import, Screenshot, Share and
  Export, and the separators; the failure text shortens to "Not saved" but stays. Below 520 pixels
  Screenshot and Share leave the bar entirely, because Export still opens the same dialog at every
  export. Below 480 pixels it narrows the theme name.

### The Export dialog

The top bar's **Export** button, or `Ctrl+E` (`Cmd+E` on a Mac), opens the Export dialog: the main
export for the user's own Astro site, the customizer's own settings and screenshot exports, and a
file viewer with a tab for every file. [`docs/export-format.md`](export-format.md) describes every
file it offers. Inside the dialog, Tab cycles through its controls without leaving it, Escape
closes it, and the arrow keys, Home and End move across the file tabs and the screenshot's
Appearance and Page area choices.

## Rail

The rail is a 72-pixel column on the left, with one icon per control group plus "Structure
(advanced)". The icons follow the group order in `app/src/customizer/core/manifest.js`, with
separators between clusters of groups.

- **It is a `tablist`.** The selected item gets a solid accent fill. A dot marks a group in which
  any control differs from its default.
- **Selecting a group scrolls the preview** to that group's first visible target. Presets, Colors,
  Typography, Page options and Structure do not scroll the preview.
- **Clicking the selected item again** selects the group again and scrolls to its target, the same
  as a fresh selection. The panel column stays open.
- **Only two things collapse the panel column:** the collapse button in the panel's header and the
  `\` key. Any click on a rail item reopens a collapsed panel.

### Studio sizing

The bottom of the rail holds **Studio sizing**: minus, the percentage, and plus. It zooms the
studio's own chrome from 80 to 120 percent with CSS `zoom`. The chrome is the top bar, the page
toolbar, the context line, the rail, and the panel with its dialogs.

- **The preview is never zoomed.** It simply gains or loses room. At 90 percent in a 1440-pixel
  window, the page toolbar fits on one row again.
- **The choice persists.** `localStorage['svc-studio-sizing']` keeps it, and a script in the head
  of `app/src/pages/studio.astro` applies it before the first paint.
- **Narrow windows cap it.** Below 900 pixels, sizes above 100 percent are capped and "Larger
  studio" is disabled, because the narrow layout has no room to spare. Widening the window
  restores the stored size.
- **Some code must divide by the zoom.** The color popover, the target-highlight box and the
  Structure drop line place themselves by measured screen position inside the zoomed panel.
  `app/src/customizer/ui/studio-sizing.js` explains why they divide by the zoom.

## Panel column

The panel column is 340 pixels wide and sits beside the rail. From top to bottom it holds a control
filter, a header for the group, and that group's sections and controls. The header carries an
eyebrow, a title, a description and a reset button.

- **Sections and controls collapse.** Each manifest `section` inside a group is its own disclosure,
  and each control can collapse on its own too. Both start open. The open or closed state is kept
  per group, section and control in `sessionStorage['svc-ui']`.
- **Collapsed items still show their state.** A dot on a collapsed section's header means a control
  inside it differs from its default. A collapsed control shows its current value on its header
  line, such as "720 px", a color chip with its hex value, or "On".
- **Expand all and Collapse all** in the group header act on both levels. Collapse all first
  collapses every control. Pressed again, it collapses the sections too. Expand all opens both
  levels at once.
- **Units.** A control stored in `rem` shows and accepts pixels in its number field, with a
  secondary `rem` readout. A control stored in `px` shows a secondary `rem` readout too, except for
  radius and shadow. The slider always moves in the control's own stored unit.

### Tiles

About 19 controls show their options as tiles instead of a dropdown. Each tile renders real
Starlight elements in the current colors and recolors live.

- **Component styles** render a trimmed real element. That element includes the sidebar, the table
  of contents, callouts, inline code, links, tables, tabs, the header, the search box and
  pagination. Each sample keeps only the content that still shows the difference between options.
- **Alignment controls** render small layout diagrams instead.
- **Fonts** appear as a list, with each name set in its own font.
- **Contrast level and code theme stay dropdowns.** Contrast level has nothing to picture, and code
  themes only apply at build time.
- **A click anywhere on a tile selects it.** The caption, a label with a check mark when selected,
  sits above the preview. The preview is `inert`, so a cloned control inside it can never catch the
  click.
- **Tiles always render in one column** at the panel's real width.
  `computeTileLayout` in `app/src/customizer/ui/tiles/index.js` decides grid or rows as a rule, not
  per control.

### Color controls

Every color in Starlight's palette comes from a hue and chroma pair. Starlight's five semantic hues
work the same way. The official theme designer's algorithm turns each pair into colors, and it
tunes the lightness of each role for readability. So hue and chroma stay sliders, and every color
control adds these editors:

- **A hex field is the primary editor,** beside a live gradient track and live swatches. Each color
  control lays out the same way: the slider row, the hex field and picker row, the swatch strip,
  then the note or help.
- **A hex-first popover picker** wraps `vanilla-colorful`'s saturation and hue picker. It adds its
  own fields, plus an eyedropper button when the browser supports one. The browser's native color
  dialog was dropped, because Chrome's dialog cannot be forced into hex mode.
- **A HEX | RGB | HSL switch** sits above the popover's fields. Hex is the default. RGB and HSL each
  show three whole-number boxes. The browser remembers the last format in
  `localStorage['svc-color-format']`.
- **Typing a hex value and pressing Enter** solves back to the hue, and to the chroma for accent and
  gray, as one undo step. Blurring the field does the same. The result snaps to each control's own
  slider step: whole degrees for hue, and steps of 0.005 or 0.001 for chroma. So the number box
  never shows a raw float. A drag inside the popover also becomes one undo step.
- **The field then shows the color actually produced.** Starlight tunes lightness per role, so the
  result can differ from what you typed. A short note says so when it does.
- **A blur that does not change the field's text does nothing.** It never solves again from
  whatever the field happens to display.

**Role overrides** (`color.role.*`) use the same hex field. A small muted **Auto** tag shows while
the role follows the generated palette. Once the role is overridden, a **✕ Follow the palette**
button replaces the tag. The two never show together.

`COLOR_ASSIST` in `app/src/customizer/ui/controls.js` drives these editors, and
`app/src/customizer/ui/color-picker.js` is the popover.

### Preset cards

Preset cards sit in one column. Each card shows an anchor chip in the preset's accent color.
Below that sits the preset's name, over a strip of seven swatches from its own light palette:
accent-low, accent, accent-high, then four grays. The description lives only in the card's
tooltip. The selected card gets an accent border and a check mark.

### Structure (advanced)

Structure edits the demo site's sidebar, and the result exports as configuration in
`APPLY-THEME.md`.

- **The tree** shows folder and page icons with indentation guides. "+ Page" and "+ Group" add
  items, and a "Selected item" form edits the chosen one.
- **A toolbar** below the form moves, outdents, indents and deletes items. Its targets are 28
  pixels, and their tooltips name each action.
- **Drag and drop** uses a pointer-based drag of its own, not the HTML5 `draggable` API.
  Chromium's native drag and drop hangs headless test runs the moment a drag starts.
- **While dragging, a marker shows where the item will land.** A line between rows means before or
  after. An outline and a tint on a group row mean into the group. `Esc` cancels the drag, with no
  change and no undo step.
- **Every structural edit is its own undo step:** a move, an indent, a delete, a drop or a rename.
  A typed rename becomes one step, like a slider drag.

### Site title

Site title is a text control in the Header group's "Site title" section. It renames `.site-title`
in the preview live. It also tells `APPLY-THEME.md` to set Starlight's own `title` option, because
the title only changes at build time.

## Toolbar

- **Four page tabs:** Style guide (the default), Document, Landing and 404. "The page tabs" below
  explains them.
- **Light | Dark | Split.** Split shows two lanes, one forced light and one forced dark, which share
  one theme.
- **A device control:** Fit, Laptop 1280, Desktop 1440, Wide 1920, Ultra-wide 2560, Tablet 820 and
  Mobile 390. Each width is a real viewport width, so Starlight's own responsive layout applies.
- **A zoom control:** minus, the percentage, plus and Fit, from 25 to 150 percent. Above fit, the
  lane pans sideways, and the page itself still scrolls vertically.
- **Inspect and its Elements list.** "Inspect" below explains them.
- **Open in new tab** shows the page as a visitor sees it. "Outside the studio" below explains it.

Scaling uses `transform`. No ancestor of a preview frame can scroll, because each one sets
`overflow: clip`. So scrolling the page to a control's target never shifts or clips the frame.

## Context line

The context line sits under the toolbar.

- **On the left,** a breadcrumb shows the frame's current page.
- **On the right,** the contrast check comes first. It shows a green "Contrast AA" when every text
  pair passes WCAG AA in both light and dark mode. That check runs against the palette actually in
  effect. Otherwise it shows an amber "N contrast warnings". A click opens the full contrast table.
- **Then** come "Real Starlight 0.42.4 build · CSS live" and the scale label.

## Narrow windows

Below 900 pixels wide, the panel column becomes a drawer over the work area, opened and closed from
the top bar. The rail stays visible.

## The page tabs, in Starlight's terms

The toolbar's four tabs are pages of the demo site, each chosen because it exercises something
different. Starlight has no per-page layouts or templates that you design yourself. Every page is
a Markdown or MDX file in `src/content/docs/`, and one shared layout renders all of them. Pages
differ in three ways only:

- **The `template` frontmatter field.** `doc` is the default: a header, a left sidebar, the content
  and a table of contents on the right. `splash` is a wide page without sidebars, usually with a
  `hero`.
- **Per-page frontmatter options,** such as `hero`, `banner`, `tableOfContents`, `prev` and `next`,
  `lastUpdated`, `sidebar` (label, order and badge), `pagefind` and `editUrl`.
- **Their content:** its length, its heading depth and the components it uses.

| Tab | File | URL | Template | What makes it different |
|---|---|---|---|---|
| **Style guide** | `demo/specimen.mdx` | `/demo/specimen/` | `doc` | One short instance of every element a theme can style. That includes the type scale, links, inline code, lists, callouts, a table, code blocks, tabs, steps, a file tree, cards, link buttons and badges. It also has a `banner`, custom `prev` and `next` links, and a table of contents for levels 2 to 4. It is the default tab, because it shows the most controls at once. |
| **Document** | `demo/guides/kitchen-sink.mdx` | `/demo/guides/kitchen-sink/` | `doc` | The same kinds of content at full length: about 300 lines and 36 headings, down to h4. It tests a deep table of contents, scrolling and long reading. It also carries `lastUpdated`, so the footer shows a "last updated" line. |
| **Landing** | `demo/index.mdx` | `/demo/` | `splash` | A page with no sidebars and no table of contents, and a `hero` with a title, a tagline, an image and action buttons. The hero controls show here. |
| **404** | (built in) | `/404/` | `splash` | Starlight's built-in not-found page, a `splash` page with a hero. The demo site has no `404.md` of its own. |

Three more demo pages stay out of the tabs: **Article** (`/demo/resources/changelog/`), **Short
doc** (`/demo/guides/getting-started/`) and **Reference** (`/demo/reference/manifest/`). All three
share Document's `doc` template, so they add variety in length, frontmatter and sidebar position,
but no new page shape. The demo site's own sidebar still reaches them, and the tabs then show an
"Other: /path/" state.

## Inspect

Inspect finds the controls that style an element on the page.

- **Turn it on** with the toolbar's **Inspect** button or the `I` key. The key does nothing while a
  text field has focus. `Esc` turns Inspect off and clears every outline.
- **Hovering** draws a solid ring around the innermost element that matches any control's target.
  A dashed ring marks every other element that shares that scope, and a small "Group › Section" tag
  appears near the pointer.
- **Clicking** opens that group in the panel without scrolling the page. It expands every section
  that holds one of the matching controls, and an "Inspecting: …" chip lists them.
- **The Elements button** lists every surface on the current page, grouped. It is the keyboard's
  way to reach the same controls without hovering.

Inspect works in either Split lane and survives navigation inside the frame.
`app/src/customizer/ui/inspect.js` implements it.

## Undo, redo and keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Z` (`Cmd+Z`) | Undo |
| `Ctrl+Shift+Z` (`Cmd+Shift+Z`) or `Ctrl+Y` | Redo |
| `Ctrl+E` (`Cmd+E`) | Open Export |
| `I` | Turn Inspect on or off |
| `Esc` | Turn Inspect off, cancel a Structure drag, or close the open dialog |
| `\` | Collapse or reopen the panel column |

Every shortcut does nothing while a text field has focus, including fields inside the panel's
shadow root.

Each of these is one undo step: a slider drag, applying a preset, a group reset, "Reset all", an
import and a Structure edit. A hex field commit is exactly one step too. Typing a value and
pressing Enter is one step. Clicking elsewhere afterward must not record a second, slightly
different step from whatever color the field displays at that moment.
`app/src/customizer/core/history.js` merges steps that
share a stable key. Every hex field's blur handler does nothing unless the field's own text changed
since its last commit. A typed Structure rename gets the same treatment: its `input` and `change`
events share one merge key per item.

## The About dialog and the `/about/` page

The About text lives in `app/src/about/about.md`; edit that file to change it.
`app/src/about/AboutBody.astro` adds a facts line under it, with the Starlight version and the
links to the repository and the projects hub. Both places that show the text render that one
component at build time:

- **The About dialog.** The top bar's info button opens it as a native modal `<dialog>`. Escape,
  the close button and a click on the backdrop close it. Its external links open in a new tab. The
  studio's keyboard shortcuts, including Inspect's `I` and `Esc`, stand down while it is open.
- **The `/about/` page.** It shows the same text as a page of its own, for direct links and
  sharing, built by `app/src/pages/about.astro`. Its "Open the studio" links respect the base path.
  It is deliberately not a Starlight content page.
  [Decision 0006](decisions/0006-standalone-about-page.md) explains why.

## Outside the studio

Every page of the demo site shows exactly what a visitor would see, with the saved theme applied.
This is true whether it is opened directly or through "Open in new tab". A small **Open in
Studio** button sits in the corner. The customizer reaches those pages through Starlight's `Footer` override,
`app/src/components/CustomizerFooter.astro`, which `app/astro.config.mjs` registers.

An older overlay-style panel also still mounts, but only when the URL carries `?svc-overlay`. The
engine test suites `smoke`, `ui-round2`, `treatments`, `targets` and `tiles` use it.

## Known gaps

- **Tile samples are built once,** from the primary lane's first ready page, which is normally the
  Style guide. They are not rebuilt after later navigation.
- **Two header tiles look almost the same.** "Default border" and "No border" are hard to tell
  apart, because Starlight's real border is a faint 1-pixel line. The tiles show it truthfully
  rather than exaggerating it.
