// @ts-check
/**
 * @file Shared Playwright helpers for the export round-trip comparison. Uses this repo's own
 * installed `playwright-core` and its pinned Chromium build, matching the convention in
 * `tests/e2e/*.mjs` (a plain `import` resolves against `app/node_modules` since this file lives
 * inside `app/`).
 */
import { chromium } from 'playwright-core';
import { surfaces, appliesTo } from './surfaces.mjs';

export const EXECUTABLE_PATH = process.env.SVC_CHROME_PATH || chromium.executablePath();

export const BASE_ORIGIN = process.env.BASE_URL || 'http://localhost:4420';
export const FRESH_ORIGIN = 'http://localhost:4431';
export const VIEWPORT = { width: 1440, height: 1000 };

const PAGE_PATHS = { specimen: '/specimen/', 'kitchen-sink': '/guides/kitchen-sink/' };

/** @returns {Promise<import('playwright-core').Browser>} */
export async function launch() {
	return chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
}

/**
 * Seeds the app's live-preview localStorage exactly the way a real user reaches that state: load
 * the overlay-flagged page with the state encoded in the `#svc=` hash (`panel.js`'s
 * `loadInitialState`: hash wins over localStorage), let `initCustomizer` run to completion (it
 * persists `svc-state` AND `svc-css` via `persistPreviewCss()` at the end of init), then poll until
 * `svc-state` matches. This uses the app's own real code path end to end (including the private
 * CDN `fontFaceCss` baked into `svc-css`) instead of reimplementing it.
 * @param {import('playwright-core').Page} page
 * @param {string} encodedState
 */
export async function seedAppState(page, encodedState) {
	await page.goto(`${BASE_ORIGIN}/specimen/?svc-overlay#svc=${encodedState}`, { waitUntil: 'load' });
	await page.waitForFunction((expected) => localStorage.getItem('svc-state') === expected, encodedState, { timeout: 15000 });
	await page.waitForFunction(() => {
		const css = localStorage.getItem('svc-css');
		return !!css && css.length > 0;
	}, null, { timeout: 15000 });
}

/** Clears the app's customizer localStorage keys so a fresh context truly shows stock Starlight. */
export async function clearAppState(page) {
	await page.goto(`${BASE_ORIGIN}/specimen/`, { waitUntil: 'load' });
	await page.evaluate(() => {
		try {
			localStorage.removeItem('svc-state');
			localStorage.removeItem('svc-css');
		} catch {}
	});
}

/**
 * Navigates to a plain (non-`?svc-overlay`) page on either origin, in the given light/dark mode,
 * waits for web fonts to settle, and hides the "Open in Studio" pill (app origin only) before any
 * read.
 * @param {import('playwright-core').Page} page
 * @param {string} origin
 * @param {'specimen'|'kitchen-sink'} pageKey
 * @param {'light'|'dark'} mode
 */
export async function gotoPlain(page, origin, pageKey, mode) {
	const url = `${origin}${PAGE_PATHS[pageKey]}`;
	// `page.evaluate` runs against whatever document is CURRENTLY loaded, not the target origin - so
	// this must navigate there first, set localStorage in that origin's context, then reload so
	// Starlight's own ThemeProvider (and, on the app, the no-flash preload) both read the correct
	// value at the very start of a fresh load, before first paint.
	await page.goto(url, { waitUntil: 'load' });
	await page.evaluate((m) => {
		try {
			localStorage.setItem('starlight-theme', m);
		} catch {}
	}, mode);
	await page.reload({ waitUntil: 'load' });
	await page.evaluate(() => document.fonts.ready);
	// Exclude the F1 "Open in Studio" pill from every comparison/screenshot (app origin only; the
	// fresh site never has it, so this is a harmless no-op there).
	await page.addStyleTag({ content: '#svc-open-in-studio-pill{display:none!important}' });
}

/**
 * @param {import('playwright-core').Page} page
 * @param {'specimen'|'kitchen-sink'} pageKey
 * @returns {Promise<Record<string, {matched:boolean, values:Record<string,string>}>>}
 */
export async function readSurfaces(page, pageKey) {
	const applicable = surfaces.filter((s) => appliesTo(s, pageKey));
	return page.evaluate((list) => {
		const out = {};
		for (const s of list) {
			const el = document.querySelector(s.selector);
			if (!el) {
				out[s.id] = { matched: false, values: {} };
				continue;
			}
			const cs = getComputedStyle(el);
			const values = {};
			for (const prop of s.props) values[prop] = cs.getPropertyValue(prop).trim();
			out[s.id] = { matched: true, values };
		}
		return out;
	}, applicable);
}

/** @returns {Promise<Record<string,boolean>>} font-family name -> whether `document.fonts.check` reports it loaded. */
export async function checkFontsLoaded(page, fontFamilyNames) {
	return page.evaluate((names) => {
		const result = {};
		for (const name of names) {
			result[name] = document.fonts.check(`16px '${name}'`);
		}
		return result;
	}, fontFamilyNames);
}

function parsePx(value) {
	const m = value.match(/^(-?\d+\.?\d*)px$/);
	return m ? parseFloat(m[1]) : null;
}

/**
 * Compares two computed-style value strings with the tolerances stated in `README.md`: colors as
 * rgb channel deltas <=2, px lengths <=0.5px, everything else exact after whitespace/quote
 * normalization.
 */
export function valuesMatch(a, b) {
	if (a === b) return true;
	if (a == null || b == null) return false;
	const na = a.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
	const nb = b.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
	if (na === nb) return true;
	const rgbRe = /rgba?\(([^)]+)\)/;
	const ma = na.match(rgbRe);
	const mb = nb.match(rgbRe);
	if (ma && mb) {
		const ca = ma[1].split(',').map((x) => parseFloat(x));
		const cb = mb[1].split(',').map((x) => parseFloat(x));
		if (ca.length === cb.length && ca.every((v, i) => Math.abs(v - cb[i]) <= 2)) return true;
		return false;
	}
	const pxa = parsePx(na);
	const pxb = parsePx(nb);
	if (pxa != null && pxb != null) return Math.abs(pxa - pxb) <= 0.5;
	return false;
}

/**
 * @param {Record<string, {matched:boolean, values:Record<string,string>}>} a
 * @param {Record<string, {matched:boolean, values:Record<string,string>}>} b
 * @returns {{id:string, prop:string, a:string, b:string}[]} plus surface-not-found entries.
 */
export function diffSurfaceReads(a, b) {
	const mismatches = [];
	for (const id of Object.keys(a)) {
		const ra = a[id];
		const rb = b[id] || { matched: false, values: {} };
		if (ra.matched !== rb.matched) {
			mismatches.push({ id, prop: '(element present)', a: String(ra.matched), b: String(rb.matched) });
			continue;
		}
		if (!ra.matched) continue;
		for (const prop of Object.keys(ra.values)) {
			const va = ra.values[prop];
			const vb = rb.values[prop];
			if (!valuesMatch(va, vb)) mismatches.push({ id, prop, a: va, b: vb });
		}
	}
	return mismatches;
}
