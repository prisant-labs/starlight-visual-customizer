#!/usr/bin/env node
// @ts-check
/**
 * @file Export round-trip test, automated end to end. Proves that an exported `theme.css` +
 * `APPLY-THEME.md`, applied to a real, fresh Starlight site, reproduces what the app's own live
 * preview shows.
 *
 * Builds three theme states with the app's own pure `state.js`/`presets.js`, emits
 * `theme.css`/`APPLY-THEME.md`/`state.json` with `emit-css.js`/`emit-apply.js`, scaffolds (on first
 * run) and applies each export to a fresh, vanilla `@astrojs/starlight` site pinned to this repo's
 * own exact versions (see `fresh-site.mjs`), and compares ~40 computed-style surfaces plus
 * screenshots against the app's own live-preview state, seeded on the app's real outside-studio
 * page via its own code path (`?svc-overlay#svc=<encodeState>` then a plain reload - see
 * `harness.mjs`).
 *
 * IMPORTANT - what "apply the export" means here vs. what a coding agent following
 * `APPLY-THEME.md` literally would do: this script applies each export the same way every run
 * (copy `theme.css`, idempotently ensure one `customCss` line as the LAST entry in
 * `astro.config.mjs`, `npm i` the theme's font packages, `npx astro build`) - a fixed, scripted
 * INTERPRETATION of `APPLY-THEME.md`'s own instructions, not a literal read-and-follow by an agent
 * with no foreknowledge. Re-running this only proves that ONE interpretation still reproduces the
 * live preview; it does not by itself catch a new instruction-clarity gap the way a literal,
 * foreknowledge-free walkthrough would.
 *
 * Usage (PowerShell or bash), from `app/`:
 *   npm run test:roundtrip
 * Env overrides:
 *   SVC_BASE_URL              - the app's own preview origin (default http://localhost:4420 - this
 *                            project's production preview; see README.md for why not :4422/:4700).
 *   FRESH_SITE_DIR         - where the fresh site lives (default an OS-temp path reused across
 *                            runs - see fresh-site.mjs).
 *   SVC_CHROME_PATH        - Chromium executable (default: playwright-core's own pinned build).
 *   SVC_ROUNDTRIP_OUTPUT_DIR - where the JSON report/screenshots go (default `.output/` next to
 *                            this file, gitignored).
 *   SVC_ROUNDTRIP_SCREENSHOTS - set to `0` to skip screenshots entirely (faster).
 *   SVC_ROUNDTRIP_FORCE_INSTALL - set to `1` to force a fresh `npm install` in the fresh site even
 *                            if it looks already set up.
 * Prerequisites: the app's OWN production preview already running at SVC_BASE_URL (`npx astro build`
 * then `npx astro preview --background --port <that port>` from `app/`); network access for the
 * fresh site's `npm install` (only on first run, or after `SVC_ROUNDTRIP_FORCE_INSTALL=1`); nothing
 * else already running on :4431 (this suite starts and stops its own preview server there).
 * Runtime: see README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stateMod, emitCssMod, emitApplyMod, manifestMod, colorMod } from './core-modules.mjs';
import {
	ensureFreshSite,
	resetToControl,
	buildFreshSite,
	applyExportToFreshSite,
	startFreshPreview,
	stopFreshPreview,
	waitForFreshPreview,
	FRESH_SITE_DIR,
} from './fresh-site.mjs';
import {
	launch,
	clearAppState,
	seedAppState,
	gotoPlain,
	readSurfaces,
	diffSurfaceReads,
	checkFontsLoaded,
	BASE_ORIGIN,
	FRESH_ORIGIN,
	VIEWPORT,
} from './harness.mjs';

const { defaultState, applyPreset, setValue, getValue, encodeState } = stateMod;
const { emitCss } = emitCssMod;
const { emitApplyTheme } = emitApplyMod;
const { FONTS } = manifestMod;
const { hexToOklchHueChroma } = colorMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = process.env.SVC_ROUNDTRIP_OUTPUT_DIR || path.join(__dirname, '.output');
const EXPORTS_DIR = path.join(OUTPUT_DIR, 'exports');
const SHOTS_DIR = path.join(OUTPUT_DIR, 'shots');
const TAKE_SCREENSHOTS = process.env.SVC_ROUNDTRIP_SCREENSHOTS !== '0';
fs.mkdirSync(EXPORTS_DIR, { recursive: true });
if (TAKE_SCREENSHOTS) fs.mkdirSync(SHOTS_DIR, { recursive: true });

function round(n, step) {
	return Math.round(n / step) * step;
}

/**
 * Every font-family name (matching what `document.fonts.check` needs, i.e. `emit-css.js`'s own
 * `'<family> Variable'` convention) a state's three `type.font.*` controls pull in. Derived from
 * `manifest.js`'s own `FONTS` list rather than hand-listed, so it can't drift from what the
 * emitter actually chose.
 * @param {import('../../src/customizer/core/state.js').ThemeState} state
 * @returns {string[]}
 */
