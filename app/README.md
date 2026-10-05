# Starlight Visual Customizer: the app

This folder is the whole application. It is an Astro site with a product page, the studio, an
About page, and a Starlight demo site that the studio themes. The repository's
[README](../README.md) introduces the project, and [`docs/`](../docs/README.md) documents it in
full.

- **Pinned:** `@astrojs/starlight` 0.42.4, Astro 7.3.5, Node 22, and `vanilla-colorful` 0.7.2 for the
  color popover.

## Quick start

```bash
npm install          # first time only
npm run build        # build the site into dist/
npm run preview:bg   # serve dist/ in the background on http://localhost:4420
```

Open <http://localhost:4420/> for the product page, or <http://localhost:4420/studio/> for the
studio. Stop the preview with `npm run preview:stop`.

For hot reload while you edit, use `npm run dev:bg` instead, which serves on port 4700. Stop it
with `npm run dev:stop`.

## Where things live

| URL | Built by |
|---|---|
| `/` | `src/pages/index.astro`, the product page |
| `/studio/` | `src/pages/studio.astro`, the studio |
| `/about/` | `src/pages/about.astro`, the About page |
| `/demo/...` | `src/content/docs/demo/`, the "Orbit Docs" demo site |
| `/404/` | Starlight's built-in not-found page |

The customizer's code is in `src/customizer/`: `core/` holds the logic that runs without a
browser, and `ui/` holds everything that touches a page.

## Common commands

| Command | What it does |
|---|---|
| `npm test` | Runs the unit tests in Node |
| `npm run test:e2e` | Runs the 13 browser suites against the preview on port 4420 |
| `npm run test:roundtrip` | Applies a real export to a fresh Starlight site and compares it with the preview |
| `npm run golden:update` | Rewrites the golden export files after an intended change |

## More

- [`docs/development.md`](../docs/development.md): both servers, ports, and serving under a
  sub-path.
- [`docs/testing.md`](../docs/testing.md): every test suite and how to run it.
- [`docs/architecture.md`](../docs/architecture.md): where the code that does each thing lives.
- [`docs/studio.md`](../docs/studio.md): what each part of the studio does.

## License

MIT. See [`LICENSE`](../LICENSE) at the repository root, and
[`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) for third-party notices.
