// @ts-check
/**
 * @file Product page e2e suite (`/`, `src/pages/index.astro`). Verifies that the root renders the
 * product page instead of forwarding, that its links are base-aware and reach the studio, the About
 * page and the repo, that the preset tabs swap the screenshot on a real click, that the preset
 * chips follow `presets.js`, that the social preview card tags (L-01) are correct and that the
 * local preview actually serves `og.png`, that the page has no horizontal scroll at phone width,
 * and that a root link carrying a shared theme (`#svc=...`) still opens that theme in the studio.
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run
 * build`) or `npm run dev:bg`.
 *   node tests/e2e/home.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420; under a sub-path build, the full
 * origin plus base path, e.g. http://localhost:4425/starlight-visual-customizer), SVC_CHROME_PATH,
 * SVC_BROWSER (chromium (default), firefox, webkit - see browser.mjs).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser } from './browser.mjs';
import { withBase, stripBase } from '../../src/customizer/core/base-path.js';
import { REPO_URL, TOOL_URL } from '../../src/customizer/core/project.js';
import { presets } from '../../src/customizer/core/presets.js';
import { defaultState, setName, encodeState } from '../../src/customizer/core/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
// The base path the server under test was built with ('/' at root), so every path check below
// compares base-free paths, exactly as studio.mjs does.
const BASE_PATH = new URL(SVC_BASE_URL).pathname;
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

let failures = 0;
function check(name, cond, note = '') {
	if (cond) console.log(`PASS - ${name}`);
	else {
		failures++;
		console.log(`FAIL - ${name}${note ? ` (${note})` : ''}`);
	}
}

function normalizePath(pathname) {
	const s = String(pathname || '/');
	if (s === '/') return '/';
	return s.endsWith('/') ? s : `${s}/`;
}

/** The page's base-free path, for comparing against this app's own constants. */
function appPath(url) {
	return normalizePath(stripBase(new URL(url).pathname, BASE_PATH));
}

/** A real mouse click at the element's on-screen center, as in studio.mjs, so hit-testing counts.
 * @param {import('playwright-core').Page} page @param {string} selector */
