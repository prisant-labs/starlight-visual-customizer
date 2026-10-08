# Export format

The studio exports a theme as a set of files for the user's own Astro site, a settings file and a
share link for the customizer itself, and optional PNG screenshots. This page describes each one
and the code that writes it. [`docs/security-model.md`](security-model.md) explains how the studio
keeps untrusted input out of these files.

## The Export dialog

The top bar's **Export** button, or `Ctrl+E` (`Cmd+E` on a Mac), opens the Export dialog. The top
bar's **Screenshot** and **Share** buttons open the same dialog, each already showing its own
export: Screenshot selects the Screenshot file tab and focuses Download PNG, and Share selects the
Settings file tab and focuses Copy share link. The dialog is built in
`app/src/customizer/ui/export.js`, from files that `app/src/customizer/core/export-files.js` builds
and names. The dialog's title reads `Export "<theme name>"`, with a subtitle made of the preset's
label and the change count, such as `Editorial Serif · 12 changes`.

The dialog has three parts:

1. **"For your Astro site"**, the main export, in two ways, each one click:
   - **"Copy for your coding agent"** copies the agent message: one Markdown message that holds the
     `APPLY-THEME.md` steps, with the whole stylesheet inlined at the end. See "The agent message"
     below.
   - **"Download the files (.zip)"** downloads `theme.css` and `APPLY-THEME.md` in one folder. See
     "The zip" below.
2. **"Other exports"**, in a quieter column: the customizer's own settings, as a settings file or a
   share link, and a screenshot of the preview. See "The settings file", "Share links" and "PNG
   screenshots" below.
3. **A file viewer with a tab for every file:** Agent message, Stylesheet, Setup steps, a divider,
   Settings file, and Screenshot. Each text tab has a Copy icon and a Download button; the
   Screenshot tab has Download only.

A status line replaces the line under the action it confirms, returns to that line after seven
seconds, and is announced through a live region for assistive technology.

**Import** is not in this dialog. It lives in the studio's top bar, and in the overlay panel's own
toolbar as "Import…".

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
`app/tests/golden/` holds six complete examples.

## `APPLY-THEME.md`

`app/src/customizer/core/emit-apply.js` writes `APPLY-THEME.md`. It is a set of numbered steps
that a person or a coding agent follows inside the target Starlight project.

`emitApplyTheme` builds two deliveries from the same steps, through its `delivery` option:

- **`'files'`** (the default) is the document that sits beside `theme.css` in the zip, or is
  downloaded on its own. It opens with this line:

  > **Use these steps with the `theme.css` file in this folder. Make the changes yourself, or ask
  > a coding agent in your Starlight project to read this file and follow every step in order.**

  Its first step tells the reader to copy that file.

- **`'message'`** is the agent message (see "The agent message" below). It opens with this line:

  > **Apply this Starlight theme to the project you have open. Follow every step below in order.
  > The theme's CSS is in the last section of this message, "theme.css".**

  Its first step tells the reader to write the CSS from that section, line for line, instead of
  copying a file.

Every other step is identical between the two. The steps are idempotent: applying them twice gives
the same result as applying them once. Each document has these parts, and it includes a step only
when the theme needs it:

1. **A version gate.** The document names the Starlight version it was generated for. It tells
   the reader to stop and ask if the installed minor version differs.
2. **Preconditions.** Confirm that the project uses Starlight, find `astro.config.mjs` or
   `astro.config.ts`, and note whether a `customCss` array exists.
3. **Add the theme CSS.** Add `theme.css` to `src/styles/theme.css`, by the method its delivery
   calls for, then add it as the **last** entry of `customCss`, without a duplicate on a re-run.
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

The `'files'` delivery ends with the same link line as `theme.css`. The `'message'` delivery adds
one more section first: see "The agent message" below.

`app/tests/golden/apply-default.md` shows the shortest `'files'` document, and
`app/tests/golden/apply-full.md` shows one that uses every step.

## The agent message

**"Copy for your coding agent"** copies one Markdown message to the clipboard: the `'message'`
delivery of `emitApplyTheme`. It is meant to be pasted whole into a coding agent such as Claude
Code, Codex or Cursor, with the user's Starlight project open. It holds the same steps as
`APPLY-THEME.md`, worded for that delivery, plus one more section at the end:

````markdown
## theme.css

