// @ts-check
/**
 * UI verification suite. Covers:
 *   1. Nav editor expand/collapse actually toggles visibility, and typing a multi-word label into
 *      the IA editor keeps focus (no full-tree re-render mid-keystroke).
 *   2. UI-state contract: an open group + panel scroll offset survive a full-page navigation via
 *      `sessionStorage['svc-ui']`.
 *   3. No-flash contract: under a non-default preset, `.sl-markdown-content a` is already themed
 *      at `readyState === 'interactive'` (i.e. from the blocking `head` preload script, before
 *      `panel.js` - a deferred module script - has had a chance to run), not just at `load`.
 *   4. Target highlight: the `target-highlight.js` mechanism (overlay position + scrollIntoView)
 *      works end-to-end against a real page element, exercised directly since CORE-2's `target`
 *      manifest field may not have landed while this suite was authored (checked separately below,
 *      best-effort).
 *   5. Regression: the shared `[hidden] { display: none !important; }` fix also makes
 *      `applyControlFilter`'s filtered-out rows actually disappear.
 *
 * Run: node tests/e2e/ui-round2.mjs   (env: SVC_BASE_URL, default http://localhost:4420 = production preview, http://localhost:4700 = dev server; SVC_CHROME_PATH)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
const EXECUTABLE_PATH =
	process.env.SVC_CHROME_PATH ||
	chromium.executablePath();
// Every check in this suite drives the overlay panel directly against
// `sl-customizer`'s shadow root, which no longer mounts on a plain top-level visit - `?svc-overlay`
// is the escape hatch that keeps it mounting for this suite.
const OVERLAY = '?svc-overlay';

let failures = 0;
function check(name, cond) {
	if (cond) console.log(`PASS - ${name}`);
	else {
		failures++;
		console.log(`FAIL - ${name}`);
	}
}
function note(msg) {
	console.log(`NOTE - ${msg}`);
}

/**
 * Waits for `<sl-customizer>`'s shadow DOM to be built. CORE-2 was still actively editing
 * `manifest.js` in parallel while this suite was authored, and Vite HMR can trigger a full page
 * reload on a deep dependency change (e.g. `state.js` re-importing `manifest.js`) at any moment -
 * a plain `waitUntil: 'load'` can win a race against exactly that reload. Waiting on the actual
 * DOM the panel builds is robust to that instead of assuming one navigation event is the end of it.
 * @param {import('playwright-core').Page} page
 */
async function readyCustomizer(page) {
	await page.waitForFunction(() => {
		const host = document.querySelector('sl-customizer');
		return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-panel'));
	});
}

async function main() {
	mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });

	const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
	try {
		await run(browser);
	} finally {
		await browser.close();
	}
}

