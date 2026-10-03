// @ts-check
/**
 * @file Verifies every control's `target` field contract: "Must match at least one element on
 * `/demo/guides/kitchen-sink/` or (hero) `/demo/`." For every row in `manifest.js`'s `controls`, this loads
 * both pages at a desktop viewport (wide enough that TOC-rail/header-grid/two-column controls -
 * gated behind Starlight's own 50rem/72rem breakpoints - actually render) and asserts
 * `document.querySelectorAll(target)` matches at least one *visible* element (non-zero bounding
 * box, not `display:none`/`visibility:hidden`) on at least one of the two pages. A control is not
 * required to be visible on both - hero-only controls (`content.heroAlign`) only ever match on
 * `/demo/`, and a handful of "Page options" rows are legitimately hidden by the *default* preview
 * state (e.g. `page.credits` defaults off, so `footer .kudos` is `display:none` until toggled -
 * those rows use a selector list with a container fallback, see manifest.js).
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run build`) or `npm run dev:bg`.
 *   node tests/e2e/targets.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420 = this project's production preview; use http://localhost:4700 for its dev server;
 * under a sub-path build, the full origin plus base path, e.g. http://localhost:4425/starlight-visual-customizer); SVC_CHROME_PATH.
 */
import { chromium } from 'playwright-core';
import { chromiumOnly } from './browser.mjs';

chromiumOnly('targets.mjs');

const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
const EXECUTABLE_PATH =
	process.env.SVC_CHROME_PATH ||
	chromium.executablePath();

// The demo site's splash page now lives at `/demo/` - the site root `/` is just a tiny forwarder to
// `/studio/` and has no hero markup of its own - so the hero-only targets load `/demo/` directly.
// `/demo/specimen/` is added because several controls' targets (Card/LinkButton/Badge, blockquote)
// are proven there explicitly, though most also happen to be visible on kitchen-sink too.
// `svc-overlay`: a direct top-level visit no longer mounts a panel at all -
// this suite reads raw page markup only (never the panel/shadow root), so it doesn't strictly need
// the panel mounted, but keeping the flag here matches every other engine suite's URLs.
const PAGES = [`${SVC_BASE_URL}/demo/guides/kitchen-sink/?svc-overlay`, `${SVC_BASE_URL}/demo/?svc-overlay`, `${SVC_BASE_URL}/demo/specimen/?svc-overlay`];

const { controls } = await import('../../src/customizer/core/manifest.js');

/**
 * @param {import('playwright-core').Page} page
 * @param {string} selector
 * @returns {Promise<{ok: true, visibleCount: number, matchCount: number} | {ok: false, error: string}>}
 */
async function checkTarget(page, selector) {
	return page.evaluate((sel) => {
		let matches;
		try {
			matches = document.querySelectorAll(sel);
		} catch (err) {
			return { ok: false, error: String(err && err.message ? err.message : err) };
		}
		let visibleCount = 0;
		for (const el of matches) {
			const rect = el.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) continue;
			const style = getComputedStyle(el);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			visibleCount++;
		}
		return { ok: true, visibleCount, matchCount: matches.length };
	}, selector);
}

/** @type {{id: string, status: string, note: string}[]} */
const results = [];
let failures = 0;

function record(id, status, note = '') {
	results.push({ id, status, note });
	if (status !== 'PASS') failures++;
	console.log(`${status.padEnd(6)} ${id.padEnd(28)} ${note}`);
}

async function main() {
	const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
	const page = await browser.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	page.on('pageerror', (err) => console.log('[browser page error]', err.message));

	/** @type {Map<string, Awaited<ReturnType<typeof checkTarget>>>} */
	const perPageCache = new Map();

	for (const url of PAGES) {
		await page.goto(url, { waitUntil: 'networkidle' });
		for (const control of controls) {
			const outcome = await checkTarget(page, control.target);
			perPageCache.set(`${control.id}::${url}`, outcome);
		}
	}

	await browser.close();

	for (const control of controls) {
		const perPage = PAGES.map((url) => ({ url, outcome: perPageCache.get(`${control.id}::${url}`) }));
		const invalid = perPage.find((p) => !p.outcome.ok);
		if (invalid) {
			record(control.id, 'INVALID', `bad selector "${control.target}": ${invalid.outcome.error}`);
			continue;
		}
		const visibleOn = perPage.filter((p) => p.outcome.ok && p.outcome.visibleCount > 0);
		if (visibleOn.length > 0) {
			record(
				control.id,
				'PASS',
				`visible on ${visibleOn.map((p) => new URL(p.url).pathname).join(', ')} (target: ${control.target})`
			);
		} else {
			const detail = perPage
				.map((p) => `${new URL(p.url).pathname}: ${p.outcome.ok ? `${p.outcome.matchCount} match(es), 0 visible` : 'invalid'}`)
				.join(' | ');
			record(control.id, 'MISS', `target "${control.target}" matched no visible element - ${detail}`);
		}
	}

	console.log(
		`\n${failures === 0 ? 'ALL TARGETS RESOLVED' : `${failures} TARGET(S) FAILED`} (${results.length} total, viewport 1440x900)`
	);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
