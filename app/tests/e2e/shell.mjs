// @ts-check
/**
 * @file Acceptance suite for the studio SHELL (rail, panel column, toolbar,
 * context line, scaling, Split, the top bar's change count and the context line's contrast check, history, theme name/save status, contrast floors).
 * Complements `studio.mjs` (frame-targeting/page-switcher/device/follow-on-page regression checks,
 * adapted for the new DOM) rather than duplicating it.
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run
 * build`) or `npm run dev:bg`.
 *   node tests/e2e/shell.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420; under a sub-path build, the full
 * origin plus base path, e.g. http://localhost:4425/starlight-visual-customizer), SVC_CHROME_PATH,
 * SVC_BROWSER (chromium (default), firefox, webkit - see browser.mjs).
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser } from './browser.mjs';
import { contrastRatio } from '../../src/customizer/core/color.js';
import { stripBase } from '../../src/customizer/core/base-path.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
// D3a: see studio.mjs's identical constant for why this is derived, not hardcoded.
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

/** @param {import('playwright-core').Page} page @param {'light'|'dark'} [lane] */
async function getFrame(page, lane = 'light') {
	const handle = await page.$(`iframe[data-svc-preview][data-svc-lane="${lane}"]`);
	return handle.contentFrame();
}

/** The lane iframe's real navigated URL, read straight from `contentWindow.location.href` rather
 * than Playwright's own Frame tracking - see the Split page-switcher check for why. */
async function laneHref(page, lane) {
	return page.evaluate((l) => {
		const el = document.querySelector(`iframe[data-svc-preview][data-svc-lane="${l}"]`);
		try {
			return el.contentWindow.location.href;
		} catch {
			return el.src;
		}
	}, lane);
}

/** Polls `laneHref` until it matches `regex` or `timeout` elapses (then returns null). */
async function waitForLaneHref(page, lane, regex, timeout = 10000) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const href = await laneHref(page, lane);
		if (regex.test(href)) return href;
		await page.waitForTimeout(100);
	}
	return null;
}

async function waitForPanelBody(page, timeout = 10000) {
	await page.waitForFunction(
		() => {
			const host = document.querySelector('sl-customizer');
			return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-group'));
		},
		{ timeout }
	);
}

function normalizePath(pathname) {
	const s = String(pathname || '/');
	if (s === '/') return '/';
	return s.endsWith('/') ? s : `${s}/`;
}

/** Polls until two consecutive reads agree, or `timeoutMs` elapses - for values that settle
 * asynchronously (a smooth scroll, a debounced apply). */
async function waitForStable(getValue, { timeoutMs = 6000, intervalMs = 120 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let previous = await getValue();
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, intervalMs));
		const current = await getValue();
		if (current === previous) return current;
		previous = current;
	}
	return previous;
}

async function waitForComputed(getValue, predicate, { timeoutMs = 4000, intervalMs = 80 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		last = await getValue();
		if (predicate(last)) return last;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return last;
}

// =================================================================================================
// Script-dispatched clicks (`el.click()` inside `page.evaluate`) bypass
// real hit-testing entirely - an earlier round found the rail unresponsive to an actual `page.mouse.click()`
// even though every script-click "worked" (a real OS-level click at a rail button's center hit
// whatever the browser's compositor puts there, which turned out to be #svc-body-row/body/html
// underneath, because `:host`'s base `pointer-events: none` - needed in overlay mode, where the
// host covers the whole viewport - was never re-enabled for docked mode). These helpers drive
// REAL mouse events (`page.mouse.click`/`move`/`down`/`up`) at an element's actual on-screen
// center, so a regression in hit-testing (pointer-events, an invisible overlay stealing clicks,
// wrong z-index/stacking) fails the test the same way it would fail a real person.
// =================================================================================================

/** @param {import('playwright-core').ElementHandle | null} handle @returns {Promise<{x:number,y:number,box:{x:number,y:number,width:number,height:number}}>} */
async function centerOf(handle) {
	if (!handle) throw new Error('centerOf: null element handle (selector matched nothing)');
	// A short, explicit timeout - not Playwright's 30s default - so a real click on an element that
	// turns out to be hidden (e.g. in a rail group that isn't the currently active one) fails fast
	// with a clear error instead of silently stalling the whole suite for half a minute per occurrence.
	await handle.scrollIntoViewIfNeeded({ timeout: 5000 });
	const box = await handle.boundingBox();
	if (!box) throw new Error('centerOf: element has no bounding box (not visible/laid out)');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Real mouse click at the element's on-screen center (not a script-dispatched `.click()`). */
async function realClick(page, handle) {
	const { x, y } = await centerOf(handle);
	await page.mouse.click(x, y);
}

/** Real mouse drag along a horizontal track (a `<input type=range>`) from one fractional position
 * to another - genuine `mousedown` -> `mousemove` (stepped) -> `mouseup`, exercising the same path
 * a person dragging the thumb would. */
async function realSliderDrag(page, handle, fromFraction, toFraction) {
	const { box } = await centerOf(handle);
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * fromFraction, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * toFraction, y, { steps: 8 });
	await page.mouse.up();
}

/** Selects all text in the currently-focused field and types a replacement (Ctrl+A then real
 * keystrokes) - used for the P4 filter-auto-opens-a-collapsed-card check. */
async function retypeIntoFilter(page, text) {
	await page.keyboard.press('Control+A');
	if (text) await page.keyboard.type(text, { delay: 15 });
	else await page.keyboard.press('Delete');
}

/** @returns {Promise<import('playwright-core').ElementHandle | null>} First match for `selector` inside the panel's shadow root. */
async function shadowQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector('sl-customizer').shadowRoot.querySelector(sel), selector);
	return handle.asElement();
}

/** @returns {Promise<import('playwright-core').ElementHandle | null>} First shadow-root match for `selector` whose textContent includes `text`. */
async function shadowQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll(selector)).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
}

/** @returns {Promise<import('playwright-core').ElementHandle | null>} First light-DOM match for `selector`. */
async function lightQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector(sel), selector);
	return handle.asElement();
}

/** @returns {Promise<import('playwright-core').ElementHandle | null>} First light-DOM match for `selector` whose textContent includes `text`. */
async function lightQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelectorAll(selector)).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
}

/** @returns {Promise<import('playwright-core').ElementHandle | null>} First light-DOM match for `selector` whose `attr` equals `value`. */
async function lightQueryByAttr(page, selector, attr, value) {
	const handle = await page.evaluateHandle(
		({ selector, attr, value }) => Array.from(document.querySelectorAll(selector)).find((el) => el.getAttribute(attr) === value) ?? null,
		{ selector, attr, value }
	);
	return handle.asElement();
}

/**
 * Browser-side hit-test audit snapshot: for every visible interactive element in the host
 * document and the panel's shadow root, assert the relevant root's `elementFromPoint` at its own
 * center resolves to itself or a descendant - exactly the failure mode a real click would hit.
 * Factored out so both the per-rail-group loop below AND the
 * Inspect-active pass near the end of `main()` run the identical check, instead of drifting apart.
 * @returns {{total: number, failed: number, failures: any[]}}
 */
function hitTestAuditSnapshot() {
	function isVisible(el) {
		const cs = getComputedStyle(el);
		if (cs.visibility === 'hidden' || cs.display === 'none') return false;
		const rects = el.getClientRects();
		if (rects.length === 0) return false;
		// Excludes the sr-only pattern (tile-grid.js's real <input type=radio> under each tile:
		// clip-rect hidden, not display:none, so it DOES have a layout box - a 1x1px one at some
		// arbitrary position, which isn't a real hit-testable target; a person clicks the tile's
		// <label> (already covered separately), never this pixel).
		const r = rects[0];
		return r.width > 1 && r.height > 1;
	}
	// [role="treeitem"] covers the restyled structure tree's div-based rows.
	const selector = 'button, input, select, textarea, summary, [role="tab"], [role="treeitem"], label.svc-tile';
	let total = 0;
	let failed = 0;
	const failures = [];
	function auditRoot(root) {
		for (const el of root.querySelectorAll(selector)) {
			if (!isVisible(el)) continue;
			if (el.closest && el.closest('.svc-tiles')) continue; // audited via their own nested shadow root, below
			// `inert` on .svc-tile-preview (tile-grid.js) is BY DESIGN: it makes every cloned page
			// control inside a tile's live sample (a <summary>, an <a>, ...) un-hit-testable, so
			// elementFromPoint correctly resolves to the tile's own <label> instead - "a real mouse
			// click physically landing on the preview now always resolves to the label underneath
			// instead of a cloned control" (tile-grid.js's own file header). Auditing THIS content for
			// "hits itself" would flag the feature working as intended, not a bug.
			if (el.closest && el.closest('.svc-tile-preview')) continue;
			el.scrollIntoView({ block: 'center' });
			const r = el.getBoundingClientRect();
			const x = r.left + r.width / 2;
			const y = r.top + r.height / 2;
			total++;
			const hit = root.elementFromPoint(x, y);
			const ok = !!hit && (hit === el || el.contains(hit));
			if (!ok) {
				failed++;
				failures.push({
					tag: el.tagName,
					cls: String(el.className).slice(0, 60),
					hit: hit ? hit.tagName + (hit.className ? '.' + String(hit.className).split(' ').join('.') : '') : '(none)',
				});
			}
		}
	}
	auditRoot(document);
	const host = document.querySelector('sl-customizer');
	auditRoot(host.shadowRoot);
	for (const tilesHost of host.shadowRoot.querySelectorAll('.svc-tiles')) {
		if (!isVisible(tilesHost) || !tilesHost.shadowRoot) continue;
		auditRoot(tilesHost.shadowRoot);
	}
	return { total, failed, failures };
}

/** The scaled iframe's bounding rect must lie within its `.svc-lane-wrap`
 * CONTENT box (excluding padding/border), within 1px - a few px of clipping on the right edge at
 * device 1440 in a 1440px window was traced to the wrap's own padding being counted as available
 * space when computing the scale (studio.js's `scaleLane`). */