Write this to `src/styles/theme.css` with these exact lines and LF line endings. Then check it:
the file has N lines, and its first line is `...`.

```css
...the whole stylesheet...
```
````

The code fence around the CSS is chosen by `fenceFor`, exported from `emit-apply.js`: at least
three backticks, and one more than the longest run of backticks already inside the CSS. So no run
inside the CSS can close the fence early. [`docs/security-model.md`](security-model.md) covers why
this matters.

The message downloads as `<slug>.agent-message.md`, from its own tab in the file viewer.
`app/tests/golden/agent-message-full.md` shows the agent message for the same theme as
`apply-full.md`.

## The zip

**"Download the files (.zip)"** downloads `<slug>.zip`, built in the browser by the `fflate`
package's `zipSync`. The zip holds one folder, named after the theme, with exactly two files
inside it: `theme.css` and `APPLY-THEME.md`. The settings file is not in the zip, because the
site that receives the export never reads it. `buildZip` in
`app/src/customizer/core/export-files.js` builds it from the same files the dialog's tabs show.

## The settings file

**"Download settings file"** downloads the theme's settings as JSON, named `<slug>.customizer.json`.
This file is for the customizer itself, not for the user's Astro site: reopening it with **Import**
loads the same theme back into the studio for further editing.

The slug comes from `slugifyThemeName` in `app/src/customizer/core/export-files.js`: the theme name,
lowercased, with each run of characters that are not `a`-`z` or `0`-`9` turned into one hyphen, and
leading or trailing hyphens trimmed. A name that leaves nothing usable, such as an empty name or one
made only of punctuation, falls back to `starlight-theme`.

The settings file is a `ThemeState` object, defined in `app/src/customizer/core/state.js`:

| Field | Meaning |
|---|---|
| `v` | The state format's version, currently `1` |
| `starlight` | The Starlight version the theme was made for, such as `'0.42.4'` |
| `preset` | The id of the preset the theme started from |
| `values` | Every control that differs from its default, keyed by control id |
| `ia` | The sidebar tree from the Structure editor, or `null` when the theme keeps the default sidebar |
| `meta.name` | The theme's name, which the top bar edits |

The control ids, and the range or options each control accepts, come from the control manifest in
`app/src/customizer/core/manifest.js`. **Import**, in the studio's top bar and in the overlay
panel's own toolbar, reads a settings file back in. An imported file passes through
`sanitizeState` first, so a value outside its control's range or options never reaches the studio.

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

The "Screenshot" group in "Other exports" captures the previewed page at its real width. In the
studio, a small preview picture renders as soon as the dialog opens, and the Screenshot tab shows
a larger copy of it. Outside the studio, neither one renders a preview; a note says so, and
**Download PNG** still works. **Options** folds open **Appearance** (Light or Dark) and
**Page area** (Visible area or Full page). The dialog opens with Visible area selected, in the
mode the preview currently shows.

- **Visible area** captures what the frame shows now, including a scrolled position. The fixed
  header, the left sidebar with its own scroll position and the right table of contents all keep
  their real places. The theme and language menus show their current values.
- **Full page** captures the whole scroll height. It is the accurate choice, and it can take several
  seconds on a long page such as the Document demo page.

**Download PNG** names the file from the theme, the page, the mode and the width, such as
`ocean-breeze-specimen-dark-1440.png`.

The small preview picture is itself a visible-area capture, kept together with what it depends on:
the CSS, the mode, the page, the scroll position and the window size. When the view has not
changed since, **Download PNG** for the visible area reuses that same picture instead of rendering
the page a second time, which is what keeps a long page's capture to one render, not two. A dark
picture of a light preview switches the preview to dark for the capture and switches it back
afterward, restoring the saved `starlight-theme` value; in Split view, the dark lane is captured
directly and nothing switches. Captures run one at a time, and a small preview that is still
queued when the dialog closes is skipped rather than run after the fact.

The capture draws the page into an image inside the browser, with the `modern-screenshot`
package, which loads only when it is first used. So it has limits: an effect such as
`backdrop-filter` may be missing. For a pixel-exact image, use the browser's own screenshot tool.

## How the export is proven

`npm run test:roundtrip` applies a real export to a freshly scaffolded Starlight site. Then it
compares the computed styles on that site with the studio's live preview. The round trip checks
that the steps reproduce what the user saw, not only that they read correctly.
[`docs/testing.md`](testing.md#the-round-trip) covers it.
