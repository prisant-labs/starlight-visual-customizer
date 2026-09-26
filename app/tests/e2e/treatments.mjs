// @ts-check
/**
 * @file Per-option verification: "each treatment option changes the computed style of its
 * target" (SPEC.md Definition of done, item 3). Drives the real built + previewed site with
 * playwright-core against the machine's already-installed chromium-1228 (same approach as
 * tests/e2e/smoke.mjs - no browser download).
 *
 * For every non-default option of every select-treatment in treatments.js, plus layout.radius,
 * code.frameRadius, and the four build-time preview approximations: loads the probe page at
 * defaultState(), reads the probe's computed style, sets state via `svc-state` in localStorage
 * (built with the real core modules, not hand-encoded), reloads, re-reads the same computed
 * style, and PASSes iff the value changed. Background/border/text-color probes are additionally
 * re-checked in both `data-theme` modes, since an unlayered override could accidentally lose to
 * a theme-specific Starlight rule in only one mode.
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run build`) or `npm run dev:bg`.
 *   node tests/e2e/treatments.mjs
 * Env overrides: BASE_URL (default http://localhost:4420 = this project's production preview; use http://localhost:4700 for its dev server),
 * falling back to SVC_BASE_URL; SVC_CHROME_PATH.
 *
 * SPEC.md Round 2's six alignment controls are select-treatments like any other and so are picked
 * up automatically by the loop below (no per-control code needed) - except three things a generic
 * loop can't infer: (1) `content.heroAlign` only has a target on the home page, not kitchen-sink;
 * (2) several alignment controls are deliberately gated behind Starlight's own 50rem/72rem
 * breakpoints and only produce a visible diff at a desktop viewport; (3) `content.heroAlign:
 * start` is deliberately the one option NOT breakpoint-gated (see treatments.js), so its diff only
 * shows *below* 50rem. `TASK_OVERRIDES`/`HERO_TASK_OVERRIDES` supply exactly those three things;
 * `mobileGuard: true` additionally re-runs the same probe at 390px and asserts the property is
 * UNCHANGED there, the testable form of "wrap in the matching media query so mobile is unaffected".
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultState, setValue, encodeState } from '../../src/customizer/core/state.js';
import { treatments } from '../../src/customizer/core/treatments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const BASE_URL = process.env.BASE_URL || process.env.SVC_BASE_URL || 'http://localhost:4420';
const EXECUTABLE_PATH =
	process.env.SVC_CHROME_PATH ||
	chromium.executablePath();

// F1 (SPEC-C phase 3): a direct top-level visit no longer mounts any panel at all (a small "Open in
// Studio" pill instead) - `?svc-overlay` is the escape hatch this suite (an engine test of the
// panel's own CSS application, not F1's visitor-mode page) needs to keep exercising it.
const KITCHEN_SINK = `${BASE_URL}/guides/kitchen-sink/?svc-overlay`;
// F1 (SPEC-C phase 3): the plain URL, no overlay flag - used only for SCREENSHOTS after a state has
// already been applied and persisted through the flagged page above. panel.js mirrors the live CSS
// into localStorage['svc-css'] on every apply (persistPreviewCss) and the no-flash preload path
// replays it here with zero JS - so this shows the exact same styling with no panel UI in the frame,
// unlike the flagged page (whose docked/overlay chrome would otherwise cover the very TOC rail these
// screenshots exist to show).
const KITCHEN_SINK_PLAIN = `${BASE_URL}/guides/kitchen-sink/`;
// `?view` (studio design doc, item E): astro.config.mjs's `/` -> `/studio/` redirect only fires
// top-level with no `?view` in the URL - without it, this direct `page.goto('/')` would land on
// `/studio/` instead of the splash page these hero-target checks need. `&svc-overlay` (F1, above).
const HOME = `${BASE_URL}/?view&svc-overlay`;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Properties whose computed value is itself a color: re-verified in both themes. */
const COLOR_PROPS = new Set(['background-color', 'border-color', 'color']);

