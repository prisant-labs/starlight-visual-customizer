// @ts-check
/**
 * @file Verification for the tile-grid controls (a grid of clickable, illustrated option tiles that
 * replaces a `<select>` dropdown for every visual `select` control).
 * Mirrors `tests/e2e/treatments.mjs`'s per-option probe data (same `treatments.js` entries, same
 * viewport/URL overrides for the alignment controls) but drives the UI instead of hand-encoding
 * state: for each tiled control, opens its panel group, clicks each tile's radio in turn, and reads
 * the same (selector, property) probe on the real page treatments.mjs already trusts. This checks
 * the *wiring* (tile click -> state -> live CSS), not CSS correctness a second time (treatments.mjs
 * already owns that).
 *
 * Covers:
 *  1. a radio group exists with one tile per option, for every tiled control;
 *  2. clicking each tile changes the page's probe/computed style exactly as the dropdown did;
 *  3. keyboard arrow keys move selection (checked on a representative sample - it's the platform's
 *     own native radio-group behavior, identical for every one of these grids, not per-control
 *     application logic worth re-proving 19 times);
 *  4. tiles re-render with a new accent color after changing `color.accent.hue` (checked on the
 *     live-sample control the spec named as the spike - `sidebar.activeStyle` - plus one more).
 * Also spot-checks the font-list controls (a different widget, not a tile grid, but built the same
 * way: native radios + `onCommit`) since they sit right next to the tiled ones in Typography.
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after
 * `npm run build`) or `npm run dev:bg`.
 *   node tests/e2e/tiles.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420 = this project's production preview; use
 * http://localhost:4700 for its dev server; under a sub-path build, the full origin plus base path,
 * e.g. http://localhost:4425/astro-starlight-visual-customizer), SVC_CHROME_PATH.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultState, setValue, encodeState } from '../../src/customizer/core/state.js';
import { treatments } from '../../src/customizer/core/treatments.js';
import { controls } from '../../src/customizer/core/manifest.js';
import { TILE_CONTROL_IDS, computeTileLayout } from '../../src/customizer/ui/tiles/index.js';
import { WIREFRAME_CONTROL_IDS, WIREFRAME_SIZE } from '../../src/customizer/ui/tiles/wireframes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
const EXECUTABLE_PATH =
	process.env.SVC_CHROME_PATH ||
	chromium.executablePath();

// `svc-overlay`: a direct top-level visit no longer mounts
// a panel at all (a small "Open in Studio" pill instead) - this suite drives the panel's own shadow
// root directly, so it needs the escape-hatch flag to keep mounting it.
const KITCHEN_SINK = `${SVC_BASE_URL}/guides/kitchen-sink/?svc-overlay`;
// `?view` (studio design doc, item E): astro.config.mjs's `/` -> `/studio/` redirect only fires
// top-level with no `?view` in the URL - without it, this direct `page.goto('/')` would land on
// `/studio/` instead of the splash page these hero-tile checks need. `&svc-overlay` (F1, above).
const HOME = `${SVC_BASE_URL}/?view&svc-overlay`;
const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const SCREENSHOT_VIEWPORT = { width: 900, height: 1000 };

const controlsById = new Map(controls.map((c) => [c.id, c]));

/** Same overrides `treatments.mjs` uses for the six Round-2 alignment controls - the CSS is
 * gated behind Starlight's own 50rem/72rem breakpoints, so the probe only shows a diff at a
 * wide-enough viewport. */
const VIEWPORT_OVERRIDES = {
	'header.searchAlign': DESKTOP_VIEWPORT,
	'toc.position': DESKTOP_VIEWPORT,
	'layout.contentAlign': DESKTOP_VIEWPORT,
	'content.titleAlign': DESKTOP_VIEWPORT,
	'footer.paginationAlign': DESKTOP_VIEWPORT,
};
/** `content.heroAlign`'s target only exists on the home page, and its two non-default options are
 * gated on opposite sides of Hero's 50rem breakpoint (see treatments.js). */
const HERO_OPTION_VIEWPORT = { center: DESKTOP_VIEWPORT, start: MOBILE_VIEWPORT };

/** Controls with no treatments.js entry (their CSS is generated ad hoc in tile-grid.js /
 * emit-css.js, not looked up from treatments.js) get a manually supplied probe here. */
const EXTRA_PROBES = {
	'type.headingCase': { selector: '.sl-markdown-content h2', property: 'text-transform' },
	'layout.shadowElevation': { selector: '.pagination-links a', property: 'box-shadow' },
};

/** @type {{id:string, option:string, selector:string, property:string}[]} */
const tasks = [];
for (const id of TILE_CONTROL_IDS) {
	const control = controlsById.get(id);
	if (!control) continue;
	for (const opt of control.options) {
		if (opt.value === control.default) continue; // clicking the already-active default is a no-op by definition
		const probe = (treatments[id] && treatments[id][opt.value] && treatments[id][opt.value].probe) || EXTRA_PROBES[id];
		if (!probe) continue;
		tasks.push({ id, option: opt.value, selector: probe.selector, property: probe.property });
	}
}

let failures = 0;
/** @param {string} name @param {boolean} cond @param {string} [note] */
function check(name, cond, note = '') {
	if (cond) console.log(`PASS - ${name}${note ? '  (' + note + ')' : ''}`);
	else {
		failures++;
		console.log(`FAIL - ${name}${note ? '  (' + note + ')' : ''}`);
	}
}

/**
 * @param {import('playwright-core').Page} page @param {string} groupName
 * Item 3 regression guard: many tiled controls are NOT in their group's first (default-open)
 * section - e.g. `header.searchTriggerStyle`/`searchAlign` live in Header's "Search box" section,
 * `layout.shadowElevation` in "Shape", `layout.contentAlign` in "Content column",
 * `sidebar.groupLabelStyle` in "Groups", `toc.position` in "Placement",
 * `content.inlineCodeStyle`/`linkStyle`/`tableStyle`/`titleAlign`/`heroAlign`, and
 * `type.headingCase`. Without expanding every section too, those rows stay `display:none`:
 * `.screenshot()` on a hidden `.svc-tile-preview` throws, and the no-overflow/no-empty-band guards
 * below would silently see 0-size boxes and report a false pass.
 */
async function openGroupOnly(page, groupName) {
	await page.evaluate((groupName) => {
		const host = document.querySelector('sl-customizer');
		for (const toggle of host.shadowRoot.querySelectorAll('.svc-group-toggle')) {
			const group = toggle.closest('.svc-group');
			const shouldOpen = group.dataset.group === groupName;
			if ((group.dataset.open === 'true') !== shouldOpen) toggle.click();
		}
		const targetGroup = Array.from(host.shadowRoot.querySelectorAll('.svc-group')).find(
			(g) => g.dataset.group === groupName
		);
		for (const sectionToggle of targetGroup?.querySelectorAll('.svc-section-toggle') ?? []) {
			if (sectionToggle.closest('.svc-section').dataset.open !== 'true') sectionToggle.click();
		}
	}, groupName);
}

/** Expands every section in every CURRENTLY-OPEN group (see `openGroupOnly`'s doc) - for the
 * no-overflow/no-empty-band/visually-distinct guards, which open every group at once rather than
 * going through `openGroupOnly`. */
async function expandAllSections(page) {
	await page.evaluate(() => {
		const host = document.querySelector('sl-customizer');
		for (const sectionToggle of host.shadowRoot.querySelectorAll('.svc-section-toggle')) {
			if (sectionToggle.closest('.svc-section').dataset.open !== 'true') sectionToggle.click();
		}
	});
}