async function realClick(page, selector) {
	const handle = await page.$(selector);
	if (!handle) throw new Error(`realClick: ${selector} matched nothing`);
	await handle.scrollIntoViewIfNeeded({ timeout: 5000 });
	const box = await handle.boundingBox();
	if (!box) throw new Error(`realClick: ${selector} has no bounding box`);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Waits until the studio panel's body has been built (see studio.mjs). */
async function waitForPanelBody(page, timeout = 15000) {
	await page.waitForFunction(
		() => {
			const host = document.querySelector('sl-customizer');
			return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-group'));
		},
		null,
		{ timeout }
	);
}

async function main() {
	mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	const browser = await launchBrowser();

	const errors = [];
	function trackErrors(page) {
		page.on('pageerror', (err) => errors.push(`[pageerror ${page.url()}] ${err.message}`));
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(`[console ${page.url()}] ${msg.text()}`);
		});
	}

	// =============================================================================================
	// 1. The product page renders at the root, with base-aware links.
	// =============================================================================================
	{
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		trackErrors(page);
		const requestUrls = [];
		page.on('request', (req) => requestUrls.push(req.url()));
		await page.goto(`${SVC_BASE_URL}/`, { waitUntil: 'networkidle' });

		check('/ renders the product page instead of forwarding', appPath(page.url()) === '/', page.url());

		// The About page tells visitors the only third-party requests are web-font previews from
		// jsDelivr, so the product page must make none: its Inter font is self-hosted.
		const origin = new URL(SVC_BASE_URL).origin;
		const thirdParty = requestUrls.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin);
		check('the page makes no third-party requests', thirdParty.length === 0, thirdParty.join(', '));
		const interLoaded = await page.evaluate(async () => {
			await document.fonts.ready;
			return [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Inter Variable' && f.status === 'loaded');
		});
		check('the self-hosted Inter font loads', interLoaded);
		const title = await page.title();
		check('the page title is "Starlight Visual Customizer"', title === 'Starlight Visual Customizer', title);
		const robots = await page.evaluate(() => document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null);
		check('the page carries no robots meta', robots === null, String(robots));

		// L-01 (social preview card): the product page's og:image is an absolute URL built from
		// TOOL_URL, not a relative one - Discord, Reddit and Slack all need it absolute - and
		// twitter:card opts into the large-image layout.
		const ogImage = await page.getAttribute('meta[property="og:image"]', 'content');
		check('og:image is the absolute TOOL_URL-based card', ogImage === `${TOOL_URL}og.png`, String(ogImage));
		const twitterCard = await page.getAttribute('meta[name="twitter:card"]', 'content');
		check('twitter:card requests the large-image layout', twitterCard === 'summary_large_image', String(twitterCard));
		const ogAlt = await page.getAttribute('meta[property="og:image:alt"]', 'content');
		const twitterAlt = await page.getAttribute('meta[name="twitter:image:alt"]', 'content');
		check('the card has alt text, the same for Open Graph and Twitter', !!ogAlt && ogAlt.length > 20 && ogAlt === twitterAlt, String(ogAlt));
		const h1 = (await page.textContent('h1'))?.trim() ?? '';
		check('the headline reads "Design your Starlight theme on real pages"', h1 === 'Design your Starlight theme on real pages', h1);

		const links = await page.evaluate(() => ({
			cta: document.querySelector('.btn-primary')?.getAttribute('href') ?? null,
			github: document.querySelector('.btn-plain')?.getAttribute('href') ?? null,
			about: document.querySelector('nav a[href$="/about/"]')?.getAttribute('href') ?? null,
			brand: document.querySelector('.brand')?.getAttribute('href') ?? null,
		}));
		check('"Open the studio" links to the base-aware /studio/', links.cta === withBase('/studio/', BASE_PATH), String(links.cta));
		check('"View on GitHub" links to the repo', links.github === REPO_URL, String(links.github));
		check('the About link is the base-aware /about/', links.about === withBase('/about/', BASE_PATH), String(links.about));
		check('the brand links to the base-aware root', links.brand === withBase('/', BASE_PATH), String(links.brand));

		const logoLoaded = await page.evaluate(() => {
			const img = /** @type {HTMLImageElement | null} */ (document.querySelector('.brand img'));
			return !!img && img.complete && img.naturalWidth > 0;
		});
		check('the logo loads', logoLoaded);

		// The tabs. All four screenshots load up front, so switching never waits on the network.
		await page.waitForFunction(() => [...document.querySelectorAll('.shot img')].every((img) => /** @type {HTMLImageElement} */ (img).complete), null, { timeout: 15000 });
		const tabs = await page.evaluate(() =>
			[...document.querySelectorAll('.tabs button')].map((b) => ({ label: b.textContent?.trim(), pressed: b.getAttribute('aria-pressed') }))
		);
		check('there are 4 preset tabs', tabs.length === 4, String(tabs.length));
		check('"Starlight default" is the first tab and starts selected', tabs[0]?.label === 'Starlight default' && tabs[0]?.pressed === 'true', JSON.stringify(tabs[0]));
		const shots = await page.evaluate(() =>
			[...document.querySelectorAll('.shot img')].map((img) => ({
				id: img.id,
				hidden: /** @type {HTMLImageElement} */ (img).hidden,
				loaded: /** @type {HTMLImageElement} */ (img).naturalWidth > 0,
			}))
		);
		check('all 4 screenshots have loaded', shots.length === 4 && shots.every((s) => s.loaded), JSON.stringify(shots));
		check('only the first screenshot shows at first', shots.map((s) => s.hidden).join() === 'false,true,true,true', JSON.stringify(shots));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'home-1440.png') });

		await realClick(page, '.tabs button[data-shot="1"]');
		const afterClick = await page.evaluate(() => ({
			pressed: [...document.querySelectorAll('.tabs button')].map((b) => b.getAttribute('aria-pressed')).join(),
			hidden: [...document.querySelectorAll('.shot img')].map((img) => String(/** @type {HTMLImageElement} */ (img).hidden)).join(),
			visibleHeight: document.getElementById('svc-shot-1')?.getBoundingClientRect().height ?? 0,
		}));
		check('clicking the second tab selects it', afterClick.pressed === 'false,true,false,false', afterClick.pressed);
		check('clicking the second tab shows its screenshot and hides the first', afterClick.hidden === 'true,false,true,true' && afterClick.visibleHeight > 100, JSON.stringify(afterClick));

		// The preset strip follows presets.js.
		const chips = await page.evaluate(() => [...document.querySelectorAll('.chip')].map((c) => c.getAttribute('title')));
		check(`one chip per preset (${presets.length}), in presets.js order`, chips.join('|') === presets.map((p) => p.label).join('|'), chips.join('|'));
		const stripHeading = (await page.textContent('.strip h2'))?.trim() ?? '';
		check('the preset strip heading names the preset count', stripHeading.endsWith('presets to start from') && stripHeading !== 'presets to start from', stripHeading);

		// "Open the studio" reaches a working studio.
		await realClick(page, '.btn-primary');
		await page.waitForURL((url) => appPath(url.href) === '/studio/', { timeout: 10000 });
		await waitForPanelBody(page);
		check('"Open the studio" opens a working studio', appPath(page.url()) === '/studio/', page.url());
		await page.close();
	}

	// =============================================================================================
	// 2. L-01 (social preview card): the local preview actually serves og.png at the build's base
	// path, as a real image - a 404 or an HTML error page here would still pass the og:image check
	// above (it only inspects the meta tag's text), so this needs its own request.
	// =============================================================================================
	{
		const ogUrl = `${SVC_BASE_URL}/og.png`;
		const res = await fetch(ogUrl);
		check(`og.png is served at ${ogUrl}`, res.status === 200, String(res.status));
		const contentType = res.headers.get('content-type') ?? '';
		check('og.png serves as image/png', contentType.startsWith('image/png'), contentType);
	}

	// =============================================================================================
	// 3. Phone width: no horizontal scroll.
	// =============================================================================================
	{
		const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
		trackErrors(page);
		await page.goto(`${SVC_BASE_URL}/`, { waitUntil: 'networkidle' });
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		check('no horizontal scroll at 375px', overflow <= 0, `${overflow}px`);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'home-375.png'), fullPage: true });
		await page.close();
	}

	// =============================================================================================
	// 4. A root link that carries a shared theme still opens it in the studio. A fresh context (a
	// new page here) means no saved theme, so the name below can only come from the link.
	// =============================================================================================
	{
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		trackErrors(page);
		const name = 'Shared through the root';
		const encoded = encodeState(setName(defaultState(), name));
		await page.goto(`${SVC_BASE_URL}/?page=/demo/guides/kitchen-sink/#svc=${encoded}`, { waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		await page.waitForTimeout(300);
		check('a root link with #svc= forwards to the studio', appPath(page.url()) === '/studio/', page.url());
		const themeName = await page.evaluate(() => /** @type {HTMLInputElement | null} */ (document.getElementById('svc-theme-name'))?.value ?? null);
		check('the studio applies the shared theme from the forwarded hash', themeName === name, String(themeName));
		const framePath = await page.evaluate(() => {
			const iframe = /** @type {HTMLIFrameElement | null} */ (document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]'));
			return iframe?.contentWindow?.location.pathname ?? null;
		});
		check('the forward keeps the query string, so ?page= picks the preview page', appPath(`http://x${framePath}`) === '/demo/guides/kitchen-sink/', String(framePath));
		await page.close();
	}

	check('no page errors or console errors', errors.length === 0, errors.join(' | '));
	await browser.close();

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
