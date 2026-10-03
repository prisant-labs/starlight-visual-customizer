// @ts-check
/**
 * Headless smoke test for the customizer UI, driven with `playwright-core` against the machine's
 * already-installed chromium-1228 build (no new browser download needed). Run against a running
 * dev or preview server:
 *
 *   node tests/e2e/smoke.mjs
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run build`) or `npm run dev:bg`.
 * Env overrides: SVC_BASE_URL (default http://localhost:4420 = this project's production preview; use http://localhost:4700 for its dev server), SVC_CHROME_PATH,
 * SVC_BROWSER (chromium (default), firefox, webkit - see browser.mjs).
 *
 * Everything that touches the panel goes through `page.evaluate` reaching into
 * `document.querySelector('sl-customizer').shadowRoot` directly with native DOM APIs (set
 * `.value` + dispatch a real `input`/`change` event) rather than Playwright locators: the IA
 * editor's label `<input>` has its value set via the `.value` *property*, not the `value`
 * *attribute*, so an attribute CSS selector like `[value="Getting Started"]` would never match -
 * evaluating in-page and comparing the live property sidesteps that entirely, and also removes
 * any dependency on exactly which Playwright locator behaviors this playwright-core/Chromium
 * pairing supports.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser } from './browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
// A direct top-level page visit no longer mounts the panel at all (it shows a
// small "Open in Studio" pill instead) - `?svc-overlay` is the escape hatch this suite (an ENGINE
// test of the overlay panel itself, not of the visitor-mode page) needs to keep exercising the
// panel exactly as before. URL-flag-only edit; everything else in this file is unchanged.
const OVERLAY = '?svc-overlay';

let failures = 0;
function check(name, cond) {
	if (cond) console.log(`PASS - ${name}`);
	else {
		failures++;
		console.log(`FAIL - ${name}`);
	}
}

async function main() {
	mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });

	const browser = await launchBrowser();
	const page = await browser.newPage();
	page.on('pageerror', (err) => console.log('[browser page error]', err.message));
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.log('[browser console error]', msg.text());
	});

	await page.goto(`${SVC_BASE_URL}/demo/guides/kitchen-sink/${OVERLAY}`, { waitUntil: 'networkidle' });

	// ---- 1. panel exists in the shadow root ----------------------------------------------
	const panelExists = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-panel'));
	});
	check('panel mounted inside <sl-customizer> shadow root', panelExists);

	// ---- 2. accent hue change recolors markdown links -----------------------------------
	const colorBefore = await page.evaluate(() => {
		const a = document.querySelector('.sl-markdown-content a');
		return a ? getComputedStyle(a).color : null;
	});

	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
		input.value = '120'; // far from the default (269) so the assertion isn't a rounding coin flip
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.waitForTimeout(250); // rAF-debounced CSS apply

	const colorAfter = await page.evaluate(() => {
		const a = document.querySelector('.sl-markdown-content a');
		return a ? getComputedStyle(a).color : null;
	});
	check(
		'accent hue change recolors .sl-markdown-content a',
		!!colorBefore && !!colorAfter && colorBefore !== colorAfter
	);

	// ---- 3. editorial-serif preset changes body font-family ------------------------------
	const fontBefore = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
	const presetClicked = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const card = Array.from(host.shadowRoot.querySelectorAll('.svc-preset-card')).find((c) =>
			c.textContent.includes('Editorial Serif')
		);
		if (!card) return false;
		card.click();
		return true;
	});
	check('found the Editorial Serif preset card', presetClicked);
	await page.waitForTimeout(250);
	const fontAfter = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
	check('editorial-serif preset changes body font-family', fontBefore !== fontAfter);

	// ---- 4. IA edit: rename "Getting Started" via the Navigation tree editor -------------
	const beforeLinkText = await page.evaluate(() => {
		const link = Array.from(document.querySelectorAll('.sidebar-content a')).find(
			(a) => a.textContent.trim() === 'Getting Started'
		);
		return link ? link.textContent.trim() : null;
	});
	check('sidebar shows "Getting Started" before the edit', beforeLinkText === 'Getting Started');

	const renamed = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const input = Array.from(host.shadowRoot.querySelectorAll('.svc-ia-label-input')).find(
			(i) => i.value === 'Getting Started'
		);
		if (!input) return false;
		input.value = 'Start Here';
		input.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	});
	check('found the IA editor label input for "Getting Started"', renamed);
	await page.waitForTimeout(150);

	const afterLink = await page.evaluate(() => {
		const link = Array.from(document.querySelectorAll('.sidebar-content a')).find(
			(a) => a.textContent.trim() === 'Start Here'
		);
		return link ? { text: link.textContent.trim(), className: link.className } : null;
	});
	check('sidebar link text changed to "Start Here"', afterLink?.text === 'Start Here');
	// This Astro build's scoped-style marker is a class (`astro-XXXXXXXX`), not a
	// `data-astro-cid-*` attribute (older Astro versions used the attribute form under the
	// default `scopedStyleStrategy`). "Clone, don't construct" preserves whichever mechanism is
	// live, so this checks for the one this build actually emits.
	check(
		'renamed link retains an Astro scoped-style class (cloned, not hand-built)',
		!!afterLink && /\bastro-[a-z0-9]+\b/.test(afterLink.className)
	);

	// ---- 5. state persists across a full-page navigation ---------------------------------
	await page.goto(`${SVC_BASE_URL}/demo/guides/getting-started/${OVERLAY}`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(250);
	const persisted = await page.evaluate(() => {
		const link = Array.from(document.querySelectorAll('.sidebar-content a')).find(
			(a) => a.textContent.trim() === 'Start Here'
		);
		const a = document.querySelector('.sl-markdown-content a');
		return { renamedLinkPresent: !!link, linkColor: a ? getComputedStyle(a).color : null };
	});
	check('IA rename persisted across navigation', persisted.renamedLinkPresent);
	check(
		'accent color change persisted across navigation',
		!!persisted.linkColor && persisted.linkColor !== colorBefore
	);

	// ---- 6. export dialog shows a non-empty theme.css ------------------------------------
	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const btn = Array.from(host.shadowRoot.querySelectorAll('button')).find((b) =>
			b.textContent.includes('Export')
		);
		btn.click();
	});
	await page.waitForTimeout(100);
	const cssText = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const textarea = host.shadowRoot.querySelector('.svc-export-textarea');
		return textarea ? textarea.value : null;
	});
	check('export dialog theme.css tab is non-empty', !!cssText && cssText.trim().length > 0);

	await page.screenshot({ path: path.join(__dirname, 'screenshots', 'kitchen-sink.png') });

	await browser.close();

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
