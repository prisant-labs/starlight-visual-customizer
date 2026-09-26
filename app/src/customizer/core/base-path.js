/**
 * @file D3a - the one helper for internal URLs, so the app works unchanged at `/` and also under a
 * sub-path (e.g. a GitHub Pages project site at `https://<user>.github.io/<repo>/`). Built on
 * Astro's resolved base (`import.meta.env.BASE_URL`, set from `astro.config.mjs`'s `base`, itself
 * read from the `SVC_SITE_BASE` env var at build time - see astro.config.mjs's own comment).
 *
 * Every place in the customizer that turns a root-relative, BASE-FREE path (e.g. `/specimen/`,
 * `/studio/`) into something the browser actually navigates to (an `<a href>`, an `<iframe src>`,
 * `location.href`) must go through `withBase()`. Every place that reads an ACTUAL browser path back
 * (`location.pathname`, a frame's `contentWindow.location.pathname`) and needs to compare or store
 * it as one of this app's own base-free paths (STUDIO_PAGES, the `?page=` query value, `svc-ui`
 * sessionStorage) must go through `stripBase()` first. Keeping every base-free constant/comparison
 * base-free, and doing the conversion only at these two kinds of boundary, is what lets a saved
 * `?page=` link or `sessionStorage['svc-ui']` entry look identical at any base.
 *
 * `import.meta.env.BASE_URL`'s own trailing slash depends on the project's `trailingSlash` config
 * (Astro docs, "Changed default: import.meta.env.BASE_URL trailingSlash"): with `trailingSlash`
 * left at its default ("ignore", this project's setting), `BASE_URL` carries a trailing slash only
 * if the configured `base` itself has one. `normalizeBase` below accepts either shape.
 *
 * Both exports take the base as an optional second argument (default: the real `BASE_URL`) purely
 * so `tests/core/base-path.test.js` can exercise both trailing-slash shapes without a Vite runtime -
 * plain `node --test` has no `import.meta.env`, so `DEFAULT_BASE` below falls back to `'/'` there
 * (see its own comment for why it's written `import.meta.env && import.meta.env.BASE_URL`, not
 * `import.meta.env?.BASE_URL`).
 */

/** Astro's resolved base at THIS module's load time - `'/'` by default, `import.meta.env.BASE_URL`
 * once `astro.config.mjs` sets `base` from `SVC_SITE_BASE`. Falls back to `'/'` under plain Node
 * (no Vite `import.meta.env`), which is what `npm test` runs under.
 *
 * Written as `import.meta.env && import.meta.env.BASE_URL`, NOT `import.meta.env?.BASE_URL`: per
 * Vite's own build docs ("this variable is statically replaced during build so it must appear
 * exactly as-is"), a PRODUCTION build replaces the bare token `import.meta.env` and the exact
 * dotted `import.meta.env.BASE_URL` as two separate literal substitutions - optional chaining
 * (`?.`) produces a different AST node that this replacement does not match, so the whole
 * expression would survive into the shipped bundle unreplaced and silently evaluate to `undefined`
 * in the browser (where `import.meta.env` isn't a real thing), always falling back to `'/'` even
 * under a real sub-path build. `&&` short-circuits safely under plain Node too, where
 * `import.meta.env` is genuinely `undefined` (reading `.BASE_URL` off it would otherwise throw). */
const DEFAULT_BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

/** @param {string} base @returns {string} `base` with any trailing slash removed and a default of
 * `'/'` treated as `''` (nothing to prefix) - e.g. `/` -> `''`, `/repo` -> `/repo`, `/repo/` -> `/repo`. */
function normalizeBase(base) {
	const b = String(base ?? '/');
	return b === '/' ? '' : b.endsWith('/') ? b.slice(0, -1) : b;
}

/**
 * Prefixes a root-relative, base-free path with the configured base, for anything that will
 * actually be navigated to (`<a href>`, `<iframe src>`, `location.href`/`.src`).
 * @param {string} path A root-relative path, e.g. `/specimen/` or `/studio/`. A value that isn't
 *   root-relative (an external URL, a bare `#...` fragment, `?...`) is returned unchanged - there is
 *   nothing to prefix.
 * @param {string} [base] Defaults to the real `import.meta.env.BASE_URL`; pass an explicit value in
 *   tests.
 * @returns {string} e.g. `/specimen/` at the default `/` base, `/my-repo/specimen/` at base
 *   `/my-repo` or `/my-repo/`.
 */
export function withBase(path, base = DEFAULT_BASE) {
	const p = String(path ?? '');
	if (!p.startsWith('/')) return p;
	return `${normalizeBase(base)}${p}`;
}

/**
 * The inverse of `withBase`: strips the configured base back off an actual browser pathname (e.g.
 * `location.pathname`, `frame.contentWindow.location.pathname`), so it matches this app's own
 * base-free paths (STUDIO_PAGES, `?page=`, `sessionStorage['svc-ui']`).
 * @param {string} pathname
 * @param {string} [base] Defaults to the real `import.meta.env.BASE_URL`; pass an explicit value in
 *   tests.
 * @returns {string} `pathname` with the base removed. Unchanged if `pathname` doesn't start with the
 *   base (already base-free, or the base is `/`, which has nothing to strip).
 */
export function stripBase(pathname, base = DEFAULT_BASE) {
	const p = String(pathname ?? '');
	const b = normalizeBase(base);
	if (!b) return p;
	if (p === b) return '/';
	if (p.startsWith(`${b}/`)) return p.slice(b.length);
	return p;
}