/** @param {import('playwright-core').Page} page @param {string} url @param {{width:number,height:number}} viewport */
async function freshLoad(page, url, viewport) {
	await page.setViewportSize(viewport);
	await page.goto(url, { waitUntil: 'networkidle' });
	await page.evaluate(() => {
		localStorage.removeItem('svc-state');
		sessionStorage.removeItem('svc-ui');
		localStorage.setItem('starlight-theme', 'dark');
		document.documentElement.dataset.theme = 'dark';
	});
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForFunction(() => {
		const host = document.querySelector('sl-customizer');
		return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-panel'));
	});
}

/** @param {import('playwright-core').Page} page @param {string} selector @param {string} property */
async function readComputed(page, selector, property) {
	return page.evaluate(
		({ selector, property }) => {
			const el = document.querySelector(selector);
			if (!el) return undefined;
			return getComputedStyle(el)[property];
		},
		{ selector, property }
	);
}

/**
 * Polls until the computed value differs from `from` (or, with `to`, equals `to`), then returns
 * the value actually read. Replaces fixed sleeps: the panel applies CSS on the next animation
 * frame, which can land well after 150ms on a loaded machine (the source of an observed 9/2/0
 * failure flake). On timeout it still returns the real value, so the caller's check reports it.
 */
async function waitForComputed(page, selector, property, { from, to, timeout = 3000 }) {
	try {
		await page.waitForFunction(
			({ selector, property, from, to, hasTo }) => {
				const el = document.querySelector(selector);
				if (!el) return false;
				const value = getComputedStyle(el)[property];
				return hasTo ? value === to : value !== from;
			},
			{ selector, property, from, to, hasTo: to !== undefined },
			{ timeout, polling: 50 }
		);
	} catch {
		/* fall through: the caller's check() reports the real before/after values */
	}
	return readComputed(page, selector, property);
}

