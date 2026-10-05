# Export format

The studio exports a theme as three text files, an optional zip of all three, a share link, and
optional PNG screenshots. This page describes each one and the code that writes it.
[`docs/security-model.md`](security-model.md) explains how the studio keeps untrusted input out of
these files.

## The Export dialog

The top bar's **Export** button, or `Ctrl+E` (`Cmd+E` on a Mac), opens the Export dialog. The
dialog is built in `app/src/customizer/ui/export.js`. It shows each file in its own tab, with
**Copy** and **Download**, and it adds these actions:

- **Download all (.zip)** puts the three files in one zip, named after the theme, such as
  `ocean-breeze.zip`. The zip holds exactly the text that the tabs show. The `fflate` package
  builds it in the browser.
- **Copy share link** copies a link that carries the whole theme. See "Share links" below.
- **Screenshot (PNG)** captures the previewed page. See "PNG screenshots" below.
- **Import state.json** loads a state file exported earlier. The import is one undo step.

The dialog also carries a short privacy note: "Your theme stays in your browser; web fonts load
from jsDelivr".

## `theme.css`

`app/src/customizer/core/emit-css.js` writes `theme.css`. The file has these properties:

- **It holds only the differences.** A value that matches Starlight's default produces no CSS.
  The default theme therefore produces a file with only its header comment.
- **It is unlayered.** The CSS sits in no cascade layer, so its place in Starlight's `customCss`
  array decides any tie with another stylesheet. The apply steps put it last, so it wins.
- **It is deterministic.** The same theme always produces the same file, byte for byte. Diffs in a
  user's repository stay small, and golden files can pin the output.
- **Its header names the target.** The header comment names the Starlight version that the file
  targets, and it ends with one line that links back to the tool. Users may delete that line.

The header of every export looks like this:

```css
/*
 * Starlight Visual Customizer
 * Target: Starlight 0.42.4 (@astrojs/starlight)
 * Load via the `customCss` option in astro.config.mjs.
 * Unlayered, deterministic output - only diffs from Starlight's own defaults are emitted.
 * Made with the Starlight Visual Customizer: https://projects.prisantlabs.com/starlight-visual-customizer/
 */
```

Below the header, colors become Starlight's own custom properties on `:root`, such as
`--sl-color-accent`. Other controls become rules on the selectors that Starlight's components use.
`app/tests/golden/` holds five complete examples.

## `APPLY-THEME.md`

`app/src/customizer/core/emit-apply.js` writes `APPLY-THEME.md`. It is a set of numbered steps
that a person or a coding agent follows inside the target Starlight project. Its first line asks
the reader to paste the whole file to a coding agent.

The steps are idempotent: applying them twice gives the same result as applying them once. Each
document has these parts, and it includes a step only when the theme needs it:

1. **A version gate.** The document names the Starlight version it was generated for. It tells
   the reader to stop and ask if the installed minor version differs.
2. **Preconditions.** Confirm that the project uses Starlight, find `astro.config.mjs` or
   `astro.config.ts`, and note whether a `customCss` array exists.
3. **Add the theme CSS.** Copy `theme.css` to `src/styles/theme.css`, then add it as the **last**
   entry of `customCss`, without a duplicate on a re-run.
4. **Install the chosen fonts,** when the theme uses a web font other than the default. Each font
   is an `@fontsource-variable/<font>` package plus its CSS import.
5. **Update Starlight config options,** for settings that only work at build time. Examples are
   `tableOfContents`, `pagination`, the site `title` and the `expressiveCode` themes. Only keys
   that differ from Starlight's defaults appear.
6. **Replace the sidebar navigation,** when the theme changed the sidebar in the Structure editor.
   The document gives the whole `sidebar` array, so a re-run replaces it with the same array.
7. **Verification.** Build the site, then check a list of selectors and the values they should now
   show.
8. **Rollback.** The document lists every file that the steps touch.

The document ends with the same link line as `theme.css`.

`app/tests/golden/apply-default.md` shows the shortest document, and
`app/tests/golden/apply-full.md` shows one that uses every step.

## The state file

The state file is the theme's settings as JSON, for importing later. The dialog's tab is labeled
`state.json`, but **Download** saves the file as `starlight-theme.json`.

The state is a `ThemeState` object, defined in `app/src/customizer/core/state.js`:

| Field | Meaning |
|---|---|
| `v` | The state format's version, currently `1` |
| `starlight` | The Starlight version the theme was made for, such as `'0.42.4'` |
| `preset` | The id of the preset the theme started from |
| `values` | Every control that differs from its default, keyed by control id |
| `ia` | The sidebar tree from the Structure editor, or `null` when the theme keeps the default sidebar |
| `meta.name` | The theme's name, which the top bar edits |

The control ids, and the range or options each control accepts, come from the control manifest in
`app/src/customizer/core/manifest.js`. An imported file passes through `sanitizeState` first, so a
value outside its control's range or options never reaches the studio.

## Share links

A share link carries the whole theme in its URL fragment, after `#svc=`. The fragment is the
base64url encoding of the state as JSON (`encodeState` in `app/src/customizer/core/state.js`).
Browsers never send a fragment to a server.

- **Copy share link** builds the URL from the current page, the `?page=` value of the page the
  studio shows, and the theme. No other query parameter travels with it. `buildShareUrl` in
  `app/src/customizer/core/share-link.js` builds it.
- **Opening a link** applies its theme directly when nothing worth keeping is saved in the
  browser. That covers nothing saved, the defaults that a first visit saves, or the same theme.
- **When the link's theme differs from a saved theme,** the studio keeps the saved theme and asks
  **Open the shared theme?** The **Keep my theme** button has focus. Keep my theme, Escape and a
  click on the backdrop all keep the saved theme. **Open shared theme** is one undo step.
- **A link that cannot be read,** usually because it was cut off in transit, keeps the saved theme.
  The studio says that the link is damaged.
- **The studio removes the fragment from the address** once it has read it. A reload therefore
  never brings back a stale link's theme over later edits. Share with **Copy share link**, not with
  the address bar.

`resolveInitialTheme` in `app/src/customizer/core/share-link.js` holds these rules.

A link to the product page that carries a theme, `/#svc=...`, still opens the theme. An inline
script in the product page's head forwards the link to `/studio/`, with its query and fragment,
before the page paints.

## PNG screenshots

**Screenshot (PNG)** in the Export dialog captures the previewed page at its real width, in its
current light or dark mode. It offers two modes:

- **Full page** captures the whole scroll height. It is the accurate choice.
- **Visible area** captures what the frame shows now, including a scrolled position. The fixed
  header, the left sidebar with its own scroll position and the right table of contents all keep
  their real places. The theme and language menus show their current values.

The file is named from the theme, the page, the mode and the width, such as
`ocean-breeze-specimen-dark-1440.png`.

The capture draws the page into an image inside the browser, with the `modern-screenshot`
package, which loads only when it is first used. So it has limits: a large page such as Document
can take 30 seconds or more, and an effect such as `backdrop-filter` may be missing. For a
pixel-exact image, use the browser's own screenshot tool.

## How the export is proven

`npm run test:roundtrip` applies a real export to a freshly scaffolded Starlight site. Then it
compares the computed styles on that site with the studio's live preview. The round trip checks
that the steps reproduce what the user saw, not only that they read correctly.
[`docs/testing.md`](testing.md#the-round-trip) covers it.
