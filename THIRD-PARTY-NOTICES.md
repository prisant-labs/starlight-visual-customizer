# Third-party notices

This project (the "Software") is licensed under the MIT License (see `LICENSE`). It bundles,
depends on, or is derived from the third-party software listed below. Each entry was verified
against the license file actually installed in `app/node_modules/<package>` (or, for web fonts
loaded at runtime, against Fontsource's own metadata) on 2026-09-26, against the versions pinned
in `app/package.json` at that time - not from memory or assumption.

Full license text for each license family appears once, in [Appendix: full license texts](#appendix-full-license-texts).

## Runtime dependencies (`app/package.json` `dependencies`)

| Package | Version | License | Copyright |
|---|---|---|---|
| [astro](https://github.com/withastro/astro) | 7.3.5 | MIT | (c) 2021 Fred K. Schott |
| [@astrojs/starlight](https://github.com/withastro/starlight) | 0.42.4 | MIT | (c) 2023 [Astro contributors](https://github.com/withastro/starlight/graphs/contributors) |
| [culori](https://github.com/Evercoder/culori) | 4.0.2 | MIT | (c) 2018 Dan Burzo |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | (c) Arjun Barrett |
| [modern-screenshot](https://github.com/qq15725/modern-screenshot) | 4.7.0 | MIT | (c) 2021-present wxm |
| [sharp](https://github.com/lovell/sharp) | 0.35.4 | Apache-2.0 | (c) Lovell Fuller and contributors |
| [vanilla-colorful](https://github.com/web-padawan/vanilla-colorful) | 0.7.2 | MIT | (c) 2020 Serhii Kulykov |

Notes:

- `astro`, `@astrojs/starlight`, `culori`, `fflate`, `modern-screenshot`, and `vanilla-colorful`
  ship in the built site (`app/dist/`) or run in the browser as part of the customizer.
- `sharp` is a **build-time only** dependency: Astro's built-in image service uses it to process
  image assets (for example `app/src/assets/houston.webp`) while running `astro build`. It is not
  loaded in the browser and no `sharp` code ships in `dist/`. Its prebuilt platform binary for this
  project's dev environment, `@img/sharp-win32-x64`, is dual-licensed **Apache-2.0 AND
  LGPL-3.0-or-later** because it wraps the `libvips` image library; `@img/colour`, one of `sharp`'s
  small pure-JS helper dependencies, is MIT and itself credits `color` (c) 2012 Heather Arthur.
  These sub-dependencies are listed here for completeness even though, like `sharp` itself, they
  never reach the browser.

## Dev dependency used by the test suites (`app/package.json` `devDependencies`)

| Package | Version | License | Copyright |
|---|---|---|---|
| [playwright-core](https://github.com/microsoft/playwright) | 1.63.0 | Apache-2.0 | (c) Microsoft Corporation |

`playwright-core` drives the browser for every e2e suite under `app/tests/e2e/` and the round-trip
suite under `app/tests/roundtrip/`. It is not part of the shipped site. Its own `NOTICE` file
states it contains code derived from the Puppeteer project, also Apache-2.0.

## Bundled by Starlight, shipped in the built site

These are not direct dependencies of this project; `@astrojs/starlight` depends on them, and their
output (generated code, CSS, and a prebuilt search index) is written into `app/dist/` by `astro
build`.

| Package | Version | License | Copyright |
|---|---|---|---|
| [expressive-code](https://github.com/expressive-code/expressive-code) (`expressive-code`, `@expressive-code/core`, `astro-expressive-code`, `rehype-expressive-code`) | 0.44.2 | MIT | (c) 2023 Tibor Schiemann |
| [Shiki](https://github.com/shikijs/shiki) (`shiki`, `@shikijs/*`) | 4.4.3 | MIT | (c) 2021 Pine Wu, (c) 2023 Anthony Fu |
| [Pagefind](https://github.com/CloudCannon/pagefind) (`pagefind`, `@pagefind/default-ui`) | 1.5.2 | MIT | (c) Pagefind |

Expressive Code renders this site's syntax-highlighted code blocks, using Shiki as its underlying
highlighter (Shiki's output - colored `<span>`s and CSS - is what actually lands in `dist/`; no
Shiki JS ships to the browser). Pagefind builds the static search index used by the site's search
box; its platform packages (for example `@pagefind/windows-x64`) bundle `vscode-ripgrep` (Microsoft,
MIT) as a build-time indexing tool - `vscode-ripgrep` itself does not ship in `dist/`, only the
search index Pagefind produces does.

## Code ported from Starlight's official theme designer

`app/src/customizer/core/color.js` and `app/src/customizer/core/presets.js` are a port of the color
algorithm and preset values from `@astrojs/starlight`'s own theme designer
(`docs/src/components/theme-designer/color-lib.ts`, `store.ts`, and `presets` in
[withastro/starlight](https://github.com/withastro/starlight/tree/main/docs/src/components/theme-designer)),
rewritten as plain, DOM-free ESM JS so it runs in this project's own state/preview pipeline and in
`node --test`. The numeric constants (lightness stops, chroma dividers, the contrast-nudge
increment, the contrast-check pairs, and every preset's hue/chroma values) are copied verbatim from
that source so generated palettes match the official designer's output exactly for the same inputs.
`withastro/starlight` is MIT-licensed, copyright (c) 2023 Astro contributors (same as the
`@astrojs/starlight` entry above) - see each file's own header comment for the exact upstream path.

## Image asset

`app/src/assets/houston.webp` is byte-identical (verified by SHA-256) to
`examples/basics/src/assets/houston.webp` in the
[withastro/starlight](https://github.com/withastro/starlight) repository - the Houston mascot image
Starlight's own official starter template ships. It is used here unmodified as this project's demo
site's illustration. `withastro/starlight` is MIT-licensed, copyright (c) 2023 Astro contributors
(see the `@astrojs/starlight` entry above).

## Web fonts (loaded at runtime, not bundled)

The Typography controls (`app/src/customizer/ui/tiles/fonts.js`, font list in
`app/src/customizer/core/manifest.js`) let a user preview and export any of the following fonts.
Font **faces are never bundled** in this repository or in `dist/`: the studio's live preview loads
each variable-font file on demand from `cdn.jsdelivr.net/fontsource/...`, and an exported theme's
`APPLY-THEME.md` instructs the user to add the matching `@fontsource-variable/<id>` npm package to
their own Starlight project if they keep a non-default font. Only the font **names** and their
Fontsource package ids are stored in this repository's source.

All 12 are distributed by [Fontsource](https://fontsource.org/) (a redistribution of Google Fonts).
Licenses below were read live from Fontsource's own font-metadata API
(`https://api.fontsource.org/v1/fonts/<id>`) on 2026-09-26, not assumed from general Google Fonts
convention:

| Font | Fontsource package | License |
|---|---|---|
| Inter | `@fontsource-variable/inter` | SIL Open Font License 1.1 |
| Manrope | `@fontsource-variable/manrope` | SIL Open Font License 1.1 |
| Work Sans | `@fontsource-variable/work-sans` | SIL Open Font License 1.1 |
| Figtree | `@fontsource-variable/figtree` | SIL Open Font License 1.1 |
| Lora | `@fontsource-variable/lora` | SIL Open Font License 1.1 |
| Source Serif 4 | `@fontsource-variable/source-serif-4` | SIL Open Font License 1.1 |
| Playfair Display | `@fontsource-variable/playfair-display` | SIL Open Font License 1.1 |
| Newsreader | `@fontsource-variable/newsreader` | SIL Open Font License 1.1 |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` | SIL Open Font License 1.1 |
| Fira Code | `@fontsource-variable/fira-code` | SIL Open Font License 1.1 |
| Spline Sans Mono | `@fontsource-variable/spline-sans-mono` | SIL Open Font License 1.1 |
| Red Hat Mono | `@fontsource-variable/red-hat-mono` | SIL Open Font License 1.1 |

General rule, if this list ever grows: most fonts Fontsource redistributes are SIL OFL 1.1, but not
all are (some are Apache-2.0 or other permissive licenses) - check
`https://api.fontsource.org/v1/fonts/<id>` (field `license`) or the font's page at
[fontsource.org](https://fontsource.org/) before adding it to `manifest.js`'s `FONTS` list, rather
than assuming OFL.

## Appendix: full license texts

### MIT License

Applies to: astro, @astrojs/starlight (and the Starlight-derived color/presets port and
houston.webp), culori, fflate, modern-screenshot, vanilla-colorful, expressive-code family, Shiki,
pagefind family, @img/colour.

```
MIT License

Copyright (c) <year> <copyright holder(s) listed above for each package>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License, Version 2.0

Applies to: sharp, playwright-core, and (as part of sharp's platform binaries) the Apache-2.0 half
of `@img/sharp-win32-x64`'s dual license. Full text:
<https://www.apache.org/licenses/LICENSE-2.0>. Also see `app/node_modules/sharp/LICENSE` and
`app/node_modules/playwright-core/LICENSE` as installed.

### GNU Lesser General Public License, Version 3 (LGPL-3.0-or-later)

Applies to: the `libvips` portion of `sharp`'s prebuilt platform binary (`@img/sharp-win32-x64` and
equivalent packages for other platforms), combined under "Apache-2.0 AND LGPL-3.0-or-later" per that
package's own `package.json`. Build-time only; not distributed in `app/dist/`. Full text:
<https://www.gnu.org/licenses/lgpl-3.0.html>.

### SIL Open Font License, Version 1.1

Applies to: the 12 Fontsource web fonts listed above. Full text:
<https://openfontlicense.org/> (also mirrored at
<https://scripts.sil.org/OFL>).
