# Changelog

This file lists the notable changes in each release. Each release also has fuller notes for people
who use the studio: on the [Releases page](https://github.com/prisant-labs/starlight-visual-customizer/releases),
and in [`docs/releases/`](docs/releases/README.md), one file per release. Version numbers follow
[semantic versioning](https://semver.org/); before 1.0, a minor release can change behavior.

## Unreleased

- **A redesigned Export dialog.** It leads with two one-click ways to get a theme onto your own
  site: "Copy for your coding agent" copies one message with the setup steps and the whole
  stylesheet inlined, ready to paste into Claude Code, Codex, Cursor or similar; "Download the
  files (.zip)" downloads `theme.css` and `APPLY-THEME.md` in one folder. The customizer's own
  settings and share link, and a screenshot of the preview, move to a quieter "Other exports"
  section. A file viewer below shows every file in its own tab, each with its own Copy and
  Download.
- **The settings file has a new name.** Downloading it now saves `<theme-name>.customizer.json`
  instead of `starlight-theme.json`, and it is no longer included in the zip, since your site
  never reads it.
- **A screenshot preview in the studio.** The Export dialog renders a small picture of the preview
  as soon as it opens, and its Screenshot tab shows a larger copy. Options for Appearance (Light
  or Dark) and Page area (Visible area or Full page) sit behind an "Options" toggle.
- **Screenshot and Share move to the top bar,** next to Import and Export, each opening the Export
  dialog already showing its own export. Import is no longer inside the dialog.
- **The final logo.** The project's logo replaces the placeholder star in the studio's top bar,
  on the About page and as the favicon. The product page shows it too.
- **A new social preview card** for links to the site and the repository.

## [0.1.0] - 2026-10-03

Release notes: [`docs/releases/v0.1.0.md`](docs/releases/v0.1.0.md).

The first release. It targets Starlight 0.42.4 and Astro 7.3.5.

- **The studio.** It previews a real Starlight site while you edit, on four sample pages: a style
  guide, a long document, a landing page and the 404 page. The preview shows light mode, dark mode,
  or both side by side, at device widths from 390 to 2560 pixels.
- **Controls and presets.** 78 controls in 11 groups cover colors, typography, layout, the header,
  the sidebar, the table of contents, content, components, code, the footer and page options.
  Nine presets give a starting point, and every value stays editable.
- **Inspect.** Clicking an element in the preview opens the controls that style it.
- **Export.** The studio exports `theme.css` for Starlight's `customCss` option, `APPLY-THEME.md`
  with numbered steps to apply it, a state file to import later, and a PNG screenshot.
  `theme.css` names the tool, with a link, in its header comment, and `APPLY-THEME.md` ends with
  the same line. You can delete either one.
- **Share links.** A share link carries the whole theme and the page you were viewing. Opening one
  asks before it replaces a theme you have already saved. Every theme that arrives from outside
  the studio, from a share link, a saved theme or an imported file, is checked against the
  controls before it reaches an export. So a crafted link cannot add code, steps or CSS rules to
  the exported files, and its sidebar links can only point to web, mail or relative addresses.
- **The site.** A product page sits at the root, the studio at `studio/`, and the demo docs site
  under `demo/`.
- **Tests.** Unit tests cover the emitters, the core logic and the checks on outside themes.
  Browser suites cover every control on Chromium, and six of the suites also run on Firefox and
  WebKit. A round-trip test applies real exports to a freshly created Starlight site and compares
  the result with the studio's preview.

[0.1.0]: https://github.com/prisant-labs/starlight-visual-customizer/releases/tag/v0.1.0