/**
 * Workstream K (SPEC-C section 4): "every selector verified ... in dark and light" applies
 * regardless of whether the probed property happens to be a color - these four selects' probed
 * properties (border-radius, background-color, font-style) aren't all in COLOR_PROPS, so they're
 * forced dual-theme explicitly rather than relying on the property-based heuristic above.
 */
const FORCE_DUAL_THEME_IDS = new Set([
	'content.blockquoteStyle',
	'components.cardStyle',
	'components.linkButtonStyle',
	'components.badgeStyle',
]);

/**
 * Per-id overrides for the alignment controls added in SPEC.md Round 2: a wide-enough viewport to
 * actually cross the header-grid (50rem)/TOC-and-content (72rem) breakpoints those options are
 * gated behind, plus a mobile-guard re-check proving mobile is untouched.
 */
const TASK_OVERRIDES = {
	'header.searchAlign': { viewport: DESKTOP_VIEWPORT, mobileGuard: true },
	'toc.position': { viewport: DESKTOP_VIEWPORT, mobileGuard: true },
	'layout.contentAlign': { viewport: DESKTOP_VIEWPORT, mobileGuard: true },
	'content.titleAlign': { viewport: DESKTOP_VIEWPORT },
	'footer.paginationAlign': { viewport: DESKTOP_VIEWPORT },
};

/**
 * `content.heroAlign` needs its own table: the target only exists on the home page, and its two
 * options need opposite viewports precisely because they're gated on opposite sides of Hero's
 * 50rem breakpoint (see treatments.js's file-level comment on this treatment for why).
 */
const HERO_TASK_OVERRIDES = {
	center: { url: HOME, viewport: DESKTOP_VIEWPORT, mobileGuard: true },
	start: { url: HOME, viewport: MOBILE_VIEWPORT },
};

/** @type {{id:string, option:any, selector:string, property:string, url:string, viewport:{width:number,height:number}, mobileGuard:boolean, dualTheme:boolean, note?:string}[]} */
const tasks = [];

for (const [id, options] of Object.entries(treatments)) {
	for (const [optionValue, entry] of Object.entries(options)) {
		const override = id === 'content.heroAlign' ? HERO_TASK_OVERRIDES[optionValue] : TASK_OVERRIDES[id];
		tasks.push({
			id,
			option: optionValue,
			selector: entry.probe.selector,
			property: entry.probe.property,
			url: (override && override.url) || KITCHEN_SINK,
			viewport: (override && override.viewport) || DEFAULT_VIEWPORT,
			mobileGuard: !!(override && override.mobileGuard),
			dualTheme: COLOR_PROPS.has(entry.probe.property) || FORCE_DUAL_THEME_IDS.has(id),
		});
	}
}

// layout.radius: at least one Tier-2 radius hook.
tasks.push({
	id: 'layout.radius',
	option: 0,
	selector: ".sidebar-content a[aria-current='page']",
	property: 'border-radius',
	url: KITCHEN_SINK,
	dualTheme: false,
});

// code.frameRadius: best-effort Expressive Code frame radius via --ec-brdRad.
tasks.push({
	id: 'code.frameRadius',
	option: 12,
	selector: '.expressive-code .frame',
	property: 'border-radius',
	url: KITCHEN_SINK,
	dualTheme: false,
	bestEffort: true,
});