async function main() {
	mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
	const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
	const page = await browser.newPage();
	page.on('pageerror', (err) => console.log('[browser page error]', err.message));

	// ---- 1 & 2: tile-per-option + click-changes-probe, for every tiled control -------------------
	/** @type {Map<string, {id:string, option:string}[]>} */
	const byControl = new Map();
	for (const t of tasks) {
		if (!byControl.has(t.id)) byControl.set(t.id, []);
		byControl.get(t.id).push(t);
	}

	for (const [id, optTasks] of byControl) {
		const control = controlsById.get(id);
		const isHero = id === 'content.heroAlign';
		const baseViewport = isHero ? MOBILE_VIEWPORT : VIEWPORT_OVERRIDES[id] || DEFAULT_VIEWPORT;
		const url = isHero ? HOME : KITCHEN_SINK;

		await freshLoad(page, url, baseViewport);
		await openGroupOnly(page, control.group);
		await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			host.shadowRoot.querySelector(`[data-control-id='${id}']`)?.scrollIntoView({ block: 'center' });
		}, id);

		const tileCount = await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
			const shadow = row && row.querySelector('.svc-tiles') && row.querySelector('.svc-tiles').shadowRoot;
			return shadow ? shadow.querySelectorAll('.svc-tile-radio').length : -1;
		}, id);
		check(`${id}: one tile per option (${control.options.length})`, tileCount === control.options.length, `found ${tileCount}`);

		for (const t of optTasks) {
			const viewport = isHero ? HERO_OPTION_VIEWPORT[t.option] || baseViewport : baseViewport;
			if (viewport !== baseViewport) {
				await page.setViewportSize(viewport);
				await page.waitForTimeout(50);
			}
			const before = await readComputed(page, t.selector, t.property);
			const clicked = await page.evaluate(
				({ id, value }) => {
					const host = document.querySelector('sl-customizer');
					const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
					const shadow = row.querySelector('.svc-tiles').shadowRoot;
					const radio = shadow.querySelector(`.svc-tile-radio[value="${value}"]`);
					if (!radio) return false;
					radio.click();
					return true;
				},
				{ id, value: String(t.option) }
			);
			const after = await waitForComputed(page, t.selector, t.property, { from: before });
			check(
				`${id} tile "${t.option}": clicking changes ${t.property}`,
				clicked && before !== undefined && after !== undefined && before !== after,
				clicked ? `${before} -> ${after}` : 'tile radio not found'
			);
			// Return to the control's own default tile between options so each click starts from a
			// clean baseline, same as treatments.mjs comparing every option independently to default.
			await page.evaluate(
				({ id, value }) => {
					const host = document.querySelector('sl-customizer');
					const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
					const shadow = row.querySelector('.svc-tiles').shadowRoot;
					const radio = shadow.querySelector(`.svc-tile-radio[value="${value}"]`);
					if (radio) radio.click();
				},
				{ id, value: String(control.default) }
			);
			await waitForComputed(page, t.selector, t.property, { to: before });
			if (viewport !== baseViewport) await page.setViewportSize(baseViewport);
		}
	}

	// ---- 3: keyboard arrow-key navigation - representative sample (native radio-group behavior,
	// identical mechanism for every grid) ------------------------------------------------------
	async function checkArrowNav(controlId, groupName, url = KITCHEN_SINK, viewport = DEFAULT_VIEWPORT) {
		const control = controlsById.get(controlId);
		await freshLoad(page, url, viewport);
		await openGroupOnly(page, groupName);
		const result = await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
			const shadow = row.querySelector('.svc-tiles').shadowRoot;
			const radios = Array.from(shadow.querySelectorAll('.svc-tile-radio'));
			radios[0].focus();
			return { firstValue: radios[0].value, count: radios.length };
		}, controlId);
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(150);
		const after = await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
			const shadow = row.querySelector('.svc-tiles').shadowRoot;
			const checked = shadow.querySelector('.svc-tile-radio:checked');
			return checked ? checked.value : null;
		}, controlId);
		check(
			`${controlId}: ArrowRight moves the native radio-group selection off the first tile`,
			result.count > 1 && after !== null && after !== result.firstValue
		);
	}
	await checkArrowNav('sidebar.activeStyle', 'Sidebar');
	await checkArrowNav('layout.contentAlign', 'Layout', KITCHEN_SINK, DESKTOP_VIEWPORT); // wireframe grid

	// ---- 4: tiles re-render with a new accent color after changing color.accent.hue --------------
	// Reading a tile's computed style doesn't require its group to be visually expanded (a
	// collapsed `.svc-group-body` is `display:none`, which affects layout, not the color-related
	// computed values read below) - "Colors" is open by default (DEFAULT_OPEN_GROUPS in panel.js),
	// which is all this needs (the accent-hue slider lives there; the tile being sampled is a plain
	// descendant of the panel regardless of which OTHER group's body is currently collapsed).
	async function checkAccentFollow(controlId, tileSelectorInsideShadow, cssProp) {
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		const before = await page.evaluate(
			({ id, sel, prop }) => {
				const host = document.querySelector('sl-customizer');
				const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
				const shadow = row.querySelector('.svc-tiles').shadowRoot;
				const el = shadow.querySelector(sel);
				return el ? getComputedStyle(el)[prop] : undefined;
			},
			{ id: controlId, sel: tileSelectorInsideShadow, prop: cssProp }
		);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.value = '30'; // far from default (269)
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(250);
		const after = await page.evaluate(
			({ id, sel, prop }) => {
				const host = document.querySelector('sl-customizer');
				const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
				const shadow = row.querySelector('.svc-tiles').shadowRoot;
				const el = shadow.querySelector(sel);
				return el ? getComputedStyle(el)[prop] : undefined;
			},
			{ id: controlId, sel: tileSelectorInsideShadow, prop: cssProp }
		);
		check(
			`${controlId}: tile preview recolors after color.accent.hue changes`,
			!!before && !!after && before !== after,
			`${before} -> ${after}`
		);
	}
	await checkAccentFollow('sidebar.activeStyle', ".svc-tile-canvas a[aria-current='page']", 'backgroundColor');
	await checkAccentFollow('content.linkStyle', '.svc-tile-canvas a', 'color');

	// ---- Font lists: a different widget (no tile grid), but built the same way (native radios) ---
	async function checkFontList(controlId) {
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await openGroupOnly(page, 'Typography');
		const info = await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
			const list = row.querySelector('.svc-font-list');
			return { rows: list ? list.querySelectorAll('.svc-font-row').length : 0 };
		}, controlId);
		check(`${controlId}: font list has one row per option`, info.rows > 1, `${info.rows} rows`);
		const fontBefore = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
		const clicked = await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
			const radio = Array.from(row.querySelectorAll('.svc-font-radio')).find((r) => r.value === 'lora');
			if (!radio) return false;
			radio.click();
			return true;
		}, controlId);
		await page.waitForTimeout(300);
		const fontAfter = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
		check(
			`${controlId}: clicking a font row applies it`,
			clicked && fontBefore !== fontAfter,
			`${fontBefore} -> ${fontAfter}`
		);
	}
	await checkFontList('type.font.body');

	// ---- 5: no tile preview overflows horizontally, in both themes (an earlier round found
	// pagination text clipping/wrapping and the header title running off the edge). Every live-sample
	// control's `.svc-tile-canvas` is a fixed-pixel-width "virtual canvas" (samples.js) scaled down
	// as one block - if its OWN content is wider than the canvas declared, that's a real authoring
	// bug (missing padding, no wrap), not just a scale artifact, so this checks scrollWidth against
	// the canvas's own declared width, not the (deliberately much smaller) rendered tile size. -------
	async function checkNoOverflow(theme) {
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await page.evaluate((theme) => {
			document.documentElement.dataset.theme = theme;
			localStorage.setItem('starlight-theme', theme);
		}, theme);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			for (const toggle of host.shadowRoot.querySelectorAll('.svc-group-toggle')) {
				const group = toggle.closest('.svc-group');
				if (group.dataset.open !== 'true') toggle.click();
			}
		});
		await expandAllSections(page);
		await page.waitForTimeout(400); // let every grid's ResizeObserver settle
		const overflowing = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const bad = [];
			for (const row of host.shadowRoot.querySelectorAll('[data-control-id]')) {
				const tilesHost = row.querySelector('.svc-tiles');
				const shadow = tilesHost && tilesHost.shadowRoot;
				if (!shadow) continue;
				for (const canvas of shadow.querySelectorAll('.svc-tile-canvas')) {
					if (canvas.scrollWidth > canvas.clientWidth + 1) {
						bad.push({
							control: row.dataset.controlId,
							scrollWidth: canvas.scrollWidth,
							clientWidth: canvas.clientWidth,
						});
					}
				}
			}
			return bad;
		});
		check(
			`no tile preview overflows its own virtual canvas horizontally [${theme}]`,
			overflowing.length === 0,
			overflowing.length ? JSON.stringify(overflowing.slice(0, 5)) : ''
		);
	}
	await checkNoOverflow('dark');
	await checkNoOverflow('light');

	// ---- 5b: no tile preview has a dead empty band taller than ~30% of its own height (an earlier
	// round found search-trigger/pagination-style rendering their wide canvas scaled into the top
	// ~15% of a fixed 4:3 box, leaving most of the tile blank). Compares the CANVAS's scaled height
	// (offsetHeight, unaffected by transform, times the live transform's own scale factor) against the
	// PREVIEW box's real rendered height. -----------------------------------------------------------
	async function checkNoEmptyBand(theme) {
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await page.evaluate((theme) => {
			document.documentElement.dataset.theme = theme;
			localStorage.setItem('starlight-theme', theme);
		}, theme);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			for (const toggle of host.shadowRoot.querySelectorAll('.svc-group-toggle')) {
				const group = toggle.closest('.svc-group');
				if (group.dataset.open !== 'true') toggle.click();
			}
		});
		await expandAllSections(page);
		await page.waitForTimeout(400);
		const skimpy = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const bad = [];
			for (const row of host.shadowRoot.querySelectorAll('[data-control-id]')) {
				const tilesHost = row.querySelector('.svc-tiles');
				const shadow = tilesHost && tilesHost.shadowRoot;
				if (!shadow) continue;
				for (const preview of shadow.querySelectorAll('.svc-tile-preview')) {
					const canvas = preview.querySelector('.svc-tile-canvas');
					if (canvas) {
						const m = getComputedStyle(canvas).transform.match(/matrix\(([^,]+),/);
						const scale = m ? parseFloat(m[1]) : 1;
						const scaledHeight = canvas.offsetHeight * scale;
						const cs = getComputedStyle(preview);
						const verticalPadding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
						// Compare against the preview's own CONTENT box, not its border box - a "rows"-layout
						// tile's small fixed padding (tile-grid.js's .svc-tile-preview--fit) is not itself an
						// empty band, so it shouldn't count against very short content as if it were one.
						const contentHeight = preview.getBoundingClientRect().height - verticalPadding;
						if (contentHeight > 0 && scaledHeight < contentHeight * 0.7) {
							bad.push({
								control: row.dataset.controlId,
								scaledHeight: Math.round(scaledHeight),
								contentHeight: Math.round(contentHeight),
							});
						}
						continue;
					}
					// Item 5: row-layout WIREFRAMES have no .svc-tile-canvas (pure inline SVG, no
					// ResizeObserver-scaled block) - createWireframeGrid sets an explicit `aspect-ratio`
					// inline style from WIREFRAME_SIZE instead (see tile-grid.js), so "no empty band" for
					// these means the rendered box's aspect actually matches the SVG's own viewBox aspect
					// (an SVG with width/height:100% always fills whatever box it's given exactly, so a
					// mismatch here can only mean stale/wrong CSS, not a rendering artifact). Only
					// meaningful for 'rows' layout - a 'grid' wireframe deliberately letterboxes into the
					// shared fixed 4:3 box (same as every grid tile), which is correct, not an empty band.
					const grid = shadow.querySelector('.svc-tile-grid');
					if (grid?.dataset.layout !== 'rows') continue;
					const svg = preview.querySelector('svg');
					const viewBox = svg?.getAttribute('viewBox');
					if (!viewBox) continue;
					const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
					const svgAspect = vw / vh;
					const rect = preview.getBoundingClientRect();
					const boxAspect = rect.width / rect.height;
					if (Math.abs(svgAspect - boxAspect) > svgAspect * 0.05) {
						bad.push({
							control: row.dataset.controlId,
							svgAspect: Number(svgAspect.toFixed(2)),
							boxAspect: Number(boxAspect.toFixed(2)),
							wireframe: true,
						});
					}
				}
			}
			return bad;
		});
		check(
			`no tile preview has an empty band taller than ~30% of its height [${theme}]`,
			skimpy.length === 0,
			skimpy.length ? JSON.stringify(skimpy.slice(0, 5)) : ''
		);
	}
	await checkNoEmptyBand('dark');
	await checkNoEmptyBand('light');

	// ---- 5c: no tile preview has more than ~12px of empty space below its
	// last content, measured directly (the canvas's own rendered bottom edge vs the deepest visible
	// content element's rendered bottom edge, both already in final screen pixels since
	// `getBoundingClientRect()` reflects the live CSS transform scale) rather than inferred from a
	// height/aspect comparison the way checks 5/5b above do. `header.style` is exempt: its canvas is a
	// deliberately fixed SAMPLE_VIRTUAL_HEIGHT (120px) showing a header bar layered over a little page
	// content peeking out from behind it - the gap beneath the shorter of the two is the point of the
	// sample, not wasted space. -----------------------------------------------------------------------
	async function checkTrimmedEmptySpace(theme) {
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await page.evaluate((theme) => {
			document.documentElement.dataset.theme = theme;
			localStorage.setItem('starlight-theme', theme);
		}, theme);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			for (const toggle of host.shadowRoot.querySelectorAll('.svc-group-toggle')) {
				const group = toggle.closest('.svc-group');
				if (group.dataset.open !== 'true') toggle.click();
			}
		});
		await expandAllSections(page);
		await page.waitForTimeout(400);
		const tooEmpty = await page.evaluate(() => {
			const EXEMPT = new Set(['header.style']);
			const bad = [];
			const host = document.querySelector('sl-customizer');
			for (const row of host.shadowRoot.querySelectorAll('[data-control-id]')) {
				const controlId = row.dataset.controlId;
				if (EXEMPT.has(controlId)) continue;
				const tilesHost = row.querySelector('.svc-tiles');
				const shadow = tilesHost && tilesHost.shadowRoot;
				if (!shadow) continue;
				for (const canvas of shadow.querySelectorAll('.svc-tile-canvas')) {
					const canvasBottom = canvas.getBoundingClientRect().bottom;
					let maxContentBottom = 0;
					for (const el of canvas.querySelectorAll('*')) {
						const cs = getComputedStyle(el);
						if (cs.display === 'none' || cs.visibility === 'hidden') continue;
						const r = el.getBoundingClientRect();
						if (r.width === 0 && r.height === 0) continue;
						maxContentBottom = Math.max(maxContentBottom, r.bottom);
					}
					const gap = canvasBottom - maxContentBottom;
					if (maxContentBottom > 0 && gap > 12) {
						bad.push({ control: controlId, gap: Math.round(gap) });
					}
				}
			}
			return bad;
		});
		check(
			`no tile preview has more than ~12px of empty space below its last content [${theme}]`,
			tooEmpty.length === 0,
			tooEmpty.length ? JSON.stringify(tooEmpty.slice(0, 8)) : ''
		);
	}
	await checkTrimmedEmptySpace('dark');
	await checkTrimmedEmptySpace('light');

	// ---- 6: every option tile within a control actually LOOKS different from its siblings (a
	// screenshot-Buffer-inequality regression guard for "all four look the same"), in both themes.
	// Wireframes included (cheap: SVG). Font lists excluded (not a tile
	// grid; already checked structurally above). ---------------------------------------------------
	async function checkTilesVisuallyDiffer(theme) {
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await page.evaluate((theme) => {
			document.documentElement.dataset.theme = theme;
			localStorage.setItem('starlight-theme', theme);
		}, theme);
		for (const id of byControl.keys()) {
			const control = controlsById.get(id);
			await openGroupOnly(page, control.group);
			await page.evaluate((id) => {
				const host = document.querySelector('sl-customizer');
				host.shadowRoot.querySelector(`[data-control-id='${id}']`)?.scrollIntoView({ block: 'center' });
			}, id);
			await page.waitForTimeout(200); // ResizeObserver settle for this grid's canvases
			const count = await page.evaluate((id) => {
				const host = document.querySelector('sl-customizer');
				const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
				const shadow = row.querySelector('.svc-tiles').shadowRoot;
				return shadow.querySelectorAll('.svc-tile-preview').length;
			}, id);
			const shots = [];
			for (let i = 0; i < count; i++) {
				const handle = await page.evaluateHandle(
					({ id, i }) => {
						const host = document.querySelector('sl-customizer');
						const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
						const shadow = row.querySelector('.svc-tiles').shadowRoot;
						return shadow.querySelectorAll('.svc-tile-preview')[i];
					},
					{ id, i }
				);
				const el = handle.asElement();
				shots.push(await el.screenshot());
				await handle.dispose();
			}
			let allDistinct = true;
			const dupes = [];
			for (let i = 0; i < shots.length && allDistinct; i++) {
				for (let j = i + 1; j < shots.length; j++) {
					if (shots[i].equals(shots[j])) {
						allDistinct = false;
						dupes.push(`${i}:${j}`);
					}
				}
			}
			check(`${id}: every option tile renders visually distinct from its siblings [${theme}]`, allDistinct, dupes.join(', '));
		}
	}
	await checkTilesVisuallyDiffer('dark');
	await checkTilesVisuallyDiffer('light');

	// ---- 7: REAL mouse clicks (item 2 regression). Every existing check above drives selection via
	// `radio.click()` - a synthetic DOM method call that activates the radio directly without any
	// hit-testing - which is exactly why the original bug (clicking the card activated a hidden
	// cloned control, not the radio) passed 114/114. `page.mouse.click(x, y)` is a genuine OS-level
	// synthetic click at real viewport coordinates, hit-tested through the shadow boundary same as a
	// real user's click. For every tiled control: click a real point on (a) a non-selected tile's
	// PREVIEW CENTER and (b) its CAPTION, and assert selection actually changes. Also asserts every
	// `.svc-tile-preview` carries `inert`. -------------------------------------------------------
	async function checkRealMouseClickSelectsTile(controlId) {
		const control = controlsById.get(controlId);
		const isHero = controlId === 'content.heroAlign';
		const viewport = isHero ? MOBILE_VIEWPORT : VIEWPORT_OVERRIDES[controlId] || DEFAULT_VIEWPORT;
		const url = isHero ? HOME : KITCHEN_SINK;
		const defaultValue = String(control.default);
		await freshLoad(page, url, viewport);
		await openGroupOnly(page, control.group);
		await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			host.shadowRoot.querySelector(`[data-control-id='${id}']`)?.scrollIntoView({ block: 'center' });
		}, controlId);
		await page.waitForTimeout(250); // let this grid's ResizeObserver settle before reading real rects
		// P5/P6: every tiled control is now 'rows', so a group with several of them (e.g. Components:
		// cardStyle, linkButtonStyle, badgeStyle) is much taller than before - `scrollIntoView` above
		// centers the row using whatever heights are known AT THAT MOMENT, but sibling tiles below/
		// around it can still be mid-resize (sizeToContent's own ResizeObserver, possibly a few
		// iterations to settle) and grow/shrink AFTER the scroll, leaving the target's viewport
		// position stale even though its OWN rect looks stable. Scrolling it into view a second time,
		// after the settle wait, self-corrects for that drift (the same fix shape as I0/F0's own
		// scroll-timing fixes elsewhere in this contract).
		await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			host.shadowRoot.querySelector(`[data-control-id='${id}']`)?.scrollIntoView({ block: 'center' });
		}, controlId);
		await page.waitForTimeout(150);

		const allInert = await page.evaluate((id) => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
			const shadow = row.querySelector('.svc-tiles').shadowRoot;
			const previews = Array.from(shadow.querySelectorAll('.svc-tile-preview'));
			return previews.length > 0 && previews.every((p) => p.hasAttribute('inert'));
		}, controlId);
		check(`${controlId}: every .svc-tile-preview has inert`, allInert);

		/** Reads the target's rect TWICE, ~120ms apart, and only returns once two consecutive reads
		 * agree - P5/P6 (every tiled control is now 'rows', so its own ResizeObserver-driven height
		 * can still be settling after the fixed 250ms wait above, especially for a canvas whose real
		 * row width is now WIDER than its virtual width - P6's own "no-upscale, real-width" branch,
		 * tile-grid.js) - a click fired at a rect measured mid-settle can land on the WRONG tile once
		 * a later resize shifts everything below it. Falls back to the last reading on timeout, so the
		 * check below still reports the real (if unstable) target rather than hanging the suite. */
		async function stableTargetRect(id, defaultValue, kind, timeoutMs = 2000) {
			const deadline = Date.now() + timeoutMs;
			let previous = null;
			while (Date.now() < deadline) {
				const current = await page.evaluate(
					({ id, defaultValue, kind }) => {
						const host = document.querySelector('sl-customizer');
						const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
						const shadow = row.querySelector('.svc-tiles').shadowRoot;
						const tile = Array.from(shadow.querySelectorAll('.svc-tile')).find(
							(t) => t.querySelector('.svc-tile-radio').value !== defaultValue
						);
						if (!tile) return null;
						const el = kind === 'preview' ? tile.querySelector('.svc-tile-preview') : tile.querySelector('.svc-tile-caption');
						const r = el.getBoundingClientRect();
						return { x: r.x + r.width / 2, y: r.y + r.height / 2, value: tile.querySelector('.svc-tile-radio').value };
					},
					{ id, defaultValue, kind }
				);
				if (!current) return null;
				if (previous && previous.x === current.x && previous.y === current.y) return current;
				previous = current;
				await new Promise((r) => setTimeout(r, 120));
			}
			return previous;
		}

		async function clickTargetAndCheck(kind) {
			const target = await stableTargetRect(controlId, defaultValue, kind);
			if (!target) {
				check(`${controlId}: a real mouse click on the ${kind} selects that tile`, false, 'no non-default tile found');
				return;
			}
			await page.mouse.click(target.x, target.y);
			await page.waitForTimeout(150);
			const checkedAfter = await page.evaluate((id) => {
				const host = document.querySelector('sl-customizer');
				const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
				const shadow = row.querySelector('.svc-tiles').shadowRoot;
				return shadow.querySelector('.svc-tile-radio:checked')?.value ?? null;
			}, controlId);
			check(
				`${controlId}: a real mouse click on the ${kind} selects that tile`,
				checkedAfter === target.value,
				`clicked "${target.value}", selection is now "${checkedAfter}"`
			);
			// Back to default before the next click, so each starts from the same baseline.
			await page.evaluate(
				({ id, defaultValue }) => {
					const host = document.querySelector('sl-customizer');
					const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
					const shadow = row.querySelector('.svc-tiles').shadowRoot;
					shadow.querySelector(`.svc-tile-radio[value="${defaultValue}"]`)?.click();
				},
				{ id: controlId, defaultValue }
			);
			await page.waitForTimeout(100);
		}
		await clickTargetAndCheck('preview');
		await clickTargetAndCheck('caption');
	}
	for (const id of TILE_CONTROL_IDS) {
		await checkRealMouseClickSelectsTile(id);
	}

	// ---- 7b: Tab never focuses anything inside a preview (inert removes it from tab order).
	// Traverses NESTED shadow roots to find the true active element (the grid's own shadow root is
	// nested inside the panel's shadow root) - a plain `document.activeElement` would only ever
	// report the outer host element, never the actually-focused radio inside. ----------------------
	{
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await openGroupOnly(page, 'Sidebar');
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector("[data-control-id='sidebar.activeStyle']");
			row.querySelector('.svc-tiles').shadowRoot.querySelector('.svc-tile-radio').focus();
		});
		let tabEnteredPreview = false;
		for (let i = 0; i < 8; i++) {
			await page.keyboard.press('Tab');
			const inPreview = await page.evaluate(() => {
				function deepActiveElement() {
					let el = document.activeElement;
					while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
					return el;
				}
				const el = deepActiveElement();
				return !!(el && el.closest && el.closest('.svc-tile-preview'));
			});
			if (inPreview) tabEnteredPreview = true;
		}
		check('Tab never focuses anything inside a .svc-tile-preview', !tabEnteredPreview);
	}

	// ---- 8: section collapse/expand, the dirty-dot, persistence across navigation, and
	// filter auto-open (+ restore-on-clear). Every
	// section starts OPEN (an earlier build only opened the first section) - the scenarios below
	// that need a COLLAPSED starting point now get there with an explicit real toggle click first. ----
	{
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		const initial = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const group = host.shadowRoot.querySelector("[data-group='Colors']");
			return Array.from(group.querySelectorAll('.svc-section')).map((s) => ({ name: s.dataset.section, open: s.dataset.open }));
		});
		check(
			'every section in Colors starts open, not just the first',
			initial.length > 1 && initial.every((s) => s.open === 'true'),
			JSON.stringify(initial)
		);

		// Manually collapse "Contrast" first (P4: nothing starts collapsed on its own anymore) so the
		// dot check below still exercises "shows a dot on a COLLAPSED section without opening it".
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const group = host.shadowRoot.querySelector("[data-group='Colors']");
			const section = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Contrast');
			section.querySelector('.svc-section-toggle').click();
		});
		await page.waitForTimeout(100);

		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const select = host.shadowRoot.querySelector("[data-control-id='color.contrastFloor'] select");
			select.value = 'aaa';
			select.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await page
			.waitForFunction(
				() => {
					const host = document.querySelector('sl-customizer');
					const group = host.shadowRoot.querySelector("[data-group='Colors']");
					const section = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Contrast');
					return section && section.querySelector('.svc-section-dot').hidden === false;
				},
				null,
				{ timeout: 3000, polling: 50 }
			)
			.catch(() => {}); // the check below reports the real state on timeout
		const dotState = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const group = host.shadowRoot.querySelector("[data-group='Colors']");
			const section = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Contrast');
			return { open: section.dataset.open, dotHidden: section.querySelector('.svc-section-dot').hidden };
		});
		check(
			'a dirtied control inside a COLLAPSED section shows a dot without opening it',
			dotState.open === 'false' && dotState.dotHidden === false,
			JSON.stringify(dotState)
		);

		// "Contrast" is still collapsed from the manual toggle above (P4: never reopened since) -
		// verify that CHOICE (not the default) survives a full-page navigation.
		await page.goto(`${SVC_BASE_URL}/guides/getting-started/?svc-overlay`, { waitUntil: 'networkidle' });
		await page.waitForFunction(() => {
			const host = document.querySelector('sl-customizer');
			return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-panel'));
		});
		const afterNav = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const group = host.shadowRoot.querySelector("[data-group='Colors']");
			const section = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Contrast');
			return section.dataset.open;
		});
		check('a manually-collapsed section stays collapsed across a full-page navigation', afterNav === 'false');

		// Manually collapse "Role overrides" too (P4: it no longer starts collapsed on its own) so the
		// filter's own auto-open behavior has something collapsed to prove it reopens.
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const group = host.shadowRoot.querySelector("[data-group='Colors']");
			const section = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Role overrides');
			section.querySelector('.svc-section-toggle').click();
		});
		await page.waitForTimeout(100);

		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const filterInput = host.shadowRoot.querySelector('.svc-filter');
			filterInput.value = 'sidebar background';
			filterInput.dispatchEvent(new Event('input', { bubbles: true }));
		});
		const duringFilter = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const group = host.shadowRoot.querySelector("[data-group='Colors']");
			const section = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Role overrides');
			return { open: section?.dataset.open, hidden: section?.hidden };
		});
		check(
			'the filter auto-opens a (manually collapsed) section containing a match',
			duringFilter.open === 'true' && !duringFilter.hidden,
			JSON.stringify(duringFilter)
		);

		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const filterInput = host.shadowRoot.querySelector('.svc-filter');
			filterInput.value = '';
			filterInput.dispatchEvent(new Event('input', { bubbles: true }));
		});
		const afterClear = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const group = host.shadowRoot.querySelector("[data-group='Colors']");
			const role = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Role overrides');
			const palette = Array.from(group.querySelectorAll('.svc-section')).find((s) => s.dataset.section === 'Palette');
			return { roleOpen: role.dataset.open, paletteOpen: palette.dataset.open };
		});
		check(
			"clearing the filter restores each section's OWN open/closed state (manually-collapsed Role overrides collapses back; never-toggled Palette stays open)",
			afterClear.roleOpen === 'false' && afterClear.paletteOpen === 'true',
			JSON.stringify(afterClear)
		);

		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.dispatchEvent(new Event('focus', { bubbles: true }));
		});
		const overlayVisible = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const overlay = host.shadowRoot.querySelector('.svc-target-overlay');
			return overlay ? !overlay.hidden : false;
		});
		check('follow-on-page highlighting still fires for a control nested inside a section', overlayVisible);
	}

	// ---- 9: item 1 - the theme toggle is an icon button (svg, no visible text, aria-label + title),
	// and flips data-theme. -------------------------------------------------------------------------
	{
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		const before = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const btn = Array.from(host.shadowRoot.querySelectorAll('.svc-icon-btn')).find((b) =>
				/mode/i.test(b.getAttribute('aria-label') || '')
			);
			return btn
				? {
						found: true,
						hasSvg: !!btn.querySelector('svg'),
						visibleText: btn.textContent.trim(),
						ariaLabel: btn.getAttribute('aria-label'),
						title: btn.title,
					}
				: { found: false };
		});
		check('found the theme toggle icon button (aria-label mentions "mode")', before.found);
		check('theme toggle button contains an svg icon', !!before.hasSvg);
		check('theme toggle button has no visible text', before.visibleText === '', `text was "${before.visibleText}"`);
		check('theme toggle button has a non-empty aria-label', !!before.ariaLabel, before.ariaLabel);
		check('theme toggle button has a title tooltip', !!before.title, before.title);

		const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			Array.from(host.shadowRoot.querySelectorAll('.svc-icon-btn'))
				.find((b) => /mode/i.test(b.getAttribute('aria-label') || ''))
				.click();
		});
		await page.waitForTimeout(100);
		const afterToggle = await page.evaluate(() => ({
			theme: document.documentElement.dataset.theme,
			storedTheme: localStorage.getItem('starlight-theme'),
		}));
		check(
			'clicking the theme toggle flips document.documentElement.dataset.theme',
			afterToggle.theme !== themeBefore,
			`${themeBefore} -> ${afterToggle.theme}`
		);
		check('clicking the theme toggle updates localStorage starlight-theme to match', afterToggle.storedTheme === afterToggle.theme);
	}

	// ---- 10: item 4 - the color picker sets hue (and chroma for accent, hue only for semantic);
	// swatches exist and change color when the related hue changes; the gradient track is present. --
	{
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await openGroupOnly(page, 'Colors');

		const swatchCounts = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const countFor = (id) => host.shadowRoot.querySelector(`[data-control-id='${id}']`).querySelectorAll('.svc-color-swatch').length;
			return { accent: countFor('color.accent.hue'), gray: countFor('color.gray.hue'), orange: countFor('color.hue.orange') };
		});
		check('color.accent.hue has 3 live swatches (low/base/high)', swatchCounts.accent === 3, `found ${swatchCounts.accent}`);
		check('color.gray.hue has 8 live swatches (black, gray-6..1, white)', swatchCounts.gray === 8, `found ${swatchCounts.gray}`);
		check('color.hue.orange has 3 live swatches (low/base/high)', swatchCounts.orange === 3, `found ${swatchCounts.orange}`);

		const chromaRowAssist = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector("[data-control-id='color.accent.chroma']");
			return { hasPicker: !!row.querySelector('.svc-color-picker'), hasSwatches: !!row.querySelector('.svc-color-swatch') };
		});
		check(
			"a chroma row has no picker/swatches of its own (its paired hue row already has one)",
			!chromaRowAssist.hasPicker && !chromaRowAssist.hasSwatches
		);

		const swatchBefore = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector("[data-control-id='color.accent.hue']");
			return getComputedStyle(row.querySelectorAll('.svc-color-swatch')[1]).backgroundColor;
		});
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.value = '30';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(250);
		const swatchAfter = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector("[data-control-id='color.accent.hue']");
			return getComputedStyle(row.querySelectorAll('.svc-color-swatch')[1]).backgroundColor;
		});
		check('accent swatch color changes when the hue slider changes', swatchBefore !== swatchAfter, `${swatchBefore} -> ${swatchAfter}`);

		const trackBg = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return host.shadowRoot
				.querySelector("[data-control-id='color.accent.hue'] input[type=range]")
				.style.getPropertyValue('--svc-track-bg');
		});
		check('color.accent.hue slider has a gradient track (--svc-track-bg)', trackBg.startsWith('linear-gradient'), trackBg.slice(0, 40));

		const beforeVals = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return {
				hue: host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]").value,
				chroma: host.shadowRoot.querySelector("[data-control-id='color.accent.chroma'] input[type=range]").value,
			};
		});
		// The native <input type=color> picker is now a hex-first
		// popover (vanilla-colorful) opened from a swatch BUTTON - real click it, then real click +
		// type into the POPOVER's own hex field (not the row's primary one), matching this suite's
		// real-mouse-only rule (this used to script-set the native input's `.value` directly).
		async function pickColorViaPopover(controlId, hex) {
			const btnRect = await page.evaluate((id) => {
				const row = document.querySelector('sl-customizer').shadowRoot.querySelector(`[data-control-id='${id}']`);
				const btn = row.querySelector('.svc-color-picker');
				btn.scrollIntoView({ block: 'center' });
				const r = btn.getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			}, controlId);
			await page.mouse.click(btnRect.x, btnRect.y);
			await page.waitForFunction(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover:not([hidden])'), null, { timeout: 3000 });
			// Poll the hex field's rect until two consecutive reads agree - the popover's own
			// positioning includes a `requestAnimationFrame`-deferred overflow correction (see
			// color-picker.js's `positionPopover`), so reading its rect immediately after `hidden`
			// flips can catch a pre-correction position and misfire the click below.
			let fieldRect = null;
			let previous = null;
			const deadline = Date.now() + 2000;
			while (Date.now() < deadline) {
				const current = await page.evaluate(() => {
					const popover = document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover:not([hidden])');
					const field = popover?.querySelector('.svc-color-popover-hex');
					if (!field) return null;
					const r = field.getBoundingClientRect();
					return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
				});
				if (current && current.w > 0 && current.h > 0 && previous && previous.x === current.x && previous.y === current.y) {
					fieldRect = current;
					break;
				}
				previous = current;
				await new Promise((r) => setTimeout(r, 80));
			}
			if (!fieldRect) throw new Error(`pickColorViaPopover(${controlId}): the popover's hex field never settled at a stable position`);
			await page.mouse.click(fieldRect.x, fieldRect.y);
			// Confirm focus actually landed on the hex field (shadow-DOM-correct activeElement check)
			// before typing - a click at a stale/wrong coordinate would otherwise type into nothing.
			await page
				.waitForFunction(
					() => {
						const popover = document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover:not([hidden])');
						const field = popover?.querySelector('.svc-color-popover-hex');
						return !!field && field.getRootNode().activeElement === field;
					},
					null,
					{ timeout: 2000 }
				)
				.catch(() => {}); // the commit below still runs; a failed focus just makes its own intent clear
			await page.keyboard.press('Control+A');
			await page.keyboard.type(hex, { delay: 15 });
			await page.keyboard.press('Enter');
			await page.waitForTimeout(250);
			await page.keyboard.press('Escape');
			await page.waitForTimeout(150);
		}

		await pickColorViaPopover('color.accent.hue', '#22cc55');
		const afterVals = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return {
				hue: host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]").value,
				chroma: host.shadowRoot.querySelector("[data-control-id='color.accent.chroma'] input[type=range]").value,
			};
		});
		check(
			'picking a color for accent sets BOTH hue and chroma',
			afterVals.hue !== beforeVals.hue && afterVals.chroma !== beforeVals.chroma,
			`hue ${beforeVals.hue}->${afterVals.hue}, chroma ${beforeVals.chroma}->${afterVals.chroma}`
		);

		const orangeHueBefore = await page.evaluate(
			() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.hue.orange'] input[type=range]").value
		);
		await pickColorViaPopover('color.hue.orange', '#00ffcc');
		const orangeHueAfter = await page.evaluate(
			() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.hue.orange'] input[type=range]").value
		);
		check(
			'picking a color for a semantic hue changes ONLY its hue (no chroma control exists for it)',
			orangeHueAfter !== orangeHueBefore,
			`${orangeHueBefore} -> ${orangeHueAfter}`
		);
	}

	// ---- 11: item 5 - the DOM's computed `data-layout` matches computeTileLayout's own rule, for
	// every tiled control (imports the SAME function the app uses, rather than re-deriving it). -----
	{
		await freshLoad(page, KITCHEN_SINK, DEFAULT_VIEWPORT);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			for (const toggle of host.shadowRoot.querySelectorAll('.svc-group-toggle')) {
				const group = toggle.closest('.svc-group');
				if (group.dataset.open !== 'true') toggle.click();
			}
		});
		await expandAllSections(page);
		await page.waitForTimeout(300);
		for (const id of TILE_CONTROL_IDS) {
			const control = controlsById.get(id);
			const expected = computeTileLayout(control);
			const actual = await page.evaluate((id) => {
				const host = document.querySelector('sl-customizer');
				const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
				const shadow = row?.querySelector('.svc-tiles')?.shadowRoot;
				return shadow?.querySelector('.svc-tile-grid')?.dataset.layout ?? null;
			}, id);
			check(`${id}: data-layout is "${expected}" (item 5's grid-vs-rows rule)`, actual === expected, `DOM says "${actual}"`);
		}

		// "At the current panel width (about 300 to 360px), every tile control
		// lays out in ONE column (rows)" - a single summary check over every tiled control, in addition
		// to the per-control checks just above.
		const allRows = Array.from(TILE_CONTROL_IDS).every((id) => computeTileLayout(controlsById.get(id)) === 'rows');
		check('every tiled control computes "rows" (one column) at the panel\'s real width', allRows);

		await page.screenshot({ path: path.join(__dirname, 'screenshots', 'c3-tiles-one-column.png'), fullPage: false });

		await page.evaluate(() => {
			document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='content.linkStyle']")?.scrollIntoView({ block: 'center' });
		});
		await page.waitForTimeout(150);
		const linkStyleHandle = await page.evaluateHandle(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='content.linkStyle']"));
		const linkStyleEl = linkStyleHandle.asElement();
		if (linkStyleEl) await linkStyleEl.screenshot({ path: path.join(__dirname, 'screenshots', 'c3-link-style-trimmed.png') });
	}

	// ---- Screenshots: tests/e2e/screenshots/b-tiles-<group>.png, dark + light ---------------------
	// Each group scrolls to a representative tiled control (not just scrollTop 0) so the screenshot
	// actually shows tiles, not whichever slider happens to sit above them in that group.
	const SCREENSHOT_GROUPS = [
		['Header', 'header.style'],
		['Sidebar', 'sidebar.activeStyle'],
		['TOC', 'toc.currentItemStyle'],
		['Content', 'content.asideStyle'],
		['Footer', 'footer.paginationStyle'],
		['Layout', 'layout.shadowElevation'],
	];
	for (const [groupName, scrollToId] of SCREENSHOT_GROUPS) {
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		for (const theme of ['dark', 'light']) {
			await page.evaluate((theme) => {
				document.documentElement.dataset.theme = theme;
				localStorage.setItem('starlight-theme', theme);
			}, theme);
			await openGroupOnly(page, groupName);
			await page.evaluate((id) => {
				const host = document.querySelector('sl-customizer');
				const row = host.shadowRoot.querySelector(`[data-control-id='${id}']`);
				if (row) row.scrollIntoView({ block: 'start' });
				else host.shadowRoot.querySelector('.svc-body').scrollTop = 0;
			}, scrollToId);
			await page.waitForTimeout(250);
			const box = await page.evaluate(() => {
				const host = document.querySelector('sl-customizer');
				const panel = host.shadowRoot.querySelector('.svc-panel');
				const r = panel.getBoundingClientRect();
				return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 900) };
			});
			await page.screenshot({
				path: path.join(__dirname, 'screenshots', `b-tiles-${groupName.toLowerCase()}-${theme}.png`),
				clip: box,
			});
		}
	}
	console.log('\nScreenshots written to tests/e2e/screenshots/b-tiles-<group>-<theme>.png');

	// ---- Review screenshots: tests/e2e/screenshots/b12-*.png, dark + light -------------
	async function screenshotPanel(name, theme, setup) {
		// Clicks the REAL toggle (rather than setting data-theme directly, as every other theme-switch
		// in this file does) so the icon itself stays in sync - these screenshots exist specifically
		// to review that icon, and every other check already exercises the direct-assignment path.
		await page.evaluate((theme) => {
			const host = document.querySelector('sl-customizer');
			const btn = Array.from(host.shadowRoot.querySelectorAll('.svc-icon-btn')).find((b) =>
				/mode/i.test(b.getAttribute('aria-label') || '')
			);
			if (document.documentElement.dataset.theme !== theme) btn.click();
		}, theme);
		await setup();
		await page.waitForTimeout(300);
		const box = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const panel = host.shadowRoot.querySelector('.svc-panel');
			const r = panel.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 900) };
		});
		await page.screenshot({ path: path.join(__dirname, 'screenshots', `b12-${name}-${theme}.png`), clip: box });
	}

	for (const theme of ['dark', 'light']) {
		// Panel header: icon toggle + "Follow on page" checkbox spacing (item 1).
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		await screenshotPanel('panel-header', theme, async () => {});

		// Colors group: Palette (swatches, gradient tracks, picker) plus, since every section
		// starts open now (an earlier build only opened the first section), the other
		// sections' own headers right below it too - this deliberately does NOT go through
		// `openGroupOnly` (which also expands every CARD for the functional tests above).
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		await screenshotPanel('colors', theme, async () => {
			await page.evaluate(() => {
				const host = document.querySelector('sl-customizer');
				const toggle = Array.from(host.shadowRoot.querySelectorAll('.svc-group-toggle')).find(
					(t) => t.closest('.svc-group').dataset.group === 'Colors'
				);
				if (toggle.closest('.svc-group').dataset.open !== 'true') toggle.click();
				// Scroll the Colors group header itself to the top of the panel (not scrollTop=0, which
				// would just show the Presets gallery) so the frame has room for Palette and the sections
				// below it (Semantic hues / Role overrides / Contrast).
				toggle.scrollIntoView({ block: 'start' });
			});
		});

		// Sidebar group: tiles with the caption row above the preview (item 2).
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		await screenshotPanel('sidebar', theme, async () => {
			await openGroupOnly(page, 'Sidebar');
			await page.evaluate(() => {
				const host = document.querySelector('sl-customizer');
				host.shadowRoot.querySelector("[data-control-id='sidebar.activeStyle']")?.scrollIntoView({ block: 'start' });
			});
		});

		// Header group: search alignment rendered as rows (item 5).
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		await screenshotPanel('header-group', theme, async () => {
			await openGroupOnly(page, 'Header');
			await page.evaluate(() => {
				const host = document.querySelector('sl-customizer');
				host.shadowRoot.querySelector("[data-control-id='header.searchAlign']")?.scrollIntoView({ block: 'start' });
			});
		});

		// Footer group: pagination style + alignment, both rendered as rows (item 5).
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		await screenshotPanel('footer', theme, async () => {
			await openGroupOnly(page, 'Footer');
			await page.evaluate(() => {
				const host = document.querySelector('sl-customizer');
				host.shadowRoot.querySelector("[data-control-id='footer.paginationStyle']")?.scrollIntoView({ block: 'start' });
			});
		});

		// Content group.
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		await screenshotPanel('content', theme, async () => {
			await openGroupOnly(page, 'Content');
			await page.evaluate(() => {
				const host = document.querySelector('sl-customizer');
				host.shadowRoot.querySelector("[data-control-id='content.asideStyle']")?.scrollIntoView({ block: 'start' });
			});
		});

		// Layout group.
		await freshLoad(page, KITCHEN_SINK, SCREENSHOT_VIEWPORT);
		await screenshotPanel('layout', theme, async () => {
			await openGroupOnly(page, 'Layout');
			await page.evaluate(() => {
				const host = document.querySelector('sl-customizer');
				host.shadowRoot.querySelector("[data-control-id='layout.shadowElevation']")?.scrollIntoView({ block: 'start' });
			});
		});
	}
	console.log('Screenshots written to tests/e2e/screenshots/b12-<name>-<theme>.png');

	// ---- Review screenshots for the range/toggle controls with literal selector overrides -----
	// `k1-specimen-defaults-{light,dark}.png`: the bare page (no tile interaction) so a reviewer has
	// a stock baseline to compare every `k1-<control>-<option>.png` below against.
	// `k1-<control>-<option>.png`: one screenshot per non-default option of each of the four new
	// tile-bearing choice controls, on /specimen/ (where every one of them has a real target).
	// State is set directly (same `setValue`/`encodeState` mechanism `treatments.mjs` trusts)
	// rather than by clicking through the panel: the panel is a floating overlay that can occlude
	// the very element being screenshotted, and its group/section might be collapsed - neither
	// matters to what these screenshots need to show (the PAGE's own reaction to the control).
	const SPECIMEN = `${SVC_BASE_URL}/specimen/?svc-overlay`;
	const K_SCREENSHOT_VIEWPORT = { width: 1440, height: 900 };

	/** @param {import('playwright-core').Page} page @param {string} url @param {any} state @param {'dark'|'light'} theme */
	async function loadStateForScreenshot(page, url, state, theme) {
		await page.setViewportSize(K_SCREENSHOT_VIEWPORT);
		await page.goto(url, { waitUntil: 'networkidle' });
		const encoded = encodeState(state);
		await page.evaluate(
			({ encoded, theme }) => {
				localStorage.setItem('svc-state', encoded);
				localStorage.setItem('starlight-theme', theme);
				document.documentElement.dataset.theme = theme;
			},
			{ encoded, theme }
		);
		await page.reload({ waitUntil: 'networkidle' });
	}

	for (const theme of ['light', 'dark']) {
		await loadStateForScreenshot(page, SPECIMEN, defaultState(), theme);
		await page.waitForTimeout(200);
		await page.screenshot({
			path: path.join(__dirname, 'screenshots', `k1-specimen-defaults-${theme}.png`),
			fullPage: true,
		});
	}

	/** Clip around `control.target`'s first match, clamped to the left of the floating panel (a
	 * fixed-position overlay that would otherwise occlude part of the clip on a page this narrow).
	 * `badgeStyle`'s own manifest `target` (`.sl-badge`, deliberately broad so targets.mjs/scroll-to
	 * accept ANY badge) resolves via `document.querySelector` to the FIRST one in document order,
	 * which on /specimen/ is a sidebar nav badge ("Updated" on the Changelog link) rather than the
	 * "Default/Note/Tip/..." row in the page body - a real badge, but not a representative one for a
	 * screenshot. `SCREENSHOT_CLIP` overrides the selector (and clips around the matched element's
	 * PARENT, to also catch its sibling badges on the same line) for that one control only. */
	const SCREENSHOT_CLIP = {
		'components.badgeStyle': { selector: '.sl-badge.default', useParent: true },
	};
	async function screenshotKOption(id, optionValue) {
		const control = controlsById.get(id);
		const clipOverride = SCREENSHOT_CLIP[id];
		const clipSelector = clipOverride ? clipOverride.selector : control.target;
		const state = setValue(defaultState(), id, optionValue);
		await loadStateForScreenshot(page, SPECIMEN, state, 'dark');
		await page.evaluate((sel) => {
			document.querySelector(sel)?.scrollIntoView({ block: 'center' });
		}, clipSelector);
		await page.waitForTimeout(250);
		const box = await page.evaluate(
			({ sel, useParent }) => {
				let el = document.querySelector(sel);
				if (!el) return null;
				if (useParent && el.parentElement) el = el.parentElement;
				const r = el.getBoundingClientRect();
				const host = document.querySelector('sl-customizer');
				const panel = host?.shadowRoot?.querySelector('.svc-panel');
				const panelLeft = panel ? panel.getBoundingClientRect().x : window.innerWidth;
				const margin = 56;
				const x = Math.max(0, r.x - margin);
				const maxRight = Math.min(window.innerWidth, panelLeft);
				return {
					x,
					y: Math.max(0, r.y - margin),
					width: Math.max(20, Math.min(maxRight - x, r.width + margin * 2)),
					height: Math.min(window.innerHeight, r.height + margin * 2),
				};
			},
			{ sel: clipSelector, useParent: !!(clipOverride && clipOverride.useParent) }
		);
		const controlName = id.split('.')[1];
		const fileName = `k1-${controlName}-${optionValue}.png`;
		if (box && box.width > 0 && box.height > 0) {
			await page.screenshot({ path: path.join(__dirname, 'screenshots', fileName), clip: box });
		} else {
			await page.screenshot({ path: path.join(__dirname, 'screenshots', fileName) });
		}
		check(`k1 screenshot ${id} = "${optionValue}": written`, true);
	}

	const K_TILE_IDS = ['content.blockquoteStyle', 'components.cardStyle', 'components.linkButtonStyle', 'components.badgeStyle'];
	for (const id of K_TILE_IDS) {
		const control = controlsById.get(id);
		for (const opt of control.options) {
			if (opt.value === control.default) continue;
			await screenshotKOption(id, opt.value);
		}
	}
	console.log('Screenshots written to tests/e2e/screenshots/k1-*.png');

	await browser.close();

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
