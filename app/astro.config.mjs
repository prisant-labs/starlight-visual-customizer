// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { fixtureSidebar } from './src/fixture-sidebar.mjs';

// Sub-path support: the base to deploy under, e.g. `/starlight-visual-customizer/` for
// a GitHub Pages project site at `https://<user>.github.io/<repo>/`. Defaults to `/` (today's
// behavior, unchanged). Deliberately a project-specific name, `SVC_SITE_BASE` - NEVER read a plain
// `BASE_URL` env var here: an inherited `BASE_URL` (meant for the e2e suites' own
// `SVC_BASE_URL`/`BASE_URL`, or for `tests/roundtrip`'s app-origin `BASE_URL`) was found to silently
// change `astro build`'s output to absolute internal links (see `tests/roundtrip/fresh-site.mjs`'s
// `freshSiteEnv()` for the empirical writeup) - this app's own config must never look at that name
// for anything.
const siteBase = process.env.SVC_SITE_BASE || '/';
// Optional: the deployed origin, e.g. `https://prisant-labs.github.io` - only needed for canonical
// URLs/sitemaps, never for internal navigation (every internal path goes through `base`/
// `import.meta.env.BASE_URL` via `src/customizer/core/base-path.js`'s `withBase`/`stripBase`, not
// through `site`). Left unset (Astro's own default) unless provided.
const siteUrl = process.env.SVC_SITE_URL || undefined;

// Astro's own base-path normalization (trailingSlash left at its default, "ignore" - see
// configuration-reference.mdx): `import.meta.env.BASE_URL` keeps a trailing slash only if `base`
// itself has one, and never appends one that wasn't there. The two head scripts below are plain
// STRINGS templated at config time (this file runs in Node, before any module import exists to
// share `base-path.js`'s runtime helper with) - `baseNoTrailingSlash` mirrors that same helper's
// `normalizeBase` exactly: `/` collapses to `''` so joining below never doubles a slash, and any
// other base keeps its content minus a trailing slash.
const baseNoTrailingSlash = siteBase === '/' ? '' : siteBase.replace(/\/$/, '');
// The site's own root, base-aware: `/` at the default base, `/starlight-visual-customizer/`
// under that sub-path - exactly what a top-level visit to the deployed root looks like either way.
const rootPath = `${baseNoTrailingSlash}/`;
const studioPath = `${baseNoTrailingSlash}/studio/`;

// No-flash preload: a tiny, synchronous, blocking inline script. Starlight renders `head` entries
// as the very first children of `<head>` (see
// `node_modules/@astrojs/starlight/dist/components/Page.astro`, before `<ThemeProvider />` and
// every built-in stylesheet), so this runs - and finishes - before the parser reaches anything
// else, i.e. before first paint. It reads the full preview CSS `panel.js` mirrored into
// `localStorage['svc-css']` on the *previous* page and paints it as `<style id="svc-preload">`;
// `panel.js` removes that element once its own adopted stylesheet (the real, live source of
// truth) is in place. Wrapped in try/catch: a private-browsing tab or blocked storage must never
// break page load. (A `#svc=` share-link load still briefly shows the *stored* theme before
// `panel.js` swaps to the hash-encoded one - acceptable, the hash case is rare and momentary.)
const noFlashPreloadScript = `(function(){try{var c=localStorage.getItem('svc-css');if(c){var s=document.createElement('style');s.id='svc-preload';s.textContent=c;document.head.appendChild(s);}}catch(e){}})();`;

// Studio entry point: a top-level visit to `/` redirects to `/studio/`, so opening the site lands
// in the docked studio showing the specimen page by default. Guarded so the frame and "open in new
// tab" links never redirect:
//  - `window.self !== window.top` - true for ANY iframe embedding, not just studio.astro's preview
//    frame specifically; there's no legitimate reason `/` should redirect when embedded in
//    anything, and the broader check is simpler than matching `data-svc-preview` from here.
//  - `pathname !== '/'` - only the bare splash route redirects; every other direct top-level visit
//    (e.g. `/guides/kitchen-sink/`) keeps today's overlay panel, unchanged. Under a sub-path, "the
//    bare splash route" is `rootPath` (the base itself, with its trailing slash), not literal `/` -
//    templated in below rather than read at runtime, since this script runs before first paint and
//    can't afford to wait on any module import.
//  - `?view` - the escape hatch: the studio's own "open in new tab" links and the panel's "Undock"
//    control append it when they need `/` to render normally at the top level.
// `location.replace` (not `.href =`) so the momentary visit to `/` doesn't leave a back-button trap
// that just redirects again. Runs in the SAME blocking `head` script slot as the no-flash preload
// above, before first paint - Starlight renders `head` entries as the very first children of
// `<head>` (see that script's own comment), so this can't itself cause a flash of the wrong page.
const redirectToStudioScript = `(function(){try{if(window.self!==window.top)return;if(location.pathname!=='${rootPath}')return;if(new URLSearchParams(location.search).has('view'))return;location.replace('${studioPath}');}catch(e){}})();`;

// https://astro.build/config
export default defineConfig({
	site: siteUrl,
	base: siteBase,
	integrations: [
		starlight({
			title: 'Orbit Docs',
			head: [
				// Prototype-stage: keep every page out of search engines until this is ready for a
				// public launch. Remove once that decision is made.
				{ tag: 'meta', attrs: { name: 'robots', content: 'noindex' } },
				{ tag: 'script', content: noFlashPreloadScript },
				{ tag: 'script', content: redirectToStudioScript },
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/prisant-labs/starlight-visual-customizer',
				},
			],
			editLink: {
				baseUrl:
					'https://github.com/prisant-labs/starlight-visual-customizer/edit/main/app/',
			},
			// No reliable git history in this fixture repo, so lastUpdated is derived
			// from frontmatter only (see resources/changelog.mdx) rather than git.
			lastUpdated: false,
			pagination: true,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
			components: {
				Footer: './src/components/CustomizerFooter.astro',
			},
			credits: true,
			sidebar: fixtureSidebar,
		}),
	],
});