// ---------------------------------------------------------------------------------------------
// Workstream K (SPEC-C section 4): the new range/toggle controls, each a literal selector
// override rather than a select-treatment, so they have no `treatments.js` entry to generate a
// task from automatically - same shape as layout.radius/code.frameRadius above. All forced
// dual-theme per the acceptance bullet ("proven by a browser probe in both dark and light"),
// regardless of whether the probed property happens to be color-based.
// `sidebar.hoverTint` is handled separately below (needs a real :hover, not just a computed-style
// read) rather than through this generic task list.
// ---------------------------------------------------------------------------------------------
const K_TASKS = [
	{ id: 'layout.contentPadX', option: 2, selector: '.content-panel', property: 'padding-left' },
	{ id: 'header.searchWidth', option: 18, selector: 'button[data-open-modal]', property: 'max-width' },
	{ id: 'header.searchShortcut', option: false, selector: 'button[data-open-modal] > kbd', property: 'display' },
	// 1.75rem, not 1.5rem: at the DEFAULT_VIEWPORT (1280px, >=50em) the site title is ALREADY at
	// --sl-text-h4 = --sl-text-2xl = 1.5rem, so 1.5 would collide with the very default this task
	// diffs against.
	{ id: 'header.titleSize', option: 1.75, selector: '.site-title', property: 'font-size' },
	{ id: 'sidebar.itemPaddingY', option: 0.5, selector: '.sidebar-content a', property: 'padding-top' },
	{ id: 'sidebar.nestIndent', option: 1.5, selector: '.sidebar-content ul ul li', property: 'margin-left' },
	{ id: 'sidebar.nestGuides', option: false, selector: '.sidebar-content ul ul li', property: 'border-left-width' },
	{ id: 'toc.textSize', option: 1, selector: 'starlight-toc a', property: 'font-size' },
	// A depth-2+ link, not the bare `starlight-toc a` (which resolves to the FIRST, depth-0 link -
	// `calc(indent * var(--depth,0) + 0.5rem)` is 0.5rem regardless of `indent` when depth is 0, so
	// that selector could never show a diff for this control no matter what value it's set to).
	{ id: 'toc.indent', option: 1.5, selector: 'starlight-toc li li a', property: 'padding-left' },
	// F4 fix (SPEC-C phase 3, point 11): the guide moved from a border on the leaf `<a>` to an
	// absolutely positioned `::after` on each nested `<ul>` (emit-css.js) - `position` on that `<ul>`
	// (static -> relative, needed to anchor the pseudo-element) is the one plain, non-pseudo-element
	// computed style this generic runner can still see; `runTocDepthGuidesTask` below probes the
	// pseudo-element itself for the actual visibility/geometry claims this control makes.
	{ id: 'toc.depthGuides', option: true, selector: 'starlight-toc li > ul', property: 'position' },
	{ id: 'content.asidePadding', option: 1.5, selector: '.starlight-aside', property: 'padding-top' },
	{
		id: 'content.headingDivider',
		option: true,
		selector: '.sl-markdown-content h2:not(:where(.not-content *))',
		property: 'border-bottom-width',
	},
	{
		id: 'content.tableCellPadding',
		option: 1,
		selector: '.sl-markdown-content td:not(:where(.not-content *))',
		property: 'padding-top',
	},
	{ id: 'code.fontSize', option: 1, selector: '.expressive-code pre code', property: 'font-size' },
	{ id: 'footer.paginationShadow', option: false, selector: '.pagination-links a', property: 'box-shadow' },
];
for (const t of K_TASKS) {
	tasks.push({ ...t, url: KITCHEN_SINK, dualTheme: true });
}

// Build-time preview approximations (value-based, not diff-based - see emit-css.js).
const buildTimeTasks = [
	{
		id: 'page.toc.maxLevel',
		option: 2,
		selector: "starlight-toc a[href='#long-form-paragraphs']",
		property: 'display',
		url: KITCHEN_SINK,
		expect: 'none',
	},
	{
		id: 'page.pagination',
		option: false,
		selector: '.pagination-links',
		property: 'display',
		url: KITCHEN_SINK,
		expect: 'none',
	},
	{
		id: 'page.headingLinks',
		option: false,
		selector: '.sl-anchor-link',
		property: 'display',
		url: KITCHEN_SINK,
		expect: 'none',
	},
	{
		id: 'page.credits',
		option: true,
		selector: 'footer .kudos',
		property: 'display',
		url: KITCHEN_SINK,
		expectNot: 'none',
	},
	// code.wrap (workstream K, build tier): approximated live via forPreview CSS (emit-css.js),
	// same mechanism as the four tasks above.
	{
		id: 'code.wrap',
		option: true,
		selector: '.expressive-code .ec-line .code',
		property: 'white-space',
		url: KITCHEN_SINK,
		expect: 'pre-wrap',
	},
];

/** @type {{id:string, option:any, status:string, note:string}[]} */
const results = [];
let failures = 0;

