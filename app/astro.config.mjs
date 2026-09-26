// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { fixtureSidebar } from './src/fixture-sidebar.mjs';

// No-flash preload (SPEC.md Round 2 item 2, owner: UI). A tiny, synchronous, blocking inline
// script: Starlight renders `head` entries as the very first children of `<head>` (see
// `node_modules/@astrojs/starlight/dist/components/Page.astro`, before `<ThemeProvider />` and
// every built-in stylesheet), so this runs - and finishes - before the parser reaches anything
// else, i.e. before first paint. It reads the full preview CSS `panel.js` mirrored into
// `localStorage['svc-css']` on the *previous* page and paints it as `<style id="svc-preload">`;
// `panel.js` removes that element once its own adopted stylesheet (the real, live source of
// truth) is in place. Wrapped in try/catch: a private-browsing tab or blocked storage must never
// break page load. (A `#svc=` share-link load still briefly shows the *stored* theme before
// `panel.js` swaps to the hash-encoded one - acceptable, the hash case is rare and momentary.)
const noFlashPreloadScript = `(function(){try{var c=localStorage.getItem('svc-css');if(c){var s=document.createElement('style');s.id='svc-preload';s.textContent=c;document.head.appendChild(s);}}catch(e){}})();`;

// Studio entry point (studio design doc, item E): a top-level visit to `/` redirects to `/studio/`,
// so opening the site lands in the docked studio showing the specimen page by default. Guarded so
// the frame and "open in new tab" links never redirect:
//  - `window.self !== window.top` - true for ANY iframe embedding, not just studio.astro's preview
//    frame specifically; there's no legitimate reason `/` should redirect when embedded in
//    anything, and the broader check is simpler than matching `data-svc-preview` from here.
//  - `pathname !== '/'` - only the bare splash route redirects; every other direct top-level visit
//    (e.g. `/guides/kitchen-sink/`) keeps today's overlay panel, unchanged.
//  - `?view` - the escape hatch: the studio's own "open in new tab" links and the panel's "Undock"
//    control append it when they need `/` to render normally at the top level.
// `location.replace` (not `.href =`) so the momentary visit to `/` doesn't leave a back-button trap
// that just redirects again. Runs in the SAME blocking `head` script slot as the no-flash preload
// above, before first paint - Starlight renders `head` entries as the very first children of
// `<head>` (see that script's own comment), so this can't itself cause a flash of the wrong page.
const redirectToStudioScript = `(function(){try{if(window.self!==window.top)return;if(location.pathname!=='/')return;if(new URLSearchParams(location.search).has('view'))return;location.replace('/studio/');}catch(e){}})();`;

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Starlight Customizer',
			head: [
				{ tag: 'script', content: noFlashPreloadScript },
				{ tag: 'script', content: redirectToStudioScript },
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/prisant-labs/astro-starlight-visual-customizer',
				},
			],
			editLink: {
				baseUrl:
					'https://github.com/prisant-labs/astro-starlight-visual-customizer/edit/main/app/',
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
