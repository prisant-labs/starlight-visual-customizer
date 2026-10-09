# Changelog

This file lists the notable changes in each release. Each release also has fuller notes for people
who use the studio: on the [Releases page](https://github.com/prisant-labs/starlight-visual-customizer/releases),
and in [`docs/releases/`](docs/releases/README.md), one file per release. Version numbers follow
[semantic versioning](https://semver.org/); before 1.0, a minor release can change behavior.

## Unreleased

- **Security: the build uses `sharp` 0.35.5.** Astro's image service runs `sharp` while the site
  builds. Version 0.35.4 carried a flaw in its SVG library, librsvg. The build processes only the
  project's own images, and `sharp` never runs in a visitor's browser, so the live site was not
  exposed.

## [0.1.1] - 2026-10-09

Release notes: [`docs/releases/v0.1.1.md`](docs/releases/v0.1.1.md).

- **Starlight 0.42.6 and Astro 7.3.8.** The studio now previews Starlight 0.42.6, built with Astro
  7.3.8, and every export names 0.42.6 as its target. Themes made with 0.1.0 still load and apply:
  Starlight's stylesheets changed only to stop icons from being cut off in Firefox.

## [0.1.0] - 2026-10-08

Release notes: [`docs/releases/v0.1.0.md`](docs/releases/v0.1.0.md).

The first release. It targets Starlight 0.42.4 and Astro 7.3.5.

- **The studio.** It previews a real Starlight site while you edit, on four sample pages: a style
  guide, a long document, a landing page and the 404 page. The preview shows light mode, dark mode,
  or both side by side, at device widths from 390 to 2560 pixels. The top bar holds Import,
  Screenshot, Share and Export.
- **Controls and presets.** 78 controls in 11 groups cover colors, typography, layout, the header,
  the sidebar, the table of contents, content, components, code, the footer and page options.
  Nine presets give a starting point, and every value stays editable.
- **Inspect.** Clicking an element in the preview opens the controls that style it.
- **Export.** The Export dialog leads with two ways to get a theme onto your own site, each one
  click. "Copy for your coding agent" copies one message with the setup steps and the whole
  stylesheet inlined, ready to paste into Claude Code, Codex, Cursor or a similar agent. "Download
  the files (.zip)" downloads one folder with `theme.css`, for Starlight's `customCss` option, and
  `APPLY-THEME.md`, with numbered steps to apply it. The other exports are a settings file,
  `<theme-name>.customizer.json`, to import later, and a PNG screenshot of the preview, in light or
  dark mode, of the visible area or the full page. A file viewer shows every file in its own tab,
  with Copy and Download. `theme.css` names the tool, with a link, in its header comment, and
  `APPLY-THEME.md` and the agent message end with the same line. You can delete it.
- **Share links.** A share link carries the whole theme and the page you were viewing. Opening one
  asks before it replaces a theme you have already saved. Every theme that arrives from outside
  the studio, from a share link, a saved theme or an imported file, is checked against the
  controls before it reaches an export. So a crafted link cannot add code, steps or CSS rules to
  the exported files or the agent message, and its sidebar links can only point to web, mail or
  relative addresses.
- **The site.** A product page sits at the root, the studio at `studio/`, and the demo docs site
  under `demo/`. The studio, the product page and the About page carry the project's logo, and
  links to the site show a social preview card.
- **Tests.** Unit tests cover the emitters, the core logic and the checks on outside themes.
  Browser suites cover every control and the Export dialog on Chromium, and six of the suites also
  run on Firefox and WebKit. A round-trip test applies real exports to a freshly created Starlight
  site and compares the result with the studio's preview.

[0.1.1]: https://github.com/prisant-labs/starlight-visual-customizer/releases/tag/v0.1.1
[0.1.0]: https://github.com/prisant-labs/starlight-visual-customizer/releases/tag/v0.1.0