function fontFamiliesForState(state) {
	const ids = new Set();
	for (const controlId of ['type.font.body', 'type.font.heading', 'type.font.mono']) {
		const value = getValue(state, controlId);
		if (value && value !== 'system') ids.add(value);
	}
	return [...ids].map((id) => {
		const font = FONTS.find((f) => f.id === id);
		return font ? `${font.family} Variable` : id;
	});
}

function buildStates() {
	const editorial = applyPreset(defaultState(), 'editorial-serif');
	const highContrast = applyPreset(defaultState(), 'high-contrast-mono');

	const accentHex = '#0f766e';
	const { hue, chroma } = hexToOklchHueChroma(accentHex);
	let handTuned = defaultState();
	handTuned = setValue(handTuned, 'color.accent.hue', round(hue, 1));
	handTuned = setValue(handTuned, 'color.accent.chroma', round(chroma, 0.005));
	handTuned = setValue(handTuned, 'color.role.link', '#b45309');
	handTuned = setValue(handTuned, 'type.font.body', 'newsreader');
	handTuned = setValue(handTuned, 'sidebar.activeStyle', 'left-bar');
	handTuned = setValue(handTuned, 'header.style', 'no-border');
	handTuned = setValue(handTuned, 'content.asideStyle', 'filled');
	handTuned = { ...handTuned, meta: { ...handTuned.meta, name: 'Hand-tuned Teal' } };

	return {
		'editorial-serif': editorial,
		'high-contrast-mono': highContrast,
		'hand-tuned': handTuned,
	};
}

function writeExports(name, state) {
	const dir = path.join(EXPORTS_DIR, name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'theme.css'), emitCss(state), 'utf8');
	fs.writeFileSync(path.join(dir, 'APPLY-THEME.md'), emitApplyTheme(state), 'utf8');
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
	fs.writeFileSync(path.join(dir, 'encoded.txt'), encodeState(state), 'utf8');
	return dir;
}

async function maybeCompositeSideBySide(prefix, pageKey, mode) {
	if (!TAKE_SCREENSHOTS) return;
	const appPath = path.join(SHOTS_DIR, `${prefix}-app-${pageKey}-${mode}.png`);
	const freshPath = path.join(SHOTS_DIR, `${prefix}-fresh-${pageKey}-${mode}.png`);
	const outPath = path.join(SHOTS_DIR, `sbs-${prefix}-${pageKey}-${mode}.png`);
	try {
		const { default: sharp } = await import('sharp');
		const [appMeta, freshMeta] = await Promise.all([sharp(appPath).metadata(), sharp(freshPath).metadata()]);
		const height = Math.max(appMeta.height ?? 0, freshMeta.height ?? 0);
		const width = (appMeta.width ?? 0) + (freshMeta.width ?? 0);
		await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
			.composite([
				{ input: appPath, left: 0, top: 0 },
				{ input: freshPath, left: appMeta.width ?? 0, top: 0 },
			])
			.png()
			.toFile(outPath);
	} catch (err) {
		console.warn(`(non-fatal) side-by-side composite failed for ${prefix}/${pageKey}/${mode}: ${err.message}`);
	}
}

const PAGES = ['specimen', 'kitchen-sink'];
const MODES = ['light', 'dark'];

