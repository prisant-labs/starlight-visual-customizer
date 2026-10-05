# AGENTS.md

Instructions for coding agents that work in this repository. The documents under
[`docs/`](docs/README.md) cover the same ground in more depth, and this file links to them.

## What this is

- **Starlight Visual Customizer** is a visual theme editor for
  [Astro Starlight](https://starlight.astro.build/) docs sites. It previews a real Starlight build
  in a frame and exports `theme.css`, `APPLY-THEME.md` and a state file.
- **It runs entirely in the browser.** There is no server, no account and no database. The site is
  a static build on GitHub Pages.
- **The app lives in `app/`.** It uses Astro 7.3.5 and Starlight 0.42.4, both pinned exactly, on
  Node 22.
- **The live site** is <https://projects.prisantlabs.com/starlight-visual-customizer/>. It has the
  product page at `/`, the studio at `/studio/`, the About page at `/about/`, and the demo site
  "Orbit Docs" under `/demo/`.

## Where to look

| Question | Document |
|---|---|
| Where is the code that does X? | [`docs/architecture.md`](docs/architecture.md) |
| What does each part of the studio do? | [`docs/studio.md`](docs/studio.md) |
| How do I run the app, or serve it under a sub-path? | [`docs/development.md`](docs/development.md) |
| Which tests cover what, and how do I run them? | [`docs/testing.md`](docs/testing.md) |
| What exactly does an export contain? | [`docs/export-format.md`](docs/export-format.md) |
| How does the studio handle untrusted themes? | [`docs/security-model.md`](docs/security-model.md) |
| Why is something built the way it is? | [`docs/decisions/`](docs/decisions/README.md) |
| How is a release made? | [`docs/releasing.md`](docs/releasing.md) |

## Commands

Run every command from `app/`.

```bash
npm install
npm run dev:bg        # dev server with hot reload, in the background, on port 4700
npm run build         # production build into dist/
npm run preview:bg    # serve dist/ in the background, on port 4420
npm run dev:stop      # and preview:stop; also dev:status, dev:logs, preview:status, preview:logs
```

Start servers with the `:bg` scripts. They return at once, and `status`, `stop` and `logs` manage
the server that was started from this folder. Do not start a foreground `npm run dev` or
`npm run preview`, because it blocks until it is stopped.

```bash
npm test                        # 273 unit tests in Node; no browser or server needed
node tests/e2e/<suite>.mjs      # one browser suite, against the preview on port 4420
npm run test:roundtrip          # apply a real export to a fresh Starlight site and compare
npm run golden:update           # rewrite the golden export files after an intended change
```

Run the browser suites one at a time, against one preview server. Rebuild with `npm run build`
before you run them, because the preview serves the last build, not the source.

## Before you open a pull request

- **`npm test` must pass.** CI runs it, plus a production build, as the required check "Unit tests
  and build". A pull request cannot merge until that check passes.
- **Run the browser suites that cover your change,** and list them in the pull request. CI does
  not run them. [`docs/testing.md`](docs/testing.md) says what each suite covers.
- **If export output changed on purpose,** run `npm run golden:update`, read the diff in
  `app/tests/golden/`, and run `npm run test:roundtrip`.
- **If users will notice the change,** add an entry under an "Unreleased" heading at the top of
  `CHANGELOG.md`. Create the heading if it is missing.
- **If behavior or a test count changed,** update the documents that describe it. Test counts
  appear in `README.md` and `docs/testing.md`.

## Rules that protect users

- **Check every theme from outside the studio.** A share link, a saved theme and an imported file
  all pass through `sanitizeState` in `app/src/customizer/core/state.js`. A new way to load a theme
  must pass through it too. The exporters keep their own output guards as well.
  [`docs/security-model.md`](docs/security-model.md) explains both layers.
- **Treat `APPLY-THEME.md` as instructions that another agent will execute.** Nothing from a theme
  may become code, configuration or a new step in it.
- **Keep the privacy promise.** The studio's only third-party requests load web-font previews from
  jsDelivr, and the product page self-hosts its font. Do not add analytics, trackers, or assets from
  another host.
- **Keep export output stable.** `theme.css` is deterministic and unlayered, and it holds only the
  differences from Starlight's defaults. The golden files pin it.
- **Do not upgrade Starlight or Astro without agreement.** The studio targets one Starlight version.
  A unit test compares `app/src/customizer/core/version.js` with the installed package, and the
  version string also appears in documents, badges and the issue form.

## Code conventions

- **Modules in `app/src/customizer/core/` stay free of the DOM,** because the unit tests import them
  in Node. Code that touches the page belongs in `app/src/customizer/ui/`.
- **Build every internal URL with `withBase()`,** from `app/src/customizer/core/base-path.js`, so
  the app works under a sub-path. Never set a plain `BASE_URL` variable when you build.
- **Code that themes the preview reaches the frame through `app/src/customizer/ui/page-doc.js`,**
  not through the studio's own `document`.
- **Leave `/about/` out of `app/src/content/docs/`.** A page there would join the demo site.
  [Decision 0006](docs/decisions/0006-standalone-about-page.md) explains why.
- **Treat the demo site as a test fixture.** The pages under `app/src/content/docs/demo/` feed the
  browser suites, so a content change there can change test results.
- **Browser tests use real input.** Drive `page.mouse` and `page.keyboard` at element centers. Do
  not call `.click()` from a script, because some behavior only reproduces under a real click.

## Repository conventions

- **Commit messages** follow the history's style: `fix(app): ...`, `feat(app): ...`, `docs: ...`,
  `test(app): ...` or `chore: ...`.
- **`main` is protected.** Every change arrives through a pull request, and pull requests merge as
  merge commits.
- **Files use LF line endings.**
- **Documents use short, complete sentences,** and they give a pull request number a short handle,
  such as "PR #23 (export sanitizer)".

## Astro and Starlight documentation

Read the official documentation before you work on these areas:

- [Starlight: CSS and styling](https://starlight.astro.build/guides/css-and-tailwind/), including
  `customCss`
- [Starlight: overriding components](https://starlight.astro.build/guides/overriding-components/)
- [Starlight: sidebar configuration](https://starlight.astro.build/guides/sidebar/)
- [Astro: routing](https://docs.astro.build/en/guides/routing/)
- [Astro: components](https://docs.astro.build/en/basics/astro-components/)
- [Astro: content collections](https://docs.astro.build/en/guides/content-collections/)
- [Astro: styling](https://docs.astro.build/en/guides/styling/)
