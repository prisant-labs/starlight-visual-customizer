// @ts-check
/**
 * @file "Studio sizing" e2e suite. The control at the bottom of the rail zooms the studio's own
 * chrome (top bar, page toolbar, context line, rail and panel) with CSS `zoom`, never the preview.
 * Verifies the control's place and structure (outside the rail's tablist), that the zoom reaches
 * the chrome and not the stage or the frames, that the preview gains room, that the choice
 * survives a reload, and the end stops. Then the three things placed by measured screen position
 * inside the zoomed panel - the color popover, the target-highlight box and the Structure drop
 * line - each checked against what it points at, and the dialogs and the narrow-width drawer
 * fitting the real viewport at 120%.
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run
 * build`) or `npm run dev:bg`.
 *   node tests/e2e/sizing.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420; under a sub-path build, the full
 * origin plus base path), SVC_CHROME_PATH.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIZING_STORAGE_KEY } from '../../src/customizer/core/sizing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
const EXECUTABLE_PATH = process.env.SVC_CHROME_PATH || chromium.executablePath();
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

let failures = 0;
function check(name, cond, note = '') {
	if (cond) console.log(`PASS - ${name}`);
	else {
		failures++;
		console.log(`FAIL - ${name}${note ? ` (${note})` : ''}`);
	}
}

const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

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

/** A real mouse click at the center of the first element matching `selector` in the panel's shadow
 * root (or the document, with `light`). */
