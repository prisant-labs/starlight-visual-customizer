# Changelog

This file lists the notable changes in each release. Each release also has a page with fuller
notes on the [Releases page](https://github.com/prisant-labs/starlight-visual-customizer/releases).
Version numbers follow [semantic versioning](https://semver.org/); before 1.0, a minor release
can change behavior.

## 0.1.0 - 2026-10-02

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
  asks before it replaces a theme you have already saved. Sidebar links that arrive in a share
  link can only point to web, mail or relative addresses.
- **The site.** A product page sits at the root, the studio at `studio/`, and the demo docs site
  under `demo/`.
- **Tests.** Unit tests cover the emitters and the core logic. Browser suites cover every control
  on Chromium, and six of the suites also run on Firefox and WebKit. A round-trip test applies real exports
  to a freshly created Starlight site and compares the result with the studio's preview.