/** @param {string} id @param {any} option @param {string} status @param {string} [note] */
function record(id, option, status, note = '') {
	results.push({ id, option, status, note });
	if (status.startsWith('FAIL')) failures++;
	console.log(`${status.padEnd(16)} ${id} = ${JSON.stringify(option)}${note ? '  (' + note + ')' : ''}`);
}

/**
 * @param {import('playwright-core').Page} page
 * @param {string} url
 * @param {import('../../src/customizer/core/state.js').ThemeState | null} state null = clear (defaultState)
 * @param {'dark'|'light'} theme
 * @param {{width:number,height:number}} [viewport] Set before navigating - several alignment
 *   controls are gated behind Starlight's own 50rem/72rem breakpoints and only show a diff at a
 *   wide-enough viewport (see TASK_OVERRIDES above).
 */
async function loadWithState(page, url, state, theme, viewport = DEFAULT_VIEWPORT) {
	await page.setViewportSize(viewport);
	await page.goto(url, { waitUntil: 'networkidle' });
	const encoded = state ? encodeState(state) : null;
	await page.evaluate(
		({ encoded, theme }) => {
			if (encoded) localStorage.setItem('svc-state', encoded);
			else localStorage.removeItem('svc-state');
			localStorage.setItem('starlight-theme', theme);
			if (location.hash) history.replaceState(null, '', location.pathname + location.search);
		},
		{ encoded, theme }
	);
	await page.reload({ waitUntil: 'networkidle' });
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

/** @param {import('playwright-core').Page} page @param {{id:string, option:any, selector:string, property:string, url:string, viewport?:{width:number,height:number}}} task @param {'dark'|'light'} theme */
async function runTreatmentTask(page, task, theme) {
	const suffix = theme === 'light' ? ' [light]' : '';
	const viewport = task.viewport || DEFAULT_VIEWPORT;
	await loadWithState(page, task.url, defaultState(), theme, viewport);
	const before = await readComputed(page, task.selector, task.property);
	if (before === undefined) {
		record(task.id, task.option, 'FAIL-NOPROBE', `selector not found: ${task.selector}${suffix}`);
		return;
	}
	const changedState = setValue(defaultState(), task.id, task.option);
	await loadWithState(page, task.url, changedState, theme, viewport);
	const after = await readComputed(page, task.selector, task.property);
	if (after === undefined) {
		record(task.id, task.option, 'FAIL-NOPROBE', `selector gone after change: ${task.selector}${suffix}`);
		return;
	}
	if (before !== after) {
		record(task.id, task.option, 'PASS', `${task.property}: ${before} -> ${after}${suffix}`);
	} else {
		record(
			task.id,
			task.option,
			task.bestEffort ? 'FAIL(best-effort)' : 'FAIL',
			`${task.property} unchanged (${before})${suffix}`
		);
	}
}

/**
 * The testable form of "wrap in the matching media query so mobile is unaffected" (SPEC.md Round
 * 2): re-runs the same probe at a 390px viewport and asserts the property is UNCHANGED from
 * default there - i.e. the option's media query genuinely doesn't fire below its breakpoint.
 * @param {import('playwright-core').Page} page @param {{id:string, option:any, selector:string, property:string, url:string}} task
 */
async function runMobileGuard(page, task) {
	await loadWithState(page, task.url, defaultState(), 'dark', MOBILE_VIEWPORT);
	const before = await readComputed(page, task.selector, task.property);
	const changedState = setValue(defaultState(), task.id, task.option);
	await loadWithState(page, task.url, changedState, 'dark', MOBILE_VIEWPORT);
	const after = await readComputed(page, task.selector, task.property);
	if (before === after) {
		record(`${task.id} [mobile-guard]`, task.option, 'PASS', `${task.property} unchanged at 390px (${before})`);
	} else {
		record(`${task.id} [mobile-guard]`, task.option, 'FAIL', `${task.property} at 390px: default=${before} -> option=${after} (should be unchanged)`);
	}
}

/** @param {import('playwright-core').Page} page @param {any} task */
async function runBuildTimeTask(page, task) {
	await loadWithState(page, task.url, defaultState(), 'dark');
	const before = await readComputed(page, task.selector, task.property);
	const changedState = setValue(defaultState(), task.id, task.option);
	await loadWithState(page, task.url, changedState, 'dark');
	const after = await readComputed(page, task.selector, task.property);
	if (after === undefined) {
		record(task.id, task.option, 'FAIL-NOPROBE', `selector not found: ${task.selector}`);
		return;
	}
	const ok = task.expect !== undefined ? after === task.expect : after !== task.expectNot;
	record(task.id, task.option, ok ? 'PASS' : 'FAIL', `${task.property} before=${before} after=${after}`);
}

/**
 * `sidebar.hoverTint` (workstream K) only takes effect on `:hover`, which `readComputed` alone
 * can never observe - `page.hover()` moves a real synthetic pointer over the element first.
 * @param {import('playwright-core').Page} page @param {'dark'|'light'} theme
 */
async function runSidebarHoverTintTask(page, theme) {
	const selector = ".sidebar-content a:not([aria-current='page'])";
	await loadWithState(page, KITCHEN_SINK, defaultState(), theme);
	await page.hover(selector);
	const before = await readComputed(page, selector, 'background-color');
	const changedState = setValue(defaultState(), 'sidebar.hoverTint', true);
	await loadWithState(page, KITCHEN_SINK, changedState, theme);
	await page.hover(selector);
	const after = await readComputed(page, selector, 'background-color');
	const suffix = theme === 'light' ? ' [light]' : '';
	if (before !== undefined && after !== undefined && before !== after) {
		record('sidebar.hoverTint', true, 'PASS', `background-color: ${before} -> ${after}${suffix}`);
	} else {
		record('sidebar.hoverTint', true, 'FAIL', `background-color unchanged on hover (${before})${suffix}`);
	}
}

/**
 * F4 fix (SPEC-C phase 3, point 11): the guide is an absolutely positioned `::after` on each nested
 * `<ul>` (emit-css.js), not a plain computed style on a real element - `readComputed` can't see a
 * pseudo-element, so this probes `getComputedStyle(el, '::after')` directly. Verifies both bugs the
 * maintainer's screenshot showed are actually fixed: the line is now VISIBLE (a real, non-transparent
 * background-color) and each depth's line sits at ITS OWN inset (not the old flattened single value),
 * with and without `toc.indent` customized, in both themes - Long doc (kitchen-sink) has real h3/h4
 * headings to test against.
 * @param {import('playwright-core').Page} page @param {'dark'|'light'} theme @param {number|null} indentValue null = default (1rem step)
 */
async function runTocDepthGuidesTask(page, theme, indentValue) {
	const suffix = `${theme}${indentValue == null ? '' : `, indent=${indentValue}`}`;
	let state = setValue(defaultState(), 'toc.depthGuides', true);
	if (indentValue != null) state = setValue(state, 'toc.indent', indentValue);
	await loadWithState(page, KITCHEN_SINK, state, theme, DEFAULT_VIEWPORT);
	const info = await page.evaluate(() => {
		const lists = Array.from(document.querySelectorAll('starlight-toc li > ul'));
		return lists.map((ul) => {
			const cs = getComputedStyle(ul, '::after');
			return { depth: Number(getComputedStyle(ul).getPropertyValue('--depth')) || 0, left: parseFloat(cs.left), bg: cs.backgroundColor, width: parseFloat(cs.width) };
		});
	});
	const byDepth = new Map();
	for (const row of info) if (!byDepth.has(row.depth)) byDepth.set(row.depth, row);
	const depth1 = byDepth.get(1);
	const depth2 = byDepth.get(2);
	record(
		'toc.depthGuides',
		`visible line ${suffix}`,
		depth1 && depth1.width > 0 && depth1.bg !== 'rgba(0, 0, 0, 0)' && depth1.bg !== 'transparent' ? 'PASS' : 'FAIL',
		JSON.stringify(depth1)
	);
	record(
		'toc.depthGuides',
		`depth 1 and 2 sit at different insets (not flattened) ${suffix}`,
		!!depth1 && !!depth2 && depth1.left !== depth2.left && depth2.left > depth1.left ? 'PASS' : 'FAIL',
		JSON.stringify({ depth1, depth2 })
	);
	const step = (indentValue == null ? 1 : indentValue) * 16;
	const expected1 = step * 1 + 0.15 * 16;
	const expected2 = step * 2 + 0.15 * 16;
	const formulaOk = !!depth1 && !!depth2 && Math.abs(depth1.left - expected1) < 1 && Math.abs(depth2.left - expected2) < 1;
	record(
		'toc.depthGuides',
		`insets match the indent-step formula ${suffix}`,
		formulaOk ? 'PASS' : 'FAIL',
		`depth1=${depth1?.left} (expected ${expected1}), depth2=${depth2?.left} (expected ${expected2})`
	);
}

/**
 * F5 fix (SPEC-C phase 3, point 12): the generic per-option loop below already diffs
 * `.right-sidebar-container`'s `order` property for `window-right` (it doesn't touch `order` at all,
 * so that diff is somewhat vacuous for this option) - this checks the actual geometry claim
 * ("the TOC's right edge sits at the window's right edge minus its padding") directly, at both 1440
 * and 1920, the two widths F5's acceptance bullet names explicitly.
 * @param {import('playwright-core').Page} page @param {number} width
 */
async function runTocWindowRightGeometryTask(page, width) {
	const state = setValue(defaultState(), 'toc.position', 'window-right');
	await loadWithState(page, KITCHEN_SINK, state, 'light', { width, height: 900 });
	const geo = await page.evaluate(() => {
		const rs = document.querySelector('.right-sidebar');
		const r = rs.getBoundingClientRect();
		return { innerWidth: window.innerWidth, right: r.right, left: r.left, width: r.width };
	});
	record(
		'toc.position',
		`window-right: right edge at the window edge @ ${width}px`,
		Math.abs(geo.right - geo.innerWidth) <= 1 ? 'PASS' : 'FAIL',
		JSON.stringify(geo)
	);
}

async function main() {
	mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
	const page = await browser.newPage();
	page.on('pageerror', (err) => console.log('[browser page error]', err.message));

	await runSidebarHoverTintTask(page, 'dark');
	await runSidebarHoverTintTask(page, 'light');

	for (const task of tasks) {
		await runTreatmentTask(page, task, 'dark');
		if (task.dualTheme) {
			await runTreatmentTask(page, task, 'light');
		}
		if (task.mobileGuard) {
			await runMobileGuard(page, task);
		}
	}

	console.log('\n-- build-time preview approximations --');
	for (const task of buildTimeTasks) {
		await runBuildTimeTask(page, task);
	}

	console.log('\n-- F4: toc.depthGuides (geometry + visibility) --');
	await runTocDepthGuidesTask(page, 'light', null);
	await runTocDepthGuidesTask(page, 'dark', null);
	await runTocDepthGuidesTask(page, 'light', 1.5);
	// Screenshots for the acceptance list - light and dark, guides on, default indent, Long doc (h3+h4).
	// Loaded PLAIN (no ?svc-overlay) after the state is applied+persisted, so the overlay panel isn't
	// sitting on top of the very TOC rail the screenshot needs to show (see KITCHEN_SINK_PLAIN above).
	for (const theme of ['light', 'dark']) {
		await loadWithState(page, KITCHEN_SINK, setValue(defaultState(), 'toc.depthGuides', true), theme, DEFAULT_VIEWPORT);
		await page.goto(KITCHEN_SINK_PLAIN, { waitUntil: 'networkidle' });
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `c3-toc-depth-guides-${theme}.png`) });
	}

	console.log('\n-- F5: toc.position = window-right (geometry) --');
	await runTocWindowRightGeometryTask(page, 1440);
	await runTocWindowRightGeometryTask(page, 1920);
	await page.goto(KITCHEN_SINK_PLAIN, { waitUntil: 'networkidle' });
	await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-toc-window-right.png') });

	await browser.close();

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} total)`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