async function compareOnBrowser(page, prefix, fontFamilies, seedEncoded) {
	if (seedEncoded) await seedAppState(page, seedEncoded);
	const report = [];
	for (const mode of MODES) {
		for (const pageKey of PAGES) {
			if (!seedEncoded) await clearAppState(page);
			await gotoPlain(page, BASE_ORIGIN, pageKey, mode);
			const appFonts = fontFamilies.length ? await checkFontsLoaded(page, fontFamilies) : {};
			if (TAKE_SCREENSHOTS) await page.screenshot({ path: path.join(SHOTS_DIR, `${prefix}-app-${pageKey}-${mode}.png`) });
			const appStyles = await readSurfaces(page, pageKey);

			await gotoPlain(page, FRESH_ORIGIN, pageKey, mode);
			const freshFonts = fontFamilies.length ? await checkFontsLoaded(page, fontFamilies) : {};
			if (TAKE_SCREENSHOTS) await page.screenshot({ path: path.join(SHOTS_DIR, `${prefix}-fresh-${pageKey}-${mode}.png`) });
			const freshStyles = await readSurfaces(page, pageKey);

			await maybeCompositeSideBySide(prefix, pageKey, mode);

			const mismatches = diffSurfaceReads(appStyles, freshStyles);
			report.push({ pageKey, mode, mismatches, appFonts, freshFonts });
			console.log(
				`[${prefix}] ${pageKey}/${mode}: ${mismatches.length} mismatch(es)${
					mismatches.length ? ' -> ' + mismatches.map((m) => `${m.id}.${m.prop}`).join(', ') : ''
				}`
			);
		}
	}
	return report;
}

async function checkBaseReachable() {
	try {
		const res = await fetch(BASE_ORIGIN);
		if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
	} catch (err) {
		throw new Error(
			`Could not reach ${BASE_ORIGIN} (the app's own preview). Build and start it first: ` +
				`\`npx astro build\` then \`npx astro preview --background --port <port>\` from app/, ` +
				`and pass that port as SVC_BASE_URL if it isn't 4420. Original error: ${err.message}`
		);
	}
}

async function main() {
	await checkBaseReachable();

	console.log(`--- Ensuring fresh site at ${FRESH_SITE_DIR} ---`);
	const { scaffolded, installed } = ensureFreshSite();
	console.log(`(scaffolded: ${scaffolded}, ran npm install: ${installed})`);

	console.log('--- Building unthemed control ---');
	resetToControl();
	buildFreshSite();

	console.log('--- Starting fresh site preview on :4431 ---');
	startFreshPreview();
	await waitForFreshPreview();

	/** @type {Record<string, any>} */
	const allResults = {};
	// Declared outside the try so `finally` can close it: an open browser keeps this process alive
	// after a failure, which once made a timeout look like a 30-minute hang.
	let browser = null;
	try {
		browser = await launch();
		const context = await browser.newContext({ viewport: VIEWPORT });
		const page = await context.newPage();

		console.log('\n--- Control: unthemed fresh site vs app stock ---');
		allResults.control = await compareOnBrowser(page, 'control', [], null);

		const states = buildStates();
		for (const [name, state] of Object.entries(states)) {
			console.log(`\n--- Theme: ${name} ---`);
			const dir = writeExports(name, state);
			applyExportToFreshSite(dir, state, getValue, FONTS);
			allResults[name] = await compareOnBrowser(page, name, fontFamiliesForState(state), encodeState(state));
		}

	} finally {
		await browser?.close().catch(() => {});
		console.log('\n--- Stopping fresh site preview ---');
		stopFreshPreview();
	}

	const resultsPath = path.join(OUTPUT_DIR, 'roundtrip-results.json');
	fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2), 'utf8');

	let total = 0;
	for (const [name, rows] of Object.entries(allResults)) {
		const n = rows.reduce((sum, r) => sum + r.mismatches.length, 0);
		console.log(`${name}: ${n} mismatch(es) across ${rows.length} page/mode combos`);
		total += n;
	}
	console.log(`\nResults written to ${resultsPath}`);
	if (TAKE_SCREENSHOTS) console.log(`Screenshots written to ${SHOTS_DIR}`);
	console.log(`\nTOTAL MISMATCHES: ${total}`);

	process.exitCode = total > 0 ? 1 : 0;
}

main().catch((err) => {
	console.error(err);
	try {
		stopFreshPreview();
	} catch {}
	process.exitCode = 1;
});
