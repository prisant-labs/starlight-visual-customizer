// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { fixtureSidebar } from './src/fixture-sidebar.mjs';
import { demoSidebar } from './src/demo-site.mjs';

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
			],
			// Points the header's site-title link at the demo's own home page (`/demo/`) rather than
			// the site root, which belongs to the product page and the studio, not to the demo.
			routeMiddleware: './src/route-data.js',
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
			// Every demo page lives under `src/content/docs/demo/`, so the slugs gain a `demo/` prefix
			// here. `fixtureSidebar` itself stays prefix-free; see `src/demo-site.mjs`.
			sidebar: demoSidebar(fixtureSidebar),
		}),
	],
});