async function run(browser) {

	// ---- 1. no-flash: sample the link color at `interactive` (before panel.js, a deferred module
	// script, has run) vs at `load`, under a non-default preset persisted from a prior visit. -------
	{
		const page = await browser.newPage();
		page.on('pageerror', (err) => console.log('[browser page error]', err.message));
		await page.goto(`${SVC_BASE_URL}/guides/kitchen-sink/${OVERLAY}`, { waitUntil: 'load' });
		await readyCustomizer(page);
		const colorBeforePreset = await page.evaluate(() => {
			const a = document.querySelector('.sl-markdown-content a');
			return a ? getComputedStyle(a).color : null;
		});
		// Apply a clearly non-default preset and let it persist to localStorage['svc-state'] +
		// localStorage['svc-css'] (the no-flash snapshot), the way a real prior visit would.
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const card = Array.from(host.shadowRoot.querySelectorAll('.svc-preset-card')).find((c) =>
				c.textContent.includes('Editorial Serif')
			);
			card.click();
		});
		await page.waitForTimeout(300);
		const cssSnapshotLength = await page.evaluate(() => (localStorage.getItem('svc-css') || '').length);
		check('localStorage[svc-css] snapshot is non-empty after a preset change', cssSnapshotLength > 0);

		// Reload: record the color at `interactive` via an init script that fires before any of this
		// page's own scripts (including the deferred panel.js module) run.
		await page.addInitScript(() => {
			document.addEventListener(
				'readystatechange',
				() => {
					if (document.readyState === 'interactive') {
						const a = document.querySelector('.sl-markdown-content a');
						window.__svcInteractiveColor = a ? getComputedStyle(a).color : null;
						window.__svcPreloadPresent = !!document.getElementById('svc-preload');
					}
				},
				{ once: false }
			);
		});
		await page.reload({ waitUntil: 'load' });
		const interactiveColor = await page.evaluate(() => window.__svcInteractiveColor);
		const preloadWasPresent = await page.evaluate(() => window.__svcPreloadPresent);
		const loadColor = await page.evaluate(() => {
			const a = document.querySelector('.sl-markdown-content a');
			return a ? getComputedStyle(a).color : null;
		});
		check('a `#svc-preload` style existed at readyState=interactive', preloadWasPresent === true);
		check(
			'the preset actually changed the link color (test isn’t vacuously true)',
			!!interactiveColor && interactiveColor !== colorBeforePreset
		);
		check(
			'.sl-markdown-content a is already themed at readyState=interactive (no-flash)',
			!!interactiveColor && interactiveColor === loadColor
		);
		check('#svc-preload was removed by the time the page finished loading', await page.evaluate(() => !document.getElementById('svc-preload')));
		await page.close();
	}

	const page = await browser.newPage();
	page.on('pageerror', (err) => console.log('[browser page error]', err.message));
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.log('[browser console error]', msg.text());
	});
	await page.goto(`${SVC_BASE_URL}/guides/kitchen-sink/${OVERLAY}`, { waitUntil: 'load' });
	await readyCustomizer(page);

	// ---- 2. filter regression: a filtered-out row is actually display:none (the shared [hidden]
	// fix), not just present-but-unstyled. --------------------------------------------------------
	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const filterInput = host.shadowRoot.querySelector('.svc-filter');
		filterInput.value = 'zzz-does-not-match-anything';
		filterInput.dispatchEvent(new Event('input', { bubbles: true }));
	});
	const filteredRowDisplay = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const row = host.shadowRoot.querySelector("[data-control-id='color.accent.hue']");
		return row ? getComputedStyle(row).display : null;
	});
	check('a filtered-out control row computes display:none', filteredRowDisplay === 'none');
	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const filterInput = host.shadowRoot.querySelector('.svc-filter');
		filterInput.value = '';
		filterInput.dispatchEvent(new Event('input', { bubbles: true }));
	});

	// ---- 3. Nav editor: expand/collapse actually toggles visibility (the [hidden] + display:flex
	// fix), and the arrow reflects state. ------------------------------------------------------
	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const toggle = Array.from(host.shadowRoot.querySelectorAll('.svc-group-toggle')).find((t) =>
			t.textContent.includes('Navigation structure')
		);
		toggle.click();
	});
	const navDemoted = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const groups = Array.from(host.shadowRoot.querySelectorAll('.svc-group[data-group]'));
		const navIndex = groups.findIndex((g) => g.dataset.group === 'Navigation');
		return { isLast: navIndex === groups.length - 1, count: groups.length };
	});
	check('Navigation group is the last (bottom) group in the panel', navDemoted.isLast);

	const disclosureBefore = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const row = host.shadowRoot.querySelector('.svc-ia-row');
		const details = row.querySelector('.svc-ia-details');
		const btn = row.querySelector('.svc-ia-btn');
		return { hidden: details.hidden, display: getComputedStyle(details).display, arrow: btn.textContent };
	});
	check('IA row details start collapsed (hidden -> display:none)', disclosureBefore.display === 'none');
	check('collapsed disclosure arrow points right (▸)', disclosureBefore.arrow === '▸');

	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const row = host.shadowRoot.querySelector('.svc-ia-row');
		row.querySelector('.svc-ia-btn').click();
	});
	const disclosureAfter = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const row = host.shadowRoot.querySelector('.svc-ia-row');
		const details = row.querySelector('.svc-ia-details');
		const btn = row.querySelector('.svc-ia-btn');
		return { display: getComputedStyle(details).display, arrow: btn.textContent };
	});
	check('clicking disclosure reveals details (display flips to flex, not none)', disclosureAfter.display !== 'none');
	check('expanded disclosure arrow points down (▾)', disclosureAfter.arrow === '▾');

	// ---- 4. Typing a multi-word label keeps focus (real-time model update on `input`, full
	// re-render deferred to `change`/blur). ------------------------------------------------------
	const typingResult = await page.evaluate(async () => {
		const host = document.querySelector('sl-customizer');
		const input = Array.from(host.shadowRoot.querySelectorAll('.svc-ia-label-input')).find(
			(i) => i.value === 'Getting Started'
		);
		if (!input) return { found: false };
		input.focus();
		input.value = '';
		const text = 'Quick Start Guide';
		for (const ch of text) {
			input.value += ch;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await new Promise((r) => setTimeout(r, 0));
		}
		return {
			found: true,
			finalValue: input.value,
			stillFocused: host.shadowRoot.activeElement === input,
		};
	});
	check('found the IA label input for "Getting Started"', typingResult.found);
	check('typed value accumulated in full ("Quick Start Guide")', typingResult.finalValue === 'Quick Start Guide');
	check('input element retained focus throughout typing', typingResult.stillFocused);

	// Re-collapse the Navigation group before the next section (leave the panel tidy / collapsed
	// like the demoted default) and blur the label input so its `change` handler commits normally.
	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		host.shadowRoot.activeElement?.blur();
	});

	// ---- 5. UI-state contract: open a group + scroll the panel, navigate, and confirm both
	// survive via sessionStorage['svc-ui']. --------------------------------------------------------
	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const toggle = Array.from(host.shadowRoot.querySelectorAll('.svc-group-toggle')).find((t) =>
			t.textContent.includes('Typography')
		);
		if (host.shadowRoot.querySelector("[data-group='Typography']").dataset.open !== 'true') toggle.click();
		const body = host.shadowRoot.querySelector('.svc-body');
		body.scrollTop = 120;
		body.dispatchEvent(new Event('scroll'));
	});
	await page.waitForTimeout(100); // rAF-debounced sessionStorage write
	const uiStateBefore = await page.evaluate(() => JSON.parse(sessionStorage.getItem('svc-ui') || '{}'));
	check('Typography added to persisted openGroups before navigating', (uiStateBefore.openGroups || []).includes('Typography'));
	check('scrollTop (120) persisted before navigating', uiStateBefore.scrollTop === 120);

	await page.goto(`${SVC_BASE_URL}/guides/getting-started/${OVERLAY}`, { waitUntil: 'load' });
	await readyCustomizer(page);
	const afterNav = await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		const typographyOpen = host.shadowRoot.querySelector("[data-group='Typography']")?.dataset.open;
		const body = host.shadowRoot.querySelector('.svc-body');
		return { typographyOpen, scrollTop: body.scrollTop };
	});
	check('Typography group is still open after navigating to another page', afterNav.typographyOpen === 'true');
	check('panel scroll offset restored after navigating (no visible jump)', afterNav.scrollTop === 120);

	// ---- 6. Target highlight (item 4), exercised through the real UI path only: focus a control,
	// assert the page scrolls to that control's `target` and the panel's own overlay lands on it.
	// (No `/src/...` imports: those paths exist on the dev server only, not in a production build.)
	{
		await page.goto(`${SVC_BASE_URL}/guides/kitchen-sink/${OVERLAY}`, { waitUntil: 'load' });
		await readyCustomizer(page);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const toggle = Array.from(host.shadowRoot.querySelectorAll('.svc-group-toggle')).find((t) => t.textContent.includes('Code'));
			if (host.shadowRoot.querySelector("[data-group='Code']").dataset.open !== 'true') toggle.click();
		});
		// Force the target off-screen first (top of page - the code frame is well below the fold on
		// this long guide) so "scrolls to" is a real assertion, not a no-op because the frame already
		// happened to be in view.
		await page.evaluate(() => window.scrollTo(0, 0));
		const wasOffscreenBeforeFocus = await page.evaluate(() => {
			const frame = document.querySelector('.expressive-code .frame');
			if (!frame) return null;
			const r = frame.getBoundingClientRect();
			return r.bottom <= 0 || r.top >= window.innerHeight;
		});
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='code.frameRadius'] input[type=range]");
			input.dispatchEvent(new Event('focus', { bubbles: true }));
		});
		// Smooth scrollIntoView can take longer than a fixed sleep on a long page - poll instead.
		await page
			.waitForFunction(
				() => {
					const frame = document.querySelector('.expressive-code .frame');
					if (!frame) return false;
					const r = frame.getBoundingClientRect();
					return r.top >= 0 && r.bottom <= window.innerHeight;
				},
				{ timeout: 3000 }
			)
			.catch(() => {}); // let the explicit check below report failure with a clear name
		const scrolledIntoView = await page.evaluate(() => {
			const frame = document.querySelector('.expressive-code .frame');
			if (!frame) return false;
			const r = frame.getBoundingClientRect();
			return r.top >= 0 && r.bottom <= window.innerHeight;
		});
		check('code.frameRadius target started off-screen (test is meaningful)', wasOffscreenBeforeFocus === true);
		check('focusing code.frameRadius scrolls the code frame into view', scrolledIntoView);
		const liveOverlay = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const overlay = host.shadowRoot.querySelector('.svc-target-overlay');
			return overlay ? !overlay.hidden : false;
		});
		check('focusing code.frameRadius shows the live panel overlay (target wired end-to-end)', liveOverlay);
		const overlayFit = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const overlay = host.shadowRoot.querySelector('.svc-target-overlay');
			const frame = document.querySelector('.expressive-code .frame');
			if (!overlay || !frame) return false;
			const o = overlay.getBoundingClientRect();
			const f = frame.getBoundingClientRect();
			return Math.abs(o.width - f.width) < 12 && Math.abs(o.left - f.left) < 8 && Math.abs(o.top - f.top) < 8;
		});
		check('the overlay is positioned on the code frame (getBoundingClientRect)', overlayFit);
	}

	await page.screenshot({ path: path.join(__dirname, 'screenshots', 'ui-round2.png') });
}

main()
	.then(() => {
		console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
		process.exitCode = failures === 0 ? 0 : 1;
	})
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