async function realClick(page, selector, { light = false } = {}) {
	const handle = (await page.evaluateHandle(({ selector, light }) => (light ? document : document.querySelector('sl-customizer').shadowRoot).querySelector(selector), { selector, light })).asElement();
	if (!handle) throw new Error(`realClick: ${selector} matched nothing`);
	await handle.scrollIntoViewIfNeeded({ timeout: 5000 });
	const box = await handle.boundingBox();
	if (!box) throw new Error(`realClick: ${selector} has no bounding box`);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Opens the studio in a fresh context with `sizing` pre-stored (null: nothing stored). */
async function openStudio(browser, trackErrors, { sizing = null, width = 1440, height = 900 } = {}) {
	const context = await browser.newContext({ viewport: { width, height } });
	if (sizing != null) {
		await context.addInitScript(({ key, value }) => {
			try {
				if (!sessionStorage.getItem('svc-sizing-seeded')) {
					localStorage.setItem(key, value);
					sessionStorage.setItem('svc-sizing-seeded', '1');
				}
			} catch {}
		}, { key: SIZING_STORAGE_KEY, value: String(sizing) });
	}
	const page = await context.newPage();
	trackErrors(page);
	await page.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
	await waitForPanelBody(page);
	await page.waitForTimeout(300);
	return { context, page };
}

const readSizing = (page) =>
	page.evaluate(() => {
		const root = document.querySelector('sl-customizer').shadowRoot;
		const [down, up] = root.querySelectorAll('.svc-rail-sizing-btn');
		const z = (el) => getComputedStyle(el).zoom;
		return {
			value: root.querySelector('.svc-rail-sizing-value')?.textContent ?? null,
			downDisabled: /** @type {HTMLButtonElement} */ (down).disabled,
			upDisabled: /** @type {HTMLButtonElement} */ (up).disabled,
			topbar: z(document.getElementById('svc-topbar')),
			toolbar: z(document.getElementById('svc-toolbar')),
			context: z(document.getElementById('svc-context-line')),
			host: z(document.querySelector('sl-customizer')),
			stage: z(document.getElementById('svc-stage')),
			frame: z(/** @type {Element} */ (document.querySelector('iframe[data-svc-preview]'))),
			laneWidth: /** @type {Element} */ (document.querySelector('.svc-lane-wrap')).getBoundingClientRect().width,
			stored: (() => {
				try {
					return localStorage.getItem('svc-studio-sizing');
				} catch {
					return 'blocked';
				}
			})(),
		};
	});

async function main() {
	mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
	const errors = [];
	function trackErrors(page) {
		page.on('pageerror', (err) => errors.push(`[pageerror ${page.url()}] ${err.message}`));
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(`[console ${page.url()}] ${msg.text()}`);
		});
	}

	// =============================================================================================
	// 1. The control: place, structure, effect, persistence, end stops.
	// =============================================================================================
	{
		const { context, page } = await openStudio(browser, trackErrors);
		const layout = await page.evaluate(() => {
			const root = document.querySelector('sl-customizer').shadowRoot;
			const rail = root.querySelector('.svc-rail');
			const tabs = root.querySelector('.svc-rail-tabs');
			const sizing = root.querySelector('.svc-rail-sizing');
			const items = root.querySelectorAll('.svc-rail-item');
			const last = items[items.length - 1].getBoundingClientRect();
			const tabChildrenOk = [...tabs.children].every((el) => el.getAttribute('role') === 'tab' || el.classList.contains('svc-rail-sep'));
			return {
				sizingInRail: sizing?.parentElement === rail,
				sizingOutsideTablist: !!sizing && !tabs.contains(sizing),
				tablistRole: tabs.getAttribute('role'),
				railRole: rail.getAttribute('role'),
				tabChildrenOk,
				label: sizing?.querySelector('.svc-rail-sizing-label')?.textContent,
				groupLabel: sizing?.getAttribute('aria-label'),
				buttonLabels: [...sizing.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
				sizingBottom: sizing.getBoundingClientRect().bottom,
				sizingTop: sizing.getBoundingClientRect().top,
				railBottom: rail.getBoundingClientRect().bottom,
				lastItemBottom: last.bottom,
			};
		});
		check('the control sits in the rail, outside the tablist', layout.sizingInRail && layout.sizingOutsideTablist, JSON.stringify(layout));
		check('the tablist role moved to .svc-rail-tabs, which holds only tabs and separators', layout.tablistRole === 'tablist' && layout.railRole === null && layout.tabChildrenOk, JSON.stringify(layout));
		check('the control is labeled "Studio sizing" with named minus and plus buttons', layout.label === 'Studio sizing' && layout.groupLabel === 'Studio sizing' && layout.buttonLabels.join() === 'Smaller studio,Larger studio', JSON.stringify(layout));
		check('the control is pinned to the bottom of the rail', near(layout.sizingBottom, layout.railBottom, 1), JSON.stringify(layout));
		check('at 1440 by 900 it clears the last rail item (Structure)', layout.lastItemBottom <= layout.sizingTop + 0.5, JSON.stringify(layout));

		const start = await readSizing(page);
		check('with nothing stored the studio starts at 100%', start.value === '100%' && start.topbar === '1' && start.host === '1', JSON.stringify(start));

		await realClick(page, '.svc-rail-sizing-btn[aria-label="Smaller studio"]');
		await page.waitForTimeout(400);
		const at90 = await readSizing(page);
		check('"Smaller studio" sets 90%', at90.value === '90%', JSON.stringify(at90));
		check('at 90% the top bar, toolbar, context line and panel are zoomed to 0.9', [at90.topbar, at90.toolbar, at90.context, at90.host].every((z) => z === '0.9'), JSON.stringify(at90));
		check('the stage and the preview frame are never zoomed', at90.stage === '1' && at90.frame === '1', JSON.stringify(at90));
		check('the preview gains width when the chrome shrinks', at90.laneWidth > start.laneWidth + 20, `${start.laneWidth} -> ${at90.laneWidth}`);
		check('the size is stored in localStorage', at90.stored === '0.9', String(at90.stored));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'sizing-90.png') });

		await page.reload({ waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		const afterReload = await readSizing(page);
		check('90% survives a reload', afterReload.value === '90%' && afterReload.topbar === '0.9', JSON.stringify(afterReload));

		await realClick(page, '.svc-rail-sizing-btn[aria-label="Smaller studio"]');
		await page.waitForTimeout(200);
		const at80 = await readSizing(page);
		check('80% is the smallest step: "Smaller studio" disables there', at80.value === '80%' && at80.downDisabled && !at80.upDisabled, JSON.stringify(at80));
		for (let i = 0; i < 4; i++) {
			await realClick(page, '.svc-rail-sizing-btn[aria-label="Larger studio"]');
			await page.waitForTimeout(150);
		}
		const at120 = await readSizing(page);
		check('120% is the largest step: "Larger studio" disables there', at120.value === '120%' && at120.upDisabled && !at120.downDisabled && at120.topbar === '1.2', JSON.stringify(at120));
		const visibleAt120 = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-sizing').getBoundingClientRect().bottom <= window.innerHeight + 0.5);
		check('at 120% the control stays on screen while the rail scrolls', visibleAt120);
		await context.close();
	}

	// =============================================================================================
	// 2. The color popover opens right under its swatch at 80% and 120%.
	// =============================================================================================
	for (const sizing of [0.8, 1.2]) {
		const { context, page } = await openStudio(browser, trackErrors, { sizing });
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors'));
		await page.waitForTimeout(300);
		await realClick(page, '.svc-color-picker');
		await page.waitForTimeout(300);
		const pos = await page.evaluate(() => {
			const root = document.querySelector('sl-customizer').shadowRoot;
			const btn = root.querySelector('.svc-color-picker').getBoundingClientRect();
			const pop = [...root.querySelectorAll('.svc-color-popover')].find((el) => !(/** @type {HTMLElement} */ (el).hidden));
			const r = pop ? pop.getBoundingClientRect() : null;
			return { btnLeft: btn.left, btnBottom: btn.bottom, popLeft: r?.left ?? null, popTop: r?.top ?? null };
		});
		check(`at ${sizing * 100}% the color popover opens under its swatch (left edges match, 6px gap)`, near(pos.popLeft, pos.btnLeft, 1) && near(pos.popTop, pos.btnBottom + 6, 1), JSON.stringify(pos));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `sizing-popover-${sizing * 100}.png`) });
		await context.close();
	}

	// =============================================================================================
	// 3. The target-highlight box covers its target at 90%.
	// =============================================================================================
	{
		const { context, page } = await openStudio(browser, trackErrors, { sizing: 0.9 });
		await realClick(page, '.svc-rail-item[data-group="Code"]');
		await page.waitForTimeout(150);
		await page.evaluate(() => {
			const input = /** @type {HTMLElement} */ (document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='code.frameRadius'] input[type=range]"));
			input.focus();
		});
		// Poll until the frame's smooth scroll and the overlay both settle (as studio.mjs does).
		const read = () =>
			page.evaluate(() => {
				const frameEl = /** @type {HTMLIFrameElement} */ (document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]'));
				const code = frameEl.contentDocument?.querySelector('.expressive-code .frame');
				const overlay = /** @type {HTMLElement | null} */ (document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-target-overlay'));
				if (!code || !overlay || overlay.hidden) return null;
				const scale = Number.parseFloat(frameEl.dataset.svcScale || '1') || 1;
				const f = frameEl.getBoundingClientRect();
				const c = code.getBoundingClientRect();
				const o = overlay.getBoundingClientRect();
				const round = (n) => Math.round(n * 10) / 10;
				return {
					expected: { x: round(f.left + c.left * scale), y: round(f.top + c.top * scale), w: round(c.width * scale), h: round(c.height * scale) },
					overlay: { x: round(o.left), y: round(o.top), w: round(o.width), h: round(o.height) },
				};
			});
		let previous = null;
		let settled = null;
		for (let i = 0; i < 50; i++) {
			await page.waitForTimeout(120);
			const current = await read();
			if (current && previous && JSON.stringify(current) === JSON.stringify(previous)) {
				settled = current;
				break;
			}
			previous = current;
		}
		const ok =
			!!settled &&
			near(settled.overlay.x, settled.expected.x, 2) &&
			near(settled.overlay.y, settled.expected.y, 2) &&
			near(settled.overlay.w, settled.expected.w, 2) &&
			near(settled.overlay.h, settled.expected.h, 2);
		check('at 90% the target-highlight box covers the highlighted code block', ok, JSON.stringify(settled ?? previous));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'sizing-highlight-90.png') });
		await context.close();
	}

	// =============================================================================================
	// 4. The Structure drop line lands on the hovered row at 90%.
	// =============================================================================================
	{
		const { context, page } = await openStudio(browser, trackErrors, { sizing: 0.9 });
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(300);
		const rowAt = async (i) => (await page.evaluateHandle((idx) => document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')[idx], i)).asElement();
		const fromRow = await rowAt(1);
		const toRow = await rowAt(0);
		if (!fromRow || !toRow) throw new Error('Structure rows not found');
		const from = await fromRow.boundingBox();
		const to = await toRow.boundingBox();
		if (!from || !to) throw new Error('Structure rows have no box');
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, (from.y + to.y) / 2 + 2, { steps: 6 });
		await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.1, { steps: 6 });
		await page.waitForTimeout(150);
		const mid = await page.evaluate(() => {
			const root = document.querySelector('sl-customizer').shadowRoot;
			const dropRow = [...root.querySelectorAll('.svc-structure-row')].find((r) => /** @type {HTMLElement} */ (r).dataset.drop);
			const line = /** @type {HTMLElement | null} */ (root.querySelector('.svc-structure-drop-line'));
			const lr = line && getComputedStyle(line).display !== 'none' ? line.getBoundingClientRect() : null;
			const rr = dropRow ? dropRow.getBoundingClientRect() : null;
			return { drop: dropRow ? /** @type {HTMLElement} */ (dropRow).dataset.drop : null, lineTop: lr?.top ?? null, lineLeft: lr?.left ?? null, lineWidth: lr?.width ?? null, rowTop: rr?.top ?? null, rowLeft: rr?.left ?? null, rowWidth: rr?.width ?? null };
		});
		check('at 90% dragging toward a row\'s top edge shows a "before" marker', mid.drop === 'before', JSON.stringify(mid));
		check('at 90% the drop line sits on the hovered row\'s top edge, at its width', near(mid.lineTop, mid.rowTop, 3) && near(mid.lineLeft, mid.rowLeft, 2) && near(mid.lineWidth, mid.rowWidth, 2), JSON.stringify(mid));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'sizing-dropline-90.png') });
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await context.close();
	}

	// =============================================================================================
	// 5. At 120%, the dialogs and the narrow-width drawer still fit the real viewport.
	// =============================================================================================
	for (const [width, height] of [[1440, 900], [390, 800]]) {
		const { context, page } = await openStudio(browser, trackErrors, { sizing: 1.2, width, height });
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openExport());
		await page.waitForTimeout(300);
		const dialog = await page.evaluate(() => {
			const d = [...document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-dialog')].find((el) => el.getClientRects().length > 0);
			const r = d ? d.getBoundingClientRect() : null;
			return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight } : null;
		});
		check(`with 120% stored at ${width}px the Export dialog fits the viewport`, !!dialog && dialog.left >= -0.5 && dialog.top >= -0.5 && dialog.right <= dialog.vw + 0.5 && dialog.bottom <= dialog.vh + 0.5, JSON.stringify(dialog));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `sizing-export-120-${width}.png`) });
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		if (width < 900) {
			await realClick(page, '#svc-drawer-toggle', { light: true });
			await page.waitForTimeout(300);
			const drawer = await page.evaluate(() => {
				const root = document.querySelector('sl-customizer').shadowRoot;
				const col = root.querySelector('.svc-panel-col').getBoundingClientRect();
				const rail = root.querySelector('.svc-rail').getBoundingClientRect();
				const topbar = document.getElementById('svc-topbar');
				return { colLeft: col.left, colRight: col.right, railRight: rail.right, vw: window.innerWidth, topbarOverflow: topbar.scrollWidth - topbar.clientWidth };
			});
			check(`with 120% stored at ${width}px the drawer opens beside the rail and ends at the viewport's edge`, near(drawer.colLeft, drawer.railRight, 1) && drawer.colRight <= drawer.vw + 0.5 && drawer.colRight >= drawer.vw - 1, JSON.stringify(drawer));
			check(`with 120% stored at ${width}px the top bar does not overflow`, drawer.topbarOverflow <= 0, JSON.stringify(drawer));
			await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `sizing-drawer-120-${width}.png`) });
			await page.keyboard.press('Escape');

			// Under 900px the narrow layout has no room to spare, so sizes above 100% are capped:
			// the control shows and applies 100% and "Larger studio" is disabled with a reason.
			const capped = await readSizing(page);
			const upTitle = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-sizing-btn[aria-label="Larger studio"]').getAttribute('title'));
			check(`with 120% stored at ${width}px the studio shows and applies 100%, and "Larger studio" is disabled`, capped.value === '100%' && capped.host === '1' && capped.topbar === '1' && capped.upDisabled, JSON.stringify(capped));
			check('the disabled "Larger studio" says why', /at least 900px wide/.test(upTitle ?? ''), String(upTitle));
			check('the stored choice stays 120% while capped', capped.stored === '1.2', String(capped.stored));
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.waitForTimeout(400);
			const widened = await readSizing(page);
			check('widening the window past 900px applies the stored 120% again', widened.value === '120%' && widened.topbar === '1.2', JSON.stringify(widened));
		}
		await context.close();
	}

	// Sizes below 100% still apply in the narrow layout.
	{
		const { context, page } = await openStudio(browser, trackErrors, { sizing: 0.9, width: 820, height: 800 });
		const narrow90 = await readSizing(page);
		check('at 820px a stored 90% still applies', narrow90.value === '90%' && narrow90.topbar === '0.9' && !narrow90.upDisabled, JSON.stringify(narrow90));
		const overflow = await page.evaluate(() => {
			const t = document.getElementById('svc-topbar');
			return t.scrollWidth - t.clientWidth;
		});
		check('at 820px and 90% the top bar does not overflow', overflow <= 0, String(overflow));
		await context.close();
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