async function checkFrameWithinWrapContentBox(page, lane, deviceLabel) {
	const geo = await page.evaluate((lane) => {
		const laneEl = document.querySelector(`.svc-lane[data-lane="${lane}"]`);
		const wrap = laneEl.querySelector('.svc-lane-wrap');
		const frame = laneEl.querySelector('iframe[data-svc-preview]');
		const cs = getComputedStyle(wrap);
		const wrapRect = wrap.getBoundingClientRect();
		const contentBox = {
			left: wrapRect.left + parseFloat(cs.paddingLeft),
			top: wrapRect.top + parseFloat(cs.paddingTop),
			right: wrapRect.right - parseFloat(cs.paddingRight),
			bottom: wrapRect.bottom - parseFloat(cs.paddingBottom),
		};
		return { contentBox, frameRect: frame.getBoundingClientRect().toJSON() };
	}, lane);
	const tol = 1;
	const within =
		geo.frameRect.left >= geo.contentBox.left - tol &&
		geo.frameRect.right <= geo.contentBox.right + tol &&
		geo.frameRect.top >= geo.contentBox.top - tol &&
		geo.frameRect.bottom <= geo.contentBox.bottom + tol;
	check(`device ${deviceLabel} (${lane} lane): scaled frame lies within its wrapper's content box (1px tolerance)`, within, JSON.stringify(geo));
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

	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	trackErrors(page);
	await page.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
	await waitForPanelBody(page);
	await page.waitForTimeout(300);

	// =============================================================================================
	// S4: one group visible at a time; selected rail item's fill contrast
	// =============================================================================================
	{
		const info = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const groups = Array.from(host.shadowRoot.querySelectorAll('.svc-group-studio'));
			const visible = groups.filter((g) => !g.hidden && g.getClientRects().length > 0);
			const selected = host.shadowRoot.querySelector('.svc-rail-item[aria-selected="true"]');
			const rail = host.shadowRoot.querySelector('.svc-rail');
			return {
				visibleCount: visible.length,
				visibleGroup: visible[0]?.dataset.group,
				selectedGroup: selected?.dataset.group,
				fill: getComputedStyle(selected).backgroundColor,
				railBg: getComputedStyle(rail).backgroundColor,
			};
		});
		check('exactly one group panel is visible at a time', info.visibleCount === 1, JSON.stringify(info));
		check('the visible group matches the selected rail item', info.visibleGroup === info.selectedGroup, JSON.stringify(info));
		const railContrast = contrastRatio(info.fill, info.railBg);
		check('selected rail item fill is at least 3:1 against the rail background', railContrast >= 3, `${railContrast.toFixed(2)}:1`);
	}

	await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-studio-light-1440.png') });

	{
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(250);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-rail-selected.png') });
		const stillOne = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return Array.from(host.shadowRoot.querySelectorAll('.svc-group-studio')).filter((g) => !g.hidden).length;
		});
		check('switching rail groups keeps exactly one group visible', stillOne === 1, String(stillOne));
	}

	// =============================================================================================
	// Clicking the ALREADY-selected rail
	// item used to collapse the panel column - that affordance is removed. Collapsing is still
	// reachable via the panel-header collapse button and the `\` key; any rail item click (even the
	// one already selected before collapsing) reopens a collapsed panel.
	// =============================================================================================
	{
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(150);
		const stateBeforeReclick = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return { collapsed: host.__svc.isPanelCollapsed(), width: getComputedStyle(host).width };
		});
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]')); // re-click the already-selected item
		await page.waitForTimeout(150);
		const afterReclick = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const col = host.shadowRoot.querySelector('.svc-panel-col');
			return { collapsed: host.__svc.isPanelCollapsed(), colHidden: col.hidden, colVisible: getComputedStyle(col).display !== 'none', width: getComputedStyle(host).width };
		});
		check(
			're-clicking the already-selected rail item keeps the panel open (F3 reversed)',
			afterReclick.collapsed === false && !afterReclick.colHidden && afterReclick.colVisible && afterReclick.width === stateBeforeReclick.width,
			JSON.stringify({ stateBeforeReclick, afterReclick })
		);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-rail-reclick-stays-open.png') });

		// Collapsing is still reachable via the panel-header collapse button...
		const collapseBtn = await shadowQuery(page, '.svc-panel-collapse-btn');
		await realClick(page, collapseBtn);
		await page.waitForTimeout(150);
		const afterCollapseClick = await page.evaluate(() => document.querySelector('sl-customizer').__svc.isPanelCollapsed());
		check('the panel-header collapse button still collapses the panel', afterCollapseClick === true, String(afterCollapseClick));

		// ...and any rail item click (even the one already selected before collapsing) reopens it.
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(150);
		const afterReopenClick = await page.evaluate(() => document.querySelector('sl-customizer').__svc.isPanelCollapsed());
		check('any rail item click reopens a collapsed panel', afterReopenClick === false, String(afterReopenClick));

		// ...and the `\` key still toggles it (studio.js's own shortcut, unchanged by this fix).
		await page.keyboard.press('\\');
		await page.waitForTimeout(150);
		const afterBackslash = await page.evaluate(() => document.querySelector('sl-customizer').__svc.isPanelCollapsed());
		check('the "\\" key still collapses the panel', afterBackslash === true, String(afterBackslash));
		await page.keyboard.press('\\');
		await page.waitForTimeout(150);
		const afterBackslashAgain = await page.evaluate(() => document.querySelector('sl-customizer').__svc.isPanelCollapsed());
		check('the "\\" key still expands the panel again', afterBackslashAgain === false, String(afterBackslashAgain));
	}

	// =============================================================================================
	// A generic hit-test audit, not just spot-checks. For every rail
	// group, for every visible interactive element in the host document and the panel's shadow root
	// (button, input, select, textarea, summary, [role=tab], and tile labels, each in their own
	// nested shadow root since a tile grid mounts one per control), scroll it into view and assert
	// the relevant root's `elementFromPoint` at its center is the element itself or a descendant -
	// exactly the failure mode the pointer-events bug above produced (a real click landing on whatever was
	// underneath instead of the intended control).
	// =============================================================================================
	{
		const railGroups = await page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-rail-item')).map((el) => el.dataset.group));
		let grandTotal = 0;
		let grandFailed = 0;
		/** @type {any[]} */
		const allFailures = [];
		for (const groupName of railGroups) {
			await realClick(page, await shadowQuery(page, `.svc-rail-item[data-group="${groupName}"]`));
			await page.waitForTimeout(150);
			const result = await page.evaluate(hitTestAuditSnapshot);
			grandTotal += result.total;
			grandFailed += result.failed;
			for (const f of result.failures) allFailures.push({ group: groupName, ...f });
		}
		console.log(`Hit-test audit: ${grandTotal} interactive elements checked across ${railGroups.length} rail groups; ${grandFailed} failed hit-testing.`);
		check('every visible interactive element hit-tests to itself (or a descendant) at its own center, across every rail group', grandFailed === 0, JSON.stringify(allFailures.slice(0, 20)));
		// Back to a known group for the sections that follow.
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Presets"]'));
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// Every section AND every control card starts OPEN (superseding an earlier
	// "only the first section starts open" rule). Checked
	// on Colors, the first group with sections/cards this fresh page has ever opened - nothing earlier
	// in this run has clicked a section/card toggle, so sessionStorage has no overrides yet.
	// =============================================================================================
	{
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(200);
		const openState = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const panel = Array.from(host.shadowRoot.querySelectorAll('.svc-group-studio')).find((g) => g.dataset.group === 'Colors');
			const sections = Array.from(panel.querySelectorAll('.svc-section'));
			const cards = Array.from(panel.querySelectorAll('.svc-control'));
			return {
				sectionCount: sections.length,
				sectionsOpen: sections.filter((s) => s.dataset.open === 'true').length,
				cardCount: cards.length,
				cardsOpen: cards.filter((c) => c.dataset.open === 'true').length,
			};
		});
		check('every section in a never-toggled group starts open', openState.sectionCount > 0 && openState.sectionsOpen === openState.sectionCount, JSON.stringify(openState));
		check('every control card in a never-toggled group starts open', openState.cardCount > 0 && openState.cardsOpen === openState.cardCount, JSON.stringify(openState));

		// "More contrast between levels": a card's border must read against its section's own
		// (light-tinted) background, at least 1.5:1 - computed from real getComputedStyle colors, not
		// the token names, so a future palette tweak that quietly erodes the contrast fails this too.
		const bandColors = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const panel = Array.from(host.shadowRoot.querySelectorAll('.svc-group-studio')).find((g) => g.dataset.group === 'Colors');
			const section = panel.querySelector('.svc-section');
			const card = panel.querySelector('.svc-control');
			const header = panel.querySelector('.svc-section-toggle');
			return {
				sectionBg: getComputedStyle(section).backgroundColor,
				headerBg: header ? getComputedStyle(header).backgroundColor : null,
				cardBg: getComputedStyle(card).backgroundColor,
				cardBorder: getComputedStyle(card).borderTopColor,
			};
		});
		const cardBorderContrast = contrastRatio(bandColors.cardBorder, bandColors.sectionBg);
		check('a control card border is at least 1.5:1 against its section body background', cardBorderContrast >= 1.5, `${cardBorderContrast.toFixed(2)}:1 - ${JSON.stringify(bandColors)}`);
		check('the section header band is a different fill than the section body (reads as its own band)', bandColors.headerBg !== bandColors.sectionBg, JSON.stringify(bandColors));
		check('a control card is a different fill than its section body (cards pop as their own layer)', bandColors.cardBg !== bandColors.sectionBg, JSON.stringify(bandColors));

		// A section's header band must not touch its first card - the gap
		// above the first card should read the same as the gap BETWEEN cards, in every group. Checked
		// on Colors (here) and Layout (below). Colors is
		// ALREADY the selected rail item at this point (the two checks just above ran against it), so
		// the first iteration below is itself a re-click of the selected item - re-clicking makes
		// that a plain re-selection now (it used to collapse the panel instead of a no-op measuring
		// against a collapsed, zero-size panel - see the dedicated regression check above).
		for (const groupName of ['Colors', 'Layout']) {
			await realClick(page, await shadowQuery(page, `.svc-rail-item[data-group="${groupName}"]`));
			await page.waitForTimeout(200);
			const gaps = await page.evaluate((group) => {
				const host = document.querySelector('sl-customizer');
				const panel = Array.from(host.shadowRoot.querySelectorAll('.svc-group-studio')).find((g) => g.dataset.group === group);
				const section = panel.querySelector('.svc-section');
				const toggle = section.querySelector('.svc-section-toggle');
				const cards = Array.from(section.querySelectorAll(':scope > .svc-section-body > .svc-control'));
				const toggleBottom = toggle.getBoundingClientRect().bottom;
				const firstCardTop = cards[0]?.getBoundingClientRect().top;
				const headerGap = firstCardTop != null ? firstCardTop - toggleBottom : null;
				let cardGap = null;
				if (cards.length > 1) cardGap = cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().bottom;
				return { headerGap, cardGap, cardCount: cards.length };
			}, groupName);
			check(`${groupName}: the section header band has a real gap before its first card`, gaps.headerGap != null && gaps.headerGap >= 6, JSON.stringify(gaps));
			if (gaps.cardCount > 1) {
				check(`${groupName}: the header-to-first-card gap matches the card-to-card gap (within 2px)`, Math.abs(gaps.headerGap - gaps.cardGap) <= 2, JSON.stringify(gaps));
			}
			await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `c4-section-spacing-${groupName.toLowerCase()}.png`) });
		}
		// Back to Colors (the group the checks right below this one expect to be active).
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Presets"]'));
		await page.waitForTimeout(120);
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(150);

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-sections-contrast.png') });
	}

	// =============================================================================================
	// A real click on a card's header collapses it (summary shows,
	// body hides), Enter/Space (keyboard) does the same, and Expand all / Collapse all act on the
	// ACTIVE group's own cards/sections with Collapse all's two-stage behavior (cards first, sections
	// on a second press).
	// =============================================================================================
	{
		const firstCardToggle = await shadowQuery(page, '.svc-group-studio[data-group="Colors"] .svc-control .svc-control-toggle');
		const firstCard = await page.evaluateHandle((btn) => btn.closest('.svc-control'), firstCardToggle);

		const beforeCollapse = await page.evaluate((card) => ({ open: card.dataset.open, bodyVisible: getComputedStyle(card.querySelector('.svc-control-body')).display !== 'none' }), firstCard);
		check('the first Colors card starts open (body visible, no summary needed yet)', beforeCollapse.open === 'true' && beforeCollapse.bodyVisible, JSON.stringify(beforeCollapse));

		await realClick(page, firstCardToggle);
		await page.waitForTimeout(150);
		const afterCollapse = await page.evaluate(
			(card) => ({
				open: card.dataset.open,
				ariaExpanded: card.querySelector('.svc-control-toggle').getAttribute('aria-expanded'),
				bodyVisible: getComputedStyle(card.querySelector('.svc-control-body')).display !== 'none',
				summaryVisible: getComputedStyle(card.querySelector('.svc-control-summary')).display !== 'none',
				summaryText: card.querySelector('.svc-control-summary').textContent.trim(),
			}),
			firstCard
		);
		check('a real click on a card header collapses it (aria-expanded=false, body hidden)', afterCollapse.open === 'false' && afterCollapse.ariaExpanded === 'false' && !afterCollapse.bodyVisible, JSON.stringify(afterCollapse));
		check('a collapsed card shows a non-empty value summary on its header line', afterCollapse.summaryVisible && afterCollapse.summaryText.length > 0, JSON.stringify(afterCollapse));

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-collapsed-cards.png') });

		// Keyboard: focus the toggle (a real Tab-to-here is impractical to script reliably across many
		// elements - focusing programmatically then pressing a REAL key, exactly like this suite's own
		// Ctrl+Z keyboard-shortcut checks already do, is the standard way to test keyboard activation).
		await page.evaluate((card) => card.querySelector('.svc-control-toggle').focus(), firstCard);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(150);
		const afterEnter = await page.evaluate((card) => card.dataset.open, firstCard);
		check('Enter on a focused card toggle re-expands it', afterEnter === 'true', afterEnter);
		await page.keyboard.press('Space');
		await page.waitForTimeout(150);
		const afterSpace = await page.evaluate((card) => card.dataset.open, firstCard);
		check('Space on a focused card toggle collapses it again', afterSpace === 'false', afterSpace);
		// Leave it open for the sections below.
		await page.evaluate((card) => card.querySelector('.svc-control-toggle').focus(), firstCard);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(150);

		// Expand all / Collapse all - two-stage: first press collapses every card (sections stay
		// open), a second press then collapses the sections too; Expand all reopens both levels.
		const collapseAllBtn = await shadowQueryByText(page, '.svc-reset-group', 'Collapse all');
		const expandAllBtn = await shadowQueryByText(page, '.svc-reset-group', 'Expand all');
		await realClick(page, collapseAllBtn);
		await page.waitForTimeout(200);
		const afterCollapseStage1 = await page.evaluate(() => {
			const panel = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-group-studio')).find((g) => g.dataset.group === 'Colors');
			const cards = Array.from(panel.querySelectorAll('.svc-control'));
			const sections = Array.from(panel.querySelectorAll('.svc-section'));
			return { cardsOpen: cards.filter((c) => c.dataset.open === 'true').length, sectionsOpen: sections.filter((s) => s.dataset.open === 'true').length, sectionCount: sections.length };
		});
		check('Collapse all (1st press) collapses every card', afterCollapseStage1.cardsOpen === 0, JSON.stringify(afterCollapseStage1));
		check('Collapse all (1st press) leaves sections open', afterCollapseStage1.sectionsOpen === afterCollapseStage1.sectionCount, JSON.stringify(afterCollapseStage1));

		await realClick(page, collapseAllBtn);
		await page.waitForTimeout(200);
		const afterCollapseStage2 = await page.evaluate(() => {
			const panel = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-group-studio')).find((g) => g.dataset.group === 'Colors');
			const sections = Array.from(panel.querySelectorAll('.svc-section'));
			return { sectionsOpen: sections.filter((s) => s.dataset.open === 'true').length };
		});
		check('Collapse all (2nd press) also collapses every section', afterCollapseStage2.sectionsOpen === 0, JSON.stringify(afterCollapseStage2));

		await realClick(page, expandAllBtn);
		await page.waitForTimeout(200);
		const afterExpandAll = await page.evaluate(() => {
			const panel = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-group-studio')).find((g) => g.dataset.group === 'Colors');
			const cards = Array.from(panel.querySelectorAll('.svc-control'));
			const sections = Array.from(panel.querySelectorAll('.svc-section'));
			return { cardsOpen: cards.filter((c) => c.dataset.open === 'true').length, cardCount: cards.length, sectionsOpen: sections.filter((s) => s.dataset.open === 'true').length, sectionCount: sections.length };
		});
		check('Expand all reopens every card', afterExpandAll.cardsOpen === afterExpandAll.cardCount, JSON.stringify(afterExpandAll));
		check('Expand all reopens every section', afterExpandAll.sectionsOpen === afterExpandAll.sectionCount, JSON.stringify(afterExpandAll));

		// Filter auto-opens a collapsed match, and restores the user's own choice once cleared (same
		// contract as the existing section-level behavior).
		await realClick(page, collapseAllBtn); // back to "every card collapsed, sections open"
		await page.waitForTimeout(200);
		const filterInputEl = await shadowQuery(page, '.svc-filter');
		await realClick(page, filterInputEl);
		await retypeIntoFilter(page, 'accent');
		await page.waitForTimeout(200);
		const duringFilter = await page.evaluate(() => {
			const row = document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue']");
			return { hidden: row.hidden, open: row.dataset.open };
		});
		check('the control filter reopens a collapsed card that matches', duringFilter.hidden === false && duringFilter.open === 'true', JSON.stringify(duringFilter));
		await realClick(page, filterInputEl);
		await retypeIntoFilter(page, '');
		await page.waitForTimeout(200);
		const afterClear = await page.evaluate(() => document.querySelector("sl-customizer").shadowRoot.querySelector("[data-control-id='color.accent.hue']").dataset.open);
		check('clearing the filter restores the card to its own (collapsed) choice, not forced open', afterClear === 'false', afterClear);

		// Clean slate for later sections.
		await realClick(page, expandAllBtn);
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// Every range input's thumb is vertically centered on its
	// track - a pixel check, not a CSS-property assertion, since what matters is the RENDERED
	// result. `layout.contentWidth` is a plain (non-color-assist)
	// slider, so its track uses the fixed --ui-line fallback, not a live gradient.
	// =============================================================================================
	{
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Layout"]'));
		await page.waitForTimeout(200);
		const slider = await shadowQuery(page, "[data-control-id='layout.contentWidth'] input[type=range]");
		await realSliderDrag(page, slider, 0.05, 0.5); // move the thumb off the very edge, mid-track
		await page.waitForTimeout(150);
		// Decode the screenshot's real pixels with `sharp` (already a project dependency) in Node,
		// rather than an in-page <canvas> decode - more reliable, and lets this reuse the exact known
		// token colors (--ui-accent, --ui-line) the same way the rest of this suite already does.
		const buffer = await slider.screenshot();
		const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
		const THUMB_RGB = { r: 68, g: 83, b: 201 }; // --ui-accent #4453c9
		const TRACK_RGB = { r: 221, g: 225, b: 232 }; // --ui-line #dde1e8
		const dist = (r, g, b, t) => Math.sqrt((r - t.r) ** 2 + (g - t.g) ** 2 + (b - t.b) ** 2);
		let thumbMin = Infinity,
			thumbMax = -Infinity,
			trackMin = Infinity,
			trackMax = -Infinity;
		for (let y = 0; y < info.height; y++) {
			let rowHasThumb = false;
			let rowHasTrack = false;
			for (let x = 0; x < info.width; x++) {
				const i = (y * info.width + x) * info.channels;
				const [r, g, bl] = [data[i], data[i + 1], data[i + 2]];
				if (dist(r, g, bl, THUMB_RGB) < 30) rowHasThumb = true;
				else if (dist(r, g, bl, TRACK_RGB) < 15) rowHasTrack = true;
			}
			if (rowHasThumb) {
				thumbMin = Math.min(thumbMin, y);
				thumbMax = Math.max(thumbMax, y);
			}
			if (rowHasTrack) {
				trackMin = Math.min(trackMin, y);
				trackMax = Math.max(trackMax, y);
			}
		}
		const centers = {
			thumbCenter: (thumbMin + thumbMax) / 2,
			trackCenter: (trackMin + trackMax) / 2,
			thumbFound: Number.isFinite(thumbMin),
			trackFound: Number.isFinite(trackMin),
			imageHeight: info.height,
		};
		check('the thumb-color and track-color bands were both found in the slider screenshot', centers.thumbFound && centers.trackFound, JSON.stringify(centers));
		const centerDiff = Math.abs(centers.thumbCenter - centers.trackCenter);
		check('the range thumb is vertically centered on its track (within 2px)', centerDiff <= 2, `${centerDiff.toFixed(2)}px - ${JSON.stringify(centers)}`);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-slider-centered.png') });

		// Clean up: the drag above genuinely changed layout.contentWidth - undo it so later sections
		// (status bar change count, undo/redo baselines) start from a known, default state.
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// Contrast walk over every visible text node in the host chrome + panel shadow root,
	// excluding tile sample previews and the frames. Default floor 7:1 ("labels, group titles, rail
	// labels, button text and values"); an element resolving to a MUTED text color (the tokens this
	// build deliberately reserves for help/eyebrow/caption text, per styles.js's design) or an
	// ACCENT background (white text on the accent fill - buttons and the selected rail item, an
	// explicit exception) is held to 4.5:1 instead. Run this with the export
	// dialog open and again with the contrast dialog open, not just the plain panel - a dialog's
	// content is otherwise never walked at all.
	// =============================================================================================
	/** @returns {Promise<{total:number, failCount:number, rows:any[], minRatio:number, minRow:any}>} */
	async function runContrastWalk() {
		return page.evaluate(() => {
			function parseRgb(str) {
				const m = String(str || '').match(/rgba?\(([^)]+)\)/);
				if (!m) return null;
				const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
				return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
			}
			function relLuminance({ r, g, b }) {
				const lin = (c) => {
					c /= 255;
					return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
				};
				return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
			}
			function ratio(c1, c2) {
				const l1 = relLuminance(c1),
					l2 = relLuminance(c2);
				const lighter = Math.max(l1, l2),
					darker = Math.min(l1, l2);
				return (lighter + 0.05) / (darker + 0.05);
			}
			function closeColor(a, b, tol = 6) {
				return Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
			}
			function firstOpaqueBg(el) {
				let node = el;
				while (node) {
					const cs = getComputedStyle(node);
					const bg = parseRgb(cs.backgroundColor);
					if (bg && bg.a >= 0.999) return bg;
					if (node.parentElement) node = node.parentElement;
					else {
						const root = node.getRootNode();
						node = root && root.host ? root.host : null;
					}
				}
				return { r: 255, g: 255, b: 255 };
			}
			function hasDirectText(el) {
				for (const child of el.childNodes) {
					if (child.nodeType === 3 && child.textContent.trim().length > 0) return true;
				}
				return false;
			}
			function isVisible(el) {
				const cs = getComputedStyle(el);
				if (cs.visibility === 'hidden' || cs.display === 'none') return false;
				return el.getClientRects().length > 0;
			}
			function collect(root, skipSelector) {
				const found = [];
				for (const el of root.querySelectorAll('*')) {
					if (skipSelector && el.closest(skipSelector)) continue;
					if (!hasDirectText(el)) continue;
					if (!isVisible(el)) continue;
					found.push(el);
				}
				return found;
			}

			const ACCENT = { r: 68, g: 83, b: 201 }; // --ui-accent #4453c9
			const MUTED = { r: 86, g: 96, b: 114 }; // --ui-muted #566072
			// Status text (studio.astro's --ui-ok and --ui-warn: the context line's contrast check and
			// the top bar's save-failure text) is held to WCAG AA's 4.5:1, like muted text. The bottom
			// status bar it replaced showed the same information in --ui-muted.
			const OK = { r: 23, g: 112, b: 58 }; // --ui-ok #17703a
			const WARN = { r: 138, g: 83, b: 0 }; // --ui-warn #8a5300

			const host = document.querySelector('sl-customizer');
			const hostEls = collect(document.body, null);
			const panelEls = collect(host.shadowRoot, '.svc-tiles');

			const rows = [];
			let minRatio = Infinity;
			let minRow = null;
			let failCount = 0;
			for (const el of [...hostEls, ...panelEls]) {
				const cs = getComputedStyle(el);
				const textColor = parseRgb(cs.color);
				if (!textColor) continue;
				const bgColor = firstOpaqueBg(el);
				const r = ratio(textColor, bgColor);
				const floor = closeColor(bgColor, ACCENT) || closeColor(textColor, MUTED) || closeColor(textColor, OK, 2) || closeColor(textColor, WARN, 2) ? 4.5 : 7;
				if (r < minRatio) {
					minRatio = r;
					minRow = { text: (el.textContent || '').trim().slice(0, 40), tag: el.tagName, cls: el.className, ratio: r, floor };
				}
				if (r < floor) {
					failCount++;
					rows.push({ text: (el.textContent || '').trim().slice(0, 40), tag: el.tagName, cls: String(el.className).slice(0, 60), ratio: r, floor });
				}
			}
			return { total: hostEls.length + panelEls.length, failCount, rows: rows.slice(0, 20), minRatio, minRow };
		});
	}

	{
		const baseline = await runContrastWalk();
		console.log(`contrast walk (panel): ${baseline.total} text nodes checked; minimum ratio ${baseline.minRatio.toFixed(2)}:1 (${JSON.stringify(baseline.minRow)})`);
		check('every chrome text node meets its contrast floor (panel view)', baseline.failCount === 0, JSON.stringify(baseline.rows));

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openExport());
		await page.waitForTimeout(200);
		const exportWalk = await runContrastWalk();
		console.log(`contrast walk (export dialog open): ${exportWalk.total} text nodes checked; minimum ratio ${exportWalk.minRatio.toFixed(2)}:1 (${JSON.stringify(exportWalk.minRow)})`);
		check('every chrome text node meets its contrast floor (export dialog open)', exportWalk.failCount === 0, JSON.stringify(exportWalk.rows));

		// The export dialog's own buttons - including "Download
		// all (.zip)" and "Screenshot (PNG)" (Visible area/Full page) - never got a hit-test pass before
		// (the panel-wide audit above runs with the dialog closed). Scoped to the dialog itself, same
		// shape as the color-popover pass below.
		const exportHitTest = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const backdrop = host.shadowRoot.querySelector('.svc-dialog-backdrop:not([hidden])');
			if (!backdrop) return { total: 0, failed: 0, failures: [] };
			let total = 0;
			let failed = 0;
			const failures = [];
			for (const el of backdrop.querySelectorAll('button, input, label')) {
				const r = el.getBoundingClientRect();
				if (r.width <= 1 || r.height <= 1) continue;
				const x = r.left + r.width / 2;
				const y = r.top + r.height / 2;
				total++;
				const hit = host.shadowRoot.elementFromPoint(x, y);
				if (!hit || !(hit === el || el.contains(hit))) {
					failed++;
					failures.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 30) });
				}
			}
			return { total, failed, failures };
		});
		check(
			'every interactive element inside the open export dialog (including Download all/.zip and Screenshot buttons) hit-tests to itself',
			exportHitTest.total > 0 && exportHitTest.failed === 0,
			JSON.stringify(exportHitTest)
		);
		const exportButtonLabels = await page.evaluate(() =>
			Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-dialog-backdrop:not([hidden]) button')).map((b) => b.textContent.trim())
		);
		check('the export dialog shows the "Download all (.zip)" button', exportButtonLabels.includes('Download all (.zip)'), JSON.stringify(exportButtonLabels));
		check('the export dialog shows the "Visible area" screenshot button', exportButtonLabels.includes('Visible area'), JSON.stringify(exportButtonLabels));
		check('the export dialog shows the "Full page" screenshot button', exportButtonLabels.includes('Full page'), JSON.stringify(exportButtonLabels));

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openContrastDialog());
		await page.waitForTimeout(200);
		const contrastWalk = await runContrastWalk();
		console.log(`contrast walk (contrast dialog open): ${contrastWalk.total} text nodes checked; minimum ratio ${contrastWalk.minRatio.toFixed(2)}:1 (${JSON.stringify(contrastWalk.minRow)})`);
		check('every chrome text node meets its contrast floor (contrast dialog open)', contrastWalk.failCount === 0, JSON.stringify(contrastWalk.rows));
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);

		// The share-link dialog, both shapes (share.mjs covers when each one opens; this only checks
		// that their text is readable). Escape keeps the theme, so the suite's state is unchanged.
		for (const kind of ['conflict', 'damaged']) {
			await page.evaluate((k) => document.querySelector('sl-customizer').__svc.openShareLinkDialog(k), kind);
			await page.waitForTimeout(200);
			const shareWalk = await runContrastWalk();
			console.log(`contrast walk (share-link dialog, ${kind}): ${shareWalk.total} text nodes checked; minimum ratio ${shareWalk.minRatio.toFixed(2)}:1 (${JSON.stringify(shareWalk.minRow)})`);
			check(`every chrome text node meets its contrast floor (share-link dialog, ${kind})`, shareWalk.failCount === 0, JSON.stringify(shareWalk.rows));
			await page.keyboard.press('Escape');
			await page.waitForTimeout(150);
		}

		// The baseline walk above ran while Presets was active (the hit-
		// test audit loop leaves it there) - Colors' hex fields and Structure's tree/form are only in
		// the DOM while THEIR OWN group is active, so they need their own walk pass each.
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors', { scroll: false }));
		await page.waitForTimeout(200);
		const colorsWalk = await runContrastWalk();
		console.log(`contrast walk (Colors group, hex fields): ${colorsWalk.total} text nodes checked; minimum ratio ${colorsWalk.minRatio.toFixed(2)}:1 (${JSON.stringify(colorsWalk.minRow)})`);
		check('every chrome text node meets its contrast floor (Colors group)', colorsWalk.failCount === 0, JSON.stringify(colorsWalk.rows));

		// =========================================================================================
		// The color popover, open - both the hit-test audit and the
		// contrast walk, extended to cover it. The popover legitimately sits on top of (occludes)
		// whatever card is beneath it, so the hit-test pass here is SCOPED to the popover's own
		// subtree, not the whole panel (the panel-wide `hitTestAuditSnapshot` would wrongly flag an
		// occluded card behind it as a failure).
		// =========================================================================================
		await realClick(page, await shadowQuery(page, "[data-control-id='color.accent.hue'] .svc-color-picker"));
		await page.waitForTimeout(200);
		const popoverOpen = await page.evaluate(() => !document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover')?.hidden);
		check('a real click on the swatch button opens the color popover', popoverOpen);

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-color-popover.png') });

		const popoverHitTest = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const popover = host.shadowRoot.querySelector('.svc-color-popover:not([hidden])');
			if (!popover) return { total: 0, failed: 0, failures: [] };
			let total = 0;
			let failed = 0;
			const failures = [];
			for (const el of popover.querySelectorAll('button, input')) {
				const r = el.getBoundingClientRect();
				if (r.width <= 1 || r.height <= 1) continue;
				const x = r.left + r.width / 2;
				const y = r.top + r.height / 2;
				total++;
				const hit = host.shadowRoot.elementFromPoint(x, y);
				if (!hit || !(hit === el || el.contains(hit))) {
					failed++;
					failures.push({ tag: el.tagName, cls: String(el.className).slice(0, 60) });
				}
			}
			return { total, failed, failures };
		});
		check('every interactive element inside the open color popover hit-tests to itself', popoverHitTest.total > 0 && popoverHitTest.failed === 0, JSON.stringify(popoverHitTest));

		const popoverWalk = await runContrastWalk();
		console.log(`contrast walk (color popover open): ${popoverWalk.total} text nodes checked; minimum ratio ${popoverWalk.minRatio.toFixed(2)}:1 (${JSON.stringify(popoverWalk.minRow)})`);
		check('every chrome text node meets its contrast floor (color popover open)', popoverWalk.failCount === 0, JSON.stringify(popoverWalk.rows));

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		const popoverClosedAfterEsc = await page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover')?.hidden);
		check('Escape closes the color popover', popoverClosedAfterEsc);

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(200);
		const structureWalk = await runContrastWalk();
		console.log(`contrast walk (Structure group, tree + form): ${structureWalk.total} text nodes checked; minimum ratio ${structureWalk.minRatio.toFixed(2)}:1 (${JSON.stringify(structureWalk.minRow)})`);
		check('every chrome text node meets its contrast floor (Structure group)', structureWalk.failCount === 0, JSON.stringify(structureWalk.rows));

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Presets', { scroll: false }));
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// S13: theme name + save status
	// =============================================================================================
	{
		await page.evaluate(() => {
			const input = document.getElementById('svc-theme-name');
			input.value = 'Shell Suite Theme';
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await page.waitForTimeout(150);
		const saveStatus = await page.evaluate(() => {
			const el = document.getElementById('svc-save-status');
			return { hidden: el.hidden, shown: el.getClientRects().length > 0 };
		});
		check('the save status stays hidden while saving works (no "Saved locally" text)', saveStatus.hidden && !saveStatus.shown, JSON.stringify(saveStatus));

		await page.reload({ waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		await page.waitForTimeout(300);
		const nameAfterReload = await page.evaluate(() => document.getElementById('svc-theme-name').value);
		check('the theme name survives a reload', nameAfterReload === 'Shell Suite Theme', nameAfterReload);
	}

	// S13: when storage is blocked, the failure text appears right after the theme name, ahead of
	// undo and redo (T2b), and it shortens rather than disappears in a narrow window.
	{
		const blockedCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		await blockedCtx.addInitScript(() => {
			const orig = Storage.prototype.setItem;
			Storage.prototype.setItem = function (key, value) {
				if (this === window.localStorage && key !== 'starlight-theme') throw new DOMException('blocked', 'QuotaExceededError');
				return orig.call(this, key, value);
			};
		});
		const blocked = await blockedCtx.newPage();
		trackErrors(blocked);
		await blocked.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(blocked);
		await blocked.evaluate(() => {
			const input = document.getElementById('svc-theme-name');
			input.value = 'Blocked Storage';
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		const fail = await waitForComputed(
			() =>
				blocked.evaluate(() => {
					const el = document.getElementById('svc-save-status');
					const r = (id) => document.getElementById(id).getBoundingClientRect();
					return { text: el.innerText.trim(), shown: el.getClientRects().length > 0, name: r('svc-theme-name').right, saveLeft: el.getBoundingClientRect().left, saveRight: el.getBoundingClientRect().right, undo: r('svc-undo').left };
				}),
			(v) => v.shown
		);
		check('blocked storage shows "Not saved (storage blocked)"', fail.shown && fail.text === 'Not saved (storage blocked)', JSON.stringify(fail));
		check('the failure text sits between the theme name and undo', fail.name <= fail.saveLeft + 0.5 && fail.saveRight <= fail.undo + 0.5, JSON.stringify(fail));
		await blocked.setViewportSize({ width: 600, height: 800 });
		await blocked.waitForTimeout(200);
		const narrowText = await blocked.evaluate(() => document.getElementById('svc-save-status').innerText.trim());
		check('below 720px the failure text shortens to "Not saved" instead of disappearing', narrowText === 'Not saved', narrowText);
		await blockedCtx.close();
	}

	// =============================================================================================
	// S11: undo/redo - a slider drag is one step, a preset is one step, keyboard shortcuts
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors'));
		await page.waitForTimeout(200);

		// "a slider drag is one step": a REAL mouse drag (mousedown -> stepped mousemove -> mouseup)
		// along the track, not several script-dispatched `input` events - the coalescing logic
		// (core/history.js) only ever sees genuine `input` events either
		// way, but a real drag also exercises the browser's own native range-input hit-testing.
		const baseline = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const accentHueSlider = await shadowQuery(page, "[data-control-id='color.accent.hue'] input[type=range]");
		await realSliderDrag(page, accentHueSlider, 0.1, 0.9);
		await page.waitForTimeout(150);
		const afterDrag = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('the real mouse drag actually changed the value', afterDrag !== baseline && afterDrag !== undefined, `${baseline} -> ${afterDrag}`);
		const undoCanUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('undo is available after the drag', undoCanUndo);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const afterOneUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('one undo after a multi-step drag restores the PRE-drag value (coalesced into one step)', afterOneUndo === baseline, `baseline=${baseline} afterOneUndo=${afterOneUndo}`);
		const canUndoAfter = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('no further undo is available (the drag was genuinely one step)', canUndoAfter === false);

		// Redo restores it.
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.redo());
		await page.waitForTimeout(150);
		const afterRedo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('redo restores the dragged value', afterRedo === afterDrag, `expected ${afterDrag}, got ${afterRedo}`);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);

		// "a preset is one step" - a real click on the preset card. Preset cards live in the Presets
		// group's panel, which must actually be the VISIBLE one first (still on Colors from the drag
		// above) - a real click's own scrollIntoViewIfNeeded() correctly hangs on a hidden element,
		// unlike the script-dispatched `.click()` this replaced, which never noticed the gap.
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Presets"]'));
		await page.waitForTimeout(150);
		await realClick(page, await shadowQueryByText(page, '.svc-preset-card', 'Dense Technical'));
		await page.waitForTimeout(200);
		const presetState = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().preset);
		check('applying a preset changed state.preset', presetState === 'dense-technical', presetState);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const afterPresetUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState());
		check('one undo after a preset apply fully reverts it (one step)', afterPresetUndo.preset === 'starlight-default' && Object.keys(afterPresetUndo.values).length === 0, JSON.stringify(afterPresetUndo));

		// Keyboard shortcuts: focus somewhere neutral (not a text field), then Ctrl+Z / Ctrl+Shift+Z.
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.value = '99';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(150);
		await page.evaluate(() => document.getElementById('svc-drawer-toggle').focus());
		const beforeKbUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		await page.keyboard.down('Control');
		await page.keyboard.press('z');
		await page.keyboard.up('Control');
		await page.waitForTimeout(150);
		const afterKbUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('Ctrl+Z undoes via keyboard', afterKbUndo !== beforeKbUndo, `${beforeKbUndo} -> ${afterKbUndo}`);
		await page.keyboard.down('Control');
		await page.keyboard.down('Shift');
		await page.keyboard.press('z');
		await page.keyboard.up('Shift');
		await page.keyboard.up('Control');
		await page.waitForTimeout(150);
		const afterKbRedo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('Ctrl+Shift+Z redoes via keyboard', afterKbRedo === 99, `${afterKbRedo}`);

		// Real mouse clicks on the top bar's own Undo/Redo buttons (not just the __svc API/keyboard).
		const beforeBtnUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		await realClick(page, await lightQueryByAttr(page, 'button', 'aria-label', 'Undo'));
		await page.waitForTimeout(150);
		const afterBtnUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('a real click on the top bar Undo button undoes', afterBtnUndo !== beforeBtnUndo, `${beforeBtnUndo} -> ${afterBtnUndo}`);
		await realClick(page, await lightQueryByAttr(page, 'button', 'aria-label', 'Redo'));
		await page.waitForTimeout(150);
		const afterBtnRedo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('a real click on the top bar Redo button redoes', afterBtnRedo === beforeBtnUndo, `${beforeBtnUndo} vs ${afterBtnRedo}`);

		// Clean up: undo back to baseline so later sections start from a known state.
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// S5: group reset
	// =============================================================================================
	{
		// The reset-group button is hidden for Presets (P4) and lives in the group HEADER, which only
		// reflects whichever group the rail last selected - the preset-card test above left it on
		// Presets, so a real click on the (hidden there) button would hang exactly like the preset
		// card did before its own fix. Colors is where color.accent.hue actually lives anyway.
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(150);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.value = '99';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		// refreshStudioChrome() (which updates the reset-group button's disabled state) runs inside
		// scheduleApply's rAF debounce - poll rather than a fixed sleep.
		const resetBtnState = await waitForComputed(
			() =>
				page.evaluate(() => {
					const host = document.querySelector('sl-customizer');
					return host.shadowRoot.querySelector('.svc-reset-group').disabled;
				}),
			(disabled) => disabled === false
		);
		check('the reset-group button is enabled once the group has a non-default control', resetBtnState === false);
		await realClick(page, await shadowQuery(page, '.svc-reset-group'));
		await page.waitForTimeout(150);
		const afterGroupReset = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('reset-group clears the override', afterGroupReset === undefined, `${afterGroupReset}`);
		const resetBtnDisabledAfter = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return host.shadowRoot.querySelector('.svc-reset-group').disabled;
		});
		check('the reset-group button disables itself once the group is back to default', resetBtnDisabledAfter === true);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const afterResetUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('one undo after a group reset restores the pre-reset value (one step)', afterResetUndo === 99, `${afterResetUndo}`);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// S12: the top bar's change count + the context line's contrast check (the bottom status bar
	// that used to hold both is gone)
	// =============================================================================================
	{
		check('there is no bottom status bar', !(await lightQuery(page, '#svc-statusbar')));
		const countBefore = await page.evaluate(() => document.getElementById('svc-change-count').textContent);
		check('the change count starts at "0 changes"', countBefore === '0 changes', countBefore);

		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.value = '10';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		// scheduleApply is rAF-debounced (panel.js) - poll rather than a fixed sleep.
		const countAfter = await waitForComputed(
			() => page.evaluate(() => document.getElementById('svc-change-count').textContent),
			(t) => t.startsWith('1 ')
		);
		check('the change count reads "1 change" after a change', countAfter === '1 change', countAfter);

		const contrastBefore = await page.evaluate(() => {
			const el = document.getElementById('svc-contrast-status');
			return { text: el.textContent.trim(), color: getComputedStyle(el).color, inContext: !!el.closest('#svc-context-line') };
		});
		check('the context line shows "Contrast AA" in green with no overrides breaking contrast', contrastBefore.text === 'Contrast AA' && contrastBefore.color === 'rgb(23, 112, 58)' && contrastBefore.inContext, JSON.stringify(contrastBefore));

		// Break AA: set the link role override to nearly the same color as the page background.
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors'));
		await waitForComputed(
			() => page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.role.link']")),
			(v) => v === true
		);
		// The "auto" checkbox was removed (a role override now has just the
		// hex field + a clear button, "Follow the palette") - set the override through the hex field
		// itself, the same path a real user would take, and commit it the way `blur` does.
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector("[data-control-id='color.role.link']");
			const hexInput = row.querySelector('.svc-color-hex');
			hexInput.value = '#0a0a0f'; // near-black, very close to the dark-mode page background
			hexInput.dispatchEvent(new Event('blur'));
		});
		const midAfterBreak = await waitForComputed(
			() => page.evaluate(() => document.getElementById('svc-contrast-status').textContent),
			(t) => t.includes('warning')
		);
		const warnColor = await page.evaluate(() => getComputedStyle(document.getElementById('svc-contrast-status')).color);
		check('the contrast check shows a warning once a role override breaks AA', midAfterBreak.includes('warning'), midAfterBreak);
		check('the warning state is amber text', warnColor === 'rgb(138, 83, 0)', warnColor);

		// Reset all to leave a clean baseline for later sections.
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState());
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const filter = host.shadowRoot.querySelector('.svc-filter');
			filter.value = '';
		});
		// There's no public resetAll on __svc; undo back to empty.
		for (let i = 0; i < 5; i++) {
			const canUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
			if (!canUndo) break;
			await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
			await page.waitForTimeout(80);
		}
	}

	{
		await realClick(page, await lightQuery(page, '#svc-contrast-status'));
		await page.waitForTimeout(200);
		const contrastDialogOpen = await page.evaluate(() => {
			const d = document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-contrast-dialog-table');
			return !!d && d.getClientRects().length > 0;
		});
		check('clicking the contrast check opens the contrast table', contrastDialogOpen);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-contrast-dialog.png') });
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// S14: export dialog screenshot
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-tb-btn', 'Export'));
		await page.waitForTimeout(200);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-export-dialog.png') });
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// S9: Split - two frames, left light, right dark, both receive an accent change, the page
	// switcher navigates both.
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Split'));
		await page.waitForTimeout(500);

		const lightFrame = await getFrame(page, 'light');
		const darkFrame = await getFrame(page, 'dark');
		const lightTheme = await lightFrame.evaluate(() => document.documentElement.dataset.theme);
		const darkTheme = await darkFrame.evaluate(() => document.documentElement.dataset.theme);
		check('Split: the left lane is forced light', lightTheme === 'light', lightTheme);
		check('Split: the right lane is forced dark', darkTheme === 'dark', darkTheme);

		const colorBefore = {
			light: await lightFrame.evaluate(() => getComputedStyle(document.querySelector('.sl-markdown-content a')).color),
			dark: await darkFrame.evaluate(() => getComputedStyle(document.querySelector('.sl-markdown-content a')).color),
		};
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.value = '150';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(300);
		const colorAfter = {
			light: await lightFrame.evaluate(() => getComputedStyle(document.querySelector('.sl-markdown-content a')).color),
			dark: await darkFrame.evaluate(() => getComputedStyle(document.querySelector('.sl-markdown-content a')).color),
		};
		check('Split: the accent change reaches the light lane', colorBefore.light !== colorAfter.light, `${colorBefore.light} -> ${colorAfter.light}`);
		check('Split: the accent change reaches the dark lane', colorBefore.dark !== colorAfter.dark, `${colorBefore.dark} -> ${colorAfter.dark}`);
		check('Split: the lanes end up with the SAME accent link color (same state, forced theme each)', colorAfter.light !== colorAfter.dark, 'lanes should differ only by light/dark tokens, not by state');

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(200);

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-studio-split-1440.png') });

		// P8: same clipping check as the single-lane case, for BOTH lanes, at a scaled device width.
		await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', '1440px'));
		await page.waitForTimeout(400);
		await checkFrameWithinWrapContentBox(page, 'light', '1440 (Split)');
		await checkFrameWithinWrapContentBox(page, 'dark', '1440 (Split)');
		await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', 'Fills the available width'));
		await page.waitForTimeout(300);

		// Page switcher navigates both lanes. Read each lane's real navigated URL from
		// `contentWindow.location.href` (via `laneHref`, declared with the other shared helpers)
		// rather than Playwright's own Frame.url()/waitForURL: under firefox, Playwright's frame
		// tracking does not pick up a navigation this app drives by assigning
		// `frame.contentWindow.location.href` (as opposed to changing the iframe's `src` attribute) -
		// the content genuinely navigates (confirmed by reading `contentWindow.location.href` and
		// `contentDocument.readyState` directly) but `Frame.url()` keeps reporting the page from
		// before the click, indefinitely. `waitForLaneHref` polls the same real DOM state `check`
		// below reads, so the two can never disagree.
		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Document'));
		const [lightHref, darkHref] = await Promise.all([waitForLaneHref(page, 'light', /kitchen-sink/), waitForLaneHref(page, 'dark', /kitchen-sink/)]);
		const lightPath = normalizePath(stripBase(new URL(lightHref ?? (await laneHref(page, 'light'))).pathname, BASE_PATH));
		const darkPath = normalizePath(stripBase(new URL(darkHref ?? (await laneHref(page, 'dark'))).pathname, BASE_PATH));
		check('Split: the page switcher navigates the light lane', lightPath === '/demo/guides/kitchen-sink/', lightPath);
		check('Split: the page switcher navigates the dark lane too', darkPath === '/demo/guides/kitchen-sink/', darkPath);

		// Back to Style guide, then out of Split for the remaining sections.
		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Style guide'));
		await page.waitForTimeout(500);
		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Light'));
		await page.waitForTimeout(300);
	}

	// =============================================================================================
	// S8: scaling - device 1440 in a 1280 window
	// =============================================================================================
	{
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.waitForTimeout(300);
		await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', '1440px'));
		await page.waitForTimeout(400);

		const scaleLabel = await page.evaluate(() => document.getElementById('svc-scale-label').textContent);
		const scaleMatch = scaleLabel.match(/(\d+)%/);
		const scalePct = scaleMatch ? Number(scaleMatch[1]) : null;
		check('scale label shows a percentage under 100% at 1440 in a 1280px window', scalePct != null && scalePct < 100, scaleLabel);

		const frame = await getFrame(page, 'light');
		const innerWidth = await frame.evaluate(() => window.innerWidth);
		check('the frame\'s innerWidth is 1440 within 1px at device=1440', Math.abs(innerWidth - 1440) <= 1, `${innerWidth}`);
		const mediaMatches = await frame.evaluate(() => window.matchMedia('(min-width: 72rem)').matches);
		check("matchMedia('(min-width: 72rem)') is true inside the frame at device=1440", mediaMatches === true);

		// The scaled frame's bounding rect must lie within its wrapper's CONTENT box (excluding
		// padding/border), within 1px - an earlier round found a few px of clipping on the right
		// edge at device 1440 in a 1440px window (the wrap's own padding was being counted as
		// available space). Checked here for the single-lane case; the Split case is checked below.
		await checkFrameWithinWrapContentBox(page, 'light', '1440');

		// Exact repro (a scaled
		// device, focusing a targeted control) - every host ancestor of the lane iframe must stay at
		// scrollTop 0, and the iframe's top must still equal its wrapper's content-box top within 1px
		// (checkFrameWithinWrapContentBox above already covers the latter at rest; this re-checks it
		// after the scroll-triggering focus below, when the original bug actually fired).
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Code"]'));
		await page.waitForTimeout(150);
		await page.evaluate(() => {
			document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='code.fontSize'] input")?.focus();
		});
		await page.waitForTimeout(400);
		const scaledAncestorTops = await page.evaluate(() => {
			const iframe = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
			const shell = iframe.closest('.svc-lane-shell');
			return {
				shell: shell.scrollTop,
				wrap: shell.closest('.svc-lane-wrap').scrollTop,
				lane: shell.closest('.svc-lane').scrollTop,
				stage: document.getElementById('svc-stage').scrollTop,
				workarea: document.getElementById('svc-workarea').scrollTop,
				bodyRow: document.getElementById('svc-body-row').scrollTop,
				body: document.body.scrollTop,
				html: document.documentElement.scrollTop,
			};
		});
		check(
			'focusing a control at a scaled device (1440 in 1280px) never scrolls a host ancestor of the iframe',
			Object.values(scaledAncestorTops).every((v) => v === 0),
			JSON.stringify(scaledAncestorTops)
		);
		await checkFrameWithinWrapContentBox(page, 'light', '1440 (after focusing a control)');

		await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', 'Fills the available width'));
		await page.waitForTimeout(300);
		const transformAtFit = await page.evaluate(() => {
			const el = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
			return { transform: getComputedStyle(el).transform, scaleAttr: el.dataset.svcScale };
		});
		check('at Fit, the iframe has no transform', transformAtFit.transform === 'none', JSON.stringify(transformAtFit));
		check('at Fit, no scale is recorded on the frame', transformAtFit.scaleAttr === undefined, JSON.stringify(transformAtFit));

		await page.setViewportSize({ width: 1440, height: 900 });
		await page.waitForTimeout(300);
	}

	await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-studio-1280.png') }).catch(() => {});

	{
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.waitForTimeout(300);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-studio-1280.png') });
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.waitForTimeout(300);
	}

	// =============================================================================================
	// S6/S8: Mobile device screenshot
	// =============================================================================================
	{
		await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', '390px'));
		await page.waitForTimeout(400);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-device-mobile.png') });
		const frame = await getFrame(page, 'light');
		const innerWidth = await frame.evaluate(() => window.innerWidth);
		check('the frame reports 390px innerWidth at device=Mobile', Math.abs(innerWidth - 390) <= 1, `${innerWidth}`);
		await checkFrameWithinWrapContentBox(page, 'light', 'Mobile');
		await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', '820px'));
		await page.waitForTimeout(400);
		await checkFrameWithinWrapContentBox(page, 'light', 'Tablet');
		await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', 'Fills the available width'));
		await page.waitForTimeout(300);
	}

	// =============================================================================================
	// S10/I0: a Footer rail click scrolls the pagination into view (on Style guide, which has
	// pagination). I0 fix (target-highlight.js): the scroll self-corrects once or twice if the
	// just-navigated page's layout is still settling (fonts/images) when the smooth scroll lands -
	// poll for the CORRECTED, settled outcome instead of trusting a fixed wait after "scrollY looks
	// stable" (a previous version of this test flaked exactly this way in a full sequential run).
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Style guide'));
		await page.waitForTimeout(400);
		let frame = await getFrame(page, 'light');
		await frame.evaluate(() => window.scrollTo(0, 0));
		const scrollBefore = await frame.evaluate(() => window.scrollY);
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Footer"]'));
		// `waitForStable` (two EQUAL consecutive reads) can false-positive on "0, 0" while the I0 fix's
		// `waitForFontsReady` gate is still running before the first scroll ever fires - poll for an
		// ACTUAL change instead of mere stability.
		const scrollAfter = await waitForComputed(() => frame.evaluate(() => window.scrollY), (y) => y !== scrollBefore, { timeoutMs: 5000, intervalMs: 100 });
		check('a Footer rail click scrolls the frame toward the pagination', scrollAfter !== scrollBefore, `${scrollBefore} -> ${scrollAfter}`);
		const paginationVisible = await waitForComputed(
			() =>
				frame.evaluate(() => {
					const el = document.querySelector('.pagination-links');
					if (!el) return { visible: false };
					const r = el.getBoundingClientRect();
					return { visible: r.height > 0 && r.top < window.innerHeight && r.bottom > 0, rect: r.toJSON(), innerHeight: window.innerHeight, scrollY: window.scrollY };
				}),
			(v) => v.visible === true,
			{ timeoutMs: 5000, intervalMs: 150 }
		);
		check('the pagination links are in view after the Footer rail click (polled through any self-correction)', paginationVisible.visible, JSON.stringify(paginationVisible));

		// The scroll above is now driven by
		// `scrollElementIntoView` (target-highlight.js), never `Element.scrollIntoView`, so it must
		// never leave a nonzero scroll position on any host ancestor of the lane iframe.
		const hostAncestorTops = await page.evaluate(() => {
			const iframe = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
			const shell = iframe.closest('.svc-lane-shell');
			return {
				shell: shell.scrollTop,
				wrap: shell.closest('.svc-lane-wrap').scrollTop,
				lane: shell.closest('.svc-lane').scrollTop,
				stage: document.getElementById('svc-stage').scrollTop,
				workarea: document.getElementById('svc-workarea').scrollTop,
				bodyRow: document.getElementById('svc-body-row').scrollTop,
				body: document.body.scrollTop,
				html: document.documentElement.scrollTop,
			};
		});
		check(
			'the Footer rail click scroll never moves a host ancestor of the lane iframe',
			Object.values(hostAncestorTops).every((v) => v === 0),
			JSON.stringify(hostAncestorTops)
		);
	}

	// =============================================================================================
	// Footer, from a FRESH navigation, on a page with NO
	// pagination of its own (Landing) - forces the "navigate to /demo/specimen/ first, then scroll" path
	// on a document that is, by construction, brand new - exactly the "just-loaded page still
	// settling" scenario the Footer-on-Style-guide check above (already-loaded, no navigation) cannot
	// exercise at all.
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Landing'));
		await page.waitForTimeout(500);
		const frame = await getFrame(page, 'light');
		await frame.evaluate(() => window.scrollTo(0, 0));
		// F3 (reversed): the Footer test above already left "Footer" as the SELECTED rail item, so
		// this click is itself a re-click - which must still re-select (and re-scroll/re-navigate,
		// S10) exactly like any other rail click now that the old collapse-on-reclick affordance is
		// gone (see the dedicated F3 regression check earlier in this file).
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Footer"]'));
		// Landing renders an empty, zero-height `.pagination-links`. The rail must not treat that as a
		// match: it has to open the Style guide, which has real pagination. Assert the navigation
		// itself, not just what is in view afterward.
		const navigatedFromLanding = await page
			.waitForFunction(
				() => {
					const el = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
					try {
						return /specimen/.test(el.contentWindow.location.pathname);
					} catch {
						return false;
					}
				},
				undefined,
				{ timeout: 10000 }
			)
			.then(() => true, () => false);
		const landedPath = await page.evaluate(() => {
			try {
				return document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]').contentWindow.location.pathname;
			} catch {
				return null;
			}
		});
		check('a Footer rail click from Landing (empty pagination wrapper) navigates the preview to Style guide', navigatedFromLanding, String(landedPath));
		// Read through `contentDocument` on the light-DOM iframe element itself, not a Playwright
		// `Frame` handle: under firefox, re-fetching the frame right after a navigation this app
		// drives via `contentWindow.location.href` (rather than the iframe's `src` attribute) can
		// still resolve to the page from before that navigation - see the Split page-switcher check
		// above for the full account. Reading `contentDocument` straight off the element sidesteps
		// Playwright's own frame tracking entirely, so it can never be stale this way.
		const paginationVisibleFromLanding = await waitForComputed(
			() =>
				page.evaluate(() => {
					const iframe = /** @type {HTMLIFrameElement} */ (document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]'));
					const el = iframe.contentDocument?.querySelector('.pagination-links');
					if (!el) return { visible: false };
					const r = el.getBoundingClientRect();
					return { visible: r.height > 0 && r.top < iframe.contentWindow.innerHeight && r.bottom > 0, rect: r.toJSON() };
				}),
			(v) => v.visible === true,
			{ timeoutMs: 6000, intervalMs: 150 }
		);
		check('a Footer rail click from Landing navigates to Style guide and lands with pagination in view', paginationVisibleFromLanding.visible, JSON.stringify(paginationVisibleFromLanding));
	}

	// =============================================================================================
	// S10: a TOC rail click from Landing (no TOC there) falls back to navigating to /demo/specimen/,
	// then scrolls - "a TOC click from Landing switches to Style guide".
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Landing'));
		await page.waitForTimeout(500);
		let frame = await getFrame(page, 'light');
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="TOC"]'));
		await page.waitForFunction(
			() => {
				const el = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
				try {
					return /specimen/.test(el.contentWindow.location.pathname);
				} catch {
					return false;
				}
			},
			{ timeout: 10000 }
		).catch(() => {});
		await page.waitForTimeout(400);
		frame = await getFrame(page, 'light');
		const path_ = normalizePath(stripBase(new URL(frame.url()).pathname, BASE_PATH));
		check('a TOC rail click from Landing switches the frame to /demo/specimen/', path_ === '/demo/specimen/', path_);
	}

	// =============================================================================================
	// S1: below 900px the panel column becomes a drawer over the workarea, toggled from the top bar.
	// =============================================================================================
	{
		await page.setViewportSize({ width: 820, height: 800 });
		await page.waitForTimeout(300);
		const closedState = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const col = host.shadowRoot.querySelector('.svc-panel-col');
			return { drawerOpen: host.dataset.drawerOpen, colVisible: getComputedStyle(col).display !== 'none' };
		});
		check('below 900px the drawer starts closed', closedState.drawerOpen === 'false', JSON.stringify(closedState));
		check('the panel column is hidden while the drawer is closed', closedState.colVisible === false, JSON.stringify(closedState));

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-narrow-900.png') });

		await realClick(page, await lightQuery(page, '#svc-drawer-toggle'));
		await page.waitForTimeout(250);
		const openState = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const col = host.shadowRoot.querySelector('.svc-panel-col');
			return { drawerOpen: host.dataset.drawerOpen, colVisible: getComputedStyle(col).display !== 'none', railVisible: getComputedStyle(host.shadowRoot.querySelector('.svc-rail')).display !== 'none' };
		});
		check('the top bar toggle opens the drawer', openState.drawerOpen === 'true' && openState.colVisible, JSON.stringify(openState));
		check('the rail stays visible while the drawer is open (it is the entry point to reopen/close it)', openState.railVisible, JSON.stringify(openState));

		await realClick(page, await lightQuery(page, '#svc-drawer-toggle'));
		await page.waitForTimeout(200);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.waitForTimeout(300);
	}

	// =============================================================================================
	// S2: with the preview in Dark, the chrome's computed backgrounds stay light.
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Dark'));
		await page.waitForTimeout(300);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c1-studio-dark-1440.png') });

		const chromeBg = await page.evaluate(() => {
			function parseRgb(str) {
				const m = String(str || '').match(/rgba?\(([^)]+)\)/);
				if (!m) return null;
				return m[1].split(',').map((s) => parseFloat(s.trim()));
			}
			const host = document.querySelector('sl-customizer');
			const topbar = getComputedStyle(document.getElementById('svc-topbar')).backgroundColor;
			const rail = getComputedStyle(host.shadowRoot.querySelector('.svc-rail')).backgroundColor;
			const panelCol = getComputedStyle(host.shadowRoot.querySelector('.svc-panel-col')).backgroundColor;
			return { topbar: parseRgb(topbar), rail: parseRgb(rail), panelCol: parseRgb(panelCol) };
		});
		function isLight(rgb) {
			return rgb && rgb[0] > 200 && rgb[1] > 200 && rgb[2] > 200;
		}
		check('top bar background stays light when the preview is dark', isLight(chromeBg.topbar), JSON.stringify(chromeBg.topbar));
		check('rail background stays light when the preview is dark', isLight(chromeBg.rail), JSON.stringify(chromeBg.rail));
		check('panel column background stays light when the preview is dark', isLight(chromeBg.panelCol), JSON.stringify(chromeBg.panelCol));

		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Light'));
		await page.waitForTimeout(300);
	}

	// =============================================================================================
	// With Inspect active (the toolbar button, a selection chip in the
	// panel column, and the "Elements" popover all on screen), the hit-test audit and the contrast
	// walk both still pass - full coverage of Inspect's own interaction/acceptance lives in
	// `inspect.mjs`; this is only the "doesn't break the existing shell suites" half.
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Style guide'));
		await page.waitForTimeout(400);
		await realClick(page, await lightQueryByText(page, '.svc-inspect-toggle', 'Inspect'));
		await page.waitForTimeout(150);
		const inspectPressed = await page.evaluate(() => document.querySelector('.svc-inspect-toggle')?.getAttribute('aria-pressed'));
		check('the Inspect toggle reaches aria-pressed=true from a real click', inspectPressed === 'true', inspectPressed);

		const frame = await getFrame(page, 'light');
		const sidebarLink = await frame.$('nav.sidebar a[aria-current="page"]');
		if (sidebarLink) {
			await realClick(page, sidebarLink);
			await waitForComputed(
				() => page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-control-inspected')),
				(v) => v === true
			);
		}
		await realClick(page, await lightQueryByText(page, '.svc-inspect-elements-btn', 'Elements'));
		await page.waitForTimeout(150);

		const inspectHitTest = await page.evaluate(hitTestAuditSnapshot);
		check('every visible interactive element still hit-tests to itself with Inspect active (chip + Elements list open)', inspectHitTest.failed === 0, JSON.stringify(inspectHitTest.failures.slice(0, 20)));

		const inspectContrast = await runContrastWalk();
		console.log(`contrast walk (Inspect active): ${inspectContrast.total} text nodes checked; minimum ratio ${inspectContrast.minRatio.toFixed(2)}:1 (${JSON.stringify(inspectContrast.minRow)})`);
		check('every chrome text node meets its contrast floor (Inspect active)', inspectContrast.failCount === 0, JSON.stringify(inspectContrast.rows));

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		const inspectPressedAfterEsc = await page.evaluate(() => document.querySelector('.svc-inspect-toggle')?.getAttribute('aria-pressed'));
		check('Esc turns Inspect back off', inspectPressedAfterEsc === 'false', inspectPressedAfterEsc);
	}

	// =============================================================================================
	// Branding and project links: the product name in the top bar and the tab title, no leftover
	// prototype tag, the labeled GitHub pill, the About dialog (real clicks and real keys), and the
	// standalone /about/ page. Runs last because it navigates away from the studio.
	// =============================================================================================
	{
		const REPO_URL = 'https://github.com/prisant-labs/starlight-visual-customizer';
		const ABOUT_LINKS = ['https://astro.build/', 'https://starlight.astro.build/', 'https://starlight.astro.build/guides/customization/', 'https://starlight.astro.build/resources/themes/', REPO_URL];
		const basePrefix = BASE_PATH.replace(/\/$/, '');
		const brand = await page.evaluate(() => ({
			name: document.querySelector('.svc-brand-name')?.textContent,
			tag: !!document.querySelector('.svc-brand-tag'),
			title: document.title,
			github: (() => {
				const a = document.getElementById('svc-github-link');
				return a && { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), label: a.getAttribute('aria-label'), text: a.innerText.trim() };
			})(),
			about: (() => {
				const b = document.getElementById('svc-about-btn');
				return b && { tag: b.tagName, popup: b.getAttribute('aria-haspopup') };
			})(),
		}));
		check('top bar shows the product name "Starlight Visual Customizer"', brand.name === 'Starlight Visual Customizer', brand.name);
		check('no prototype variation tag next to the brand', brand.tag === false);
		check('studio tab title is "Starlight Visual Customizer"', brand.title === 'Starlight Visual Customizer', brand.title);
		check(
			'GitHub pill points at the repo, opens in a new tab, has an accessible name, and reads "GitHub"',
			brand.github?.href === REPO_URL && brand.github?.target === '_blank' && /noopener/.test(brand.github?.rel || '') && !!brand.github?.label && brand.github?.text === 'GitHub',
			JSON.stringify(brand.github)
		);
		check('About is a button that announces a dialog', brand.about?.tag === 'BUTTON' && brand.about?.popup === 'dialog', JSON.stringify(brand.about));

		const aboutState = () =>
			page.evaluate(() => {
				const d = document.getElementById('svc-about-dialog');
				return { open: d.open, focus: document.activeElement?.id || document.activeElement?.className || null };
			});
		const openAbout = async () => {
			await realClick(page, await lightQuery(page, '#svc-about-btn'));
			await page.waitForFunction(() => document.getElementById('svc-about-dialog').open, null, { timeout: 5000 });
		};

		await openAbout();
		const dialog = await page.evaluate(() => {
			const d = document.getElementById('svc-about-dialog');
			const box = d.getBoundingClientRect();
			const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
			const links = Array.from(d.querySelectorAll('a[href^="https://"]'));
			return {
				modal: d.matches(':modal'),
				h1: d.querySelector('h1')?.textContent,
				onTop: d.contains(center),
				focusInside: d.contains(document.activeElement),
				external: links.map((a) => a.getAttribute('href')),
				allNewTab: links.length > 0 && links.every((a) => a.target === '_blank' && /noopener/.test(a.rel)),
				linkColor: getComputedStyle(d.querySelector('a[href="https://starlight.astro.build/"]')).color,
				version: /Built for Starlight \d+\.\d+\.\d+/.test(d.textContent),
			};
		});
		check('About button opens a modal dialog on top of the studio, with focus inside it', dialog.modal && dialog.onTop && dialog.focusInside, JSON.stringify(dialog));
		check('About dialog renders the Markdown heading', dialog.h1 === 'About Starlight Visual Customizer', dialog.h1);
		for (const url of ABOUT_LINKS) check(`About dialog links to ${url}`, dialog.external.includes(url));
		check('About dialog external links open in a new tab', dialog.allNewTab);
		check('About dialog links use the accent-ink color', dialog.linkColor === 'rgb(58, 70, 176)', dialog.linkColor);
		check('About dialog shows the Starlight version', dialog.version);

		// Shortcuts behind the modal stand down: a plain "i" must not switch Inspect on.
		await page.keyboard.press('i');
		await page.waitForTimeout(150);
		const inspectBehind = await page.evaluate(() => document.querySelector('.svc-inspect-toggle')?.getAttribute('aria-pressed'));
		check('"i" while the About dialog is open does not toggle Inspect', inspectBehind === 'false', inspectBehind);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		const afterEsc = await aboutState();
		check('Escape closes the About dialog and returns focus to the About button', !afterEsc.open && afterEsc.focus === 'svc-about-btn', JSON.stringify(afterEsc));

		await openAbout();
		await page.mouse.click(8, 300); // left of the centered dialog: the backdrop
		await page.waitForTimeout(150);
		check('a click on the backdrop closes the About dialog', !(await aboutState()).open);

		await openAbout();
		await realClick(page, await lightQuery(page, '#svc-about-dialog .svc-about-close'));
		await page.waitForTimeout(150);
		const afterClose = await aboutState();
		check('the close button closes the About dialog and returns focus', !afterClose.open && afterClose.focus === 'svc-about-btn', JSON.stringify(afterClose));

		// The standalone page, for direct links: same text, base-aware way back to the studio.
		await page.goto(`${SVC_BASE_URL}/about/`, { waitUntil: 'networkidle' });
		const about = await page.evaluate(() => ({
			h1: document.querySelector('main h1')?.textContent,
			title: document.title,
			external: Array.from(document.querySelectorAll('main a[href^="https://"]')).map((a) => a.getAttribute('href')),
			openStudioHref: document.getElementById('about-open-studio')?.getAttribute('href'),
			// Markdown-rendered links must pick up the page's accent-ink color (the page's styles are
			// global because <Content /> renders outside the template's style scope).
			linkColor: getComputedStyle(document.querySelector('main a[href="https://starlight.astro.build/"]')).color,
		}));
		check('About page renders its Markdown heading', about.h1 === 'About Starlight Visual Customizer', about.h1);
		check('About page tab title', about.title === 'About · Starlight Visual Customizer', about.title);
		for (const url of ABOUT_LINKS) check(`About page links to ${url}`, about.external.includes(url));
		check('About page Markdown links use the accent-ink color', about.linkColor === 'rgb(58, 70, 176)', about.linkColor);
		check('About page "Open the studio" is base-aware', about.openStudioHref === `${basePrefix}/studio/`, about.openStudioHref);

		await realClick(page, await lightQuery(page, '#about-open-studio'));
		await page.waitForURL((u) => u.pathname === `${basePrefix}/studio/`, { timeout: 10000 });
		await waitForPanelBody(page);
		check('"Open the studio" on the About page returns to a working studio', !!(await lightQuery(page, '#svc-topbar .svc-brand')));
	}

	await page.close();

	// The top bar sheds text (brand name, save status, button labels) as the window narrows, but it
	// never overflows, and Export, About and GitHub stay on screen at any width.
	// T2b: undo and redo sit before the change count, so a count that grows from one digit to two
	// never shifts them (the defect that ruled out T3).
	{
		const stable = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		trackErrors(stable);
		await stable.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(stable);
		const xs = () => stable.evaluate(() => ['svc-undo', 'svc-redo'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().left * 10) / 10));
		const before = await xs();
		await stable.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Presets', { scroll: false }));
		await realClick(stable, await shadowQueryByText(stable, '.svc-preset-card', 'Editorial Serif'));
		const count = await waitForComputed(() => stable.evaluate(() => document.getElementById('svc-change-count').textContent), (t) => /^\d\d+ /.test(t));
		const after = await xs();
		check('undo and redo keep their position when the count grows to two digits', before.join() === after.join() && /^\d\d+ /.test(count), JSON.stringify({ before, after, count }));
		await stable.close();
	}

	for (const width of [1280, 1024, 820, 600, 390]) {
		const narrow = await browser.newPage({ viewport: { width, height: 800 } });
		trackErrors(narrow);
		await narrow.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(narrow);
		const bar = await narrow.evaluate(() => {
			const topbar = document.getElementById('svc-topbar');
			const onScreen = (sel) => {
				const el = document.querySelector(sel);
				if (!el) return false;
				const b = el.getBoundingClientRect();
				return b.width > 0 && b.right <= window.innerWidth + 0.5;
			};
			return {
				overflow: topbar.scrollWidth - topbar.clientWidth,
				exportOn: onScreen('#svc-topbar-actions .svc-tb-btn-primary'),
				aboutOn: onScreen('#svc-about-btn'),
				githubOn: onScreen('#svc-github-link'),
				githubLabel: document.getElementById('svc-github-link')?.innerText.trim(),
			};
		});
		check(`top bar at ${width}px: no overflow, and Export, About and GitHub are on screen`, bar.overflow <= 0 && bar.exportOn && bar.aboutOn && bar.githubOn, JSON.stringify(bar));
		// The GitHub pill keeps its label down to 720px, then sheds it with Import and Export.
		const wantLabel = width >= 720 ? 'GitHub' : '';
		check(`top bar at ${width}px: GitHub pill label is ${wantLabel ? 'shown' : 'hidden'}`, bar.githubLabel === wantLabel, JSON.stringify(bar.githubLabel));
		await narrow.close();
	}

	console.log('\nBROWSER ERRORS:', errors.length ? errors.join('\n') : '(none)');
	await browser.close();

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
