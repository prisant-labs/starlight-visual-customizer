// @ts-check
/**
 * @file W9a acceptance suite: the Export dialog's "Screenshot (PNG)" capture
 * (`src/customizer/ui/export.js`'s `capturePageScreenshot`), specifically "Visible area" on a
 * SCROLLED Document page (kitchen-sink) - the case that was blank in the left sidebar and right
 * "On this page" TOC before this fix (see `export.js`'s doc comment on `capturePageScreenshot` for
 * the root-cause writeup). Complements `editors.mjs`'s own coarser screenshot check, which exercises
 * "Style guide" (`/specimen/`) - a page with a fixed header but NO Starlight sidebar/right-TOC, so it
 * never could have caught this bug; this suite targets kitchen-sink specifically because it has both.
 *
 * Needs a running server; start one first: `npm run build` then
 * `npm run preview:bg` (or `npx astro preview --background --port 4420`).
 *   node tests/e2e/screenshot.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420), SVC_CHROME_PATH.
 *
 * Real mouse/keyboard throughout (device select, preset card, theme toggle, Export, the capture
 * buttons, closing the dialog) - see `realClick` below. The frame's own `window.scrollTo` is the only
 * scroll call anywhere in this file, per the studio's rule that no host ancestor of a preview frame
 * ever scrolls.
 *
 * Verification method (per the coordinator's brief - decode both PNGs in the browser, no new npm
 * dependencies): both the captured PNG and a genuine Playwright screenshot of the SAME on-screen
 * `<iframe>` element (the ground truth for "what the frame shows") are base64-encoded and handed to
 * `page.evaluate`, decoded via `<img>` + `<canvas>.getImageData`, and diffed pixel-by-pixel there -
 * see `compareImages`. All PNGs plus a red/grey diff visualization for every scenario are saved to
 * `BATCH_DIR` for the coordinator.
 *
 * Round 2 addition: a dedicated ALIGNMENT check (`alignmentProbesFor`/`checkAlignment`) catches a
 * systematic render offset directly, by comparing the pixel position of a distinctive edge (the
 * header's bottom border row, the left sidebar's right border column) between `ours` and the
 * reference, 1px tolerance - this is what should have caught (and now does catch) the ~8px
 * top/left margin offset that round 1's region-diff-fraction thresholds were loose enough to miss.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
const EXECUTABLE_PATH = process.env.SVC_CHROME_PATH || chromium.executablePath();
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
/** Where the coordinator can find every PNG this suite produces, plus diff visualizations. */
const BATCH_DIR =
	process.env.SVC_SCREENSHOT_BATCH_DIR ||
	path.join(__dirname, 'screenshots', 'screenshot-suite');

// ---- Thresholds - all in one place, with the reasoning for each. ---------------------------------
// The captured PNG is a from-scratch DOM-to-SVG-foreignObject render (`modern-screenshot`); the
// reference is a genuine compositor screenshot of the SAME live frame. Even a byte-perfect capture
// differs from the reference at the pixel level because the two use different text/font rasterizers -
// most visibly at glyph edges and hairline borders. These thresholds are sized to comfortably pass
// that expected antialiasing noise while still failing hard on a real defect (wrong content, a blank
// region, a select showing the wrong option, or a systematic render offset - see ALIGNMENT_TOLERANCE_PX
// below for that last one specifically).
//
// Round 2 recalibration: these were originally set from a run that (unknowingly) had the ~8px margin
// offset this round fixes baked into every capture, which inflated every diff number well above what
// a genuinely correct capture produces - loose enough that the offset itself passed every threshold.
// Retuned against a real post-fix run on kitchen-sink/Editorial Serif/Desktop 1440 (measured numbers
// logged per scenario below; see the PR report for the full table). Before/after, for context: the
// offset bug measured ~6.95-8.44% overall diff and ~7.43-11.22% region diff; fixed, the SAME scenarios
// measure ~1.4-2.4% and ~0.03-2.61% respectively - roughly a 3-5x drop, which is what actually fixing a
// structural bug (rather than just tolerating it) should look like.
/** Per-channel (R/G/B) absolute difference above which a pixel counts as "different" for the
 * fraction-based checks below. Text/icon edges alone can differ by 40-90 in a single channel between
 * the two rasterizers; 40 keeps that noise out while still catching a genuinely wrong pixel (which
 * differs by hundreds, not tens, e.g. sidebar background vs. blank white). Unchanged in round 2 - this
 * is a per-pixel noise filter, not where the offset bug hid (that's why ALIGNMENT_TOLERANCE_PX exists
 * as a separate, geometric check rather than a tighter version of this one). */
const PIXEL_CHANNEL_TOLERANCE = 40;
/** Fraction of pixels (beyond the tolerance above) allowed over an ENTIRE viewport-sized capture.
 * Measured post-fix: 1.41-2.40% across all four scenarios (mid-scroll light/dark, scroll0, Full page's
 * top slice). 5% is a little over 2x that ceiling - enough headroom that ordinary rasterizer/font
 * variance across machines won't flake it, while a real regression (the fixed offset bug alone would
 * have read 6.95-8.44% here) still fails clearly. */
const OVERALL_DIFF_FRACTION_THRESHOLD = 0.05;
/** Same idea, scoped to the sidebar/TOC regions specifically - these are TEXT-DENSE (a nav tree, a
 * heading list), so a higher edge-pixel fraction than the viewport average is expected. Measured
 * post-fix: sidebar 2.40-2.61%, TOC 0.03-0.76%. 6% covers both with headroom (roughly 2.3x the higher
 * of the two ceilings) while still comfortably failing the offset bug's 7.43-11.22%. "Blank" is caught
 * independently by BLANK_STDDEV below, and a systematic shift specifically by the alignment check -
 * this threshold's remaining job is just "recognizably the same content", so it doesn't need to (and,
 * post-fix, no longer has to) carry the offset-detection burden on its own. */
const REGION_DIFF_FRACTION_THRESHOLD = 0.06;
/** The theme-select box is small and almost entirely TEXT ("Light"/"Dark"/"Auto" plus an icon and a
 * caret) - the right word and the wrong word look completely different pixel-for-pixel (different
 * glyphs, different widths). Measured post-fix (correct word): 2.23-2.64%. A wrong word replaces most
 * of the box's glyph pixels with different glyph pixels over the same background, which - from the
 * ~2.6% ceiling measured here for a MATCHING word - puts a mismatch far higher (well over 50%, same
 * order of magnitude as swapping "Auto" for "Light" entirely). 15% sits with real headroom above the
 * correct case (~5.7x) while staying far below where a wrong word would land. */
const THEME_SELECT_DIFF_FRACTION_THRESHOLD = 0.15;
/** Luminance standard deviation below which a region counts as "blank" (a flat fill has ~0-3; real
 * nav/TOC content - text, hover backgrounds, the active-item highlight - measured post-fix at
 * 20.06-34.15, so 10 sits with wide margin below every real measurement and well above a flat fill). */
const BLANK_STDDEV_THRESHOLD = 10;

let failures = 0;
function check(name, cond, note = '') {
	if (cond) console.log(`PASS - ${name}`);
	else {
		failures++;
		console.log(`FAIL - ${name}${note ? ` (${note})` : ''}`);
	}
}

// ---- Shared real-mouse/keyboard + shadow-DOM query helpers (same shapes as every other suite in
// this folder - duplicated rather than imported so this file stays a self-contained e2e entry point,
// matching the established convention here). -------------------------------------------------------

/** @param {import('playwright-core').ElementHandle | null} handle */
async function centerOf(handle) {
	if (!handle) throw new Error('centerOf: null element handle (selector matched nothing)');
	await handle.scrollIntoViewIfNeeded({ timeout: 5000 });
	const box = await handle.boundingBox();
	if (!box) throw new Error('centerOf: element has no bounding box (not visible/laid out)');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real mouse click at the element's on-screen center (not a script-dispatched `.click()`). */
async function realClick(page, handle) {
	const { x, y } = await centerOf(handle);
	await page.mouse.click(x, y);
}

/** @param {import('playwright-core').Page} page @param {'light'|'dark'} [lane] */
async function getFrame(page, lane = 'light') {
	const handle = await page.$(`iframe[data-svc-preview][data-svc-lane="${lane}"]`);
	return handle.contentFrame();
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

async function shadowQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector('sl-customizer').shadowRoot.querySelector(sel), selector);
	return handle.asElement();
}

async function shadowQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll(selector)).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
}

async function lightQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelectorAll(selector)).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
}

async function lightQueryByAttr(page, selector, attr, value) {
	const handle = await page.evaluateHandle(
		({ selector, attr, value }) => Array.from(document.querySelectorAll(selector)).find((el) => el.getAttribute(attr) === value) ?? null,
		{ selector, attr, value }
	);
	return handle.asElement();
}

/** @param {string} title The segmented device button's `title` attribute, e.g. "1440px". */
async function clickDevice(page, title) {
	await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', title));
}

async function openExportDialog(page) {
	await realClick(page, await lightQueryByText(page, '.svc-tb-btn', 'Export'));
	await page.waitForTimeout(200);
}

/** Escape closes the dialog (its backdrop's own keydown handler) - focus lands on the dialog's close
 * button when it opens, so this is a genuine keyboard interaction, not a scripted shortcut - and,
 * post-capture, a regression check in its own right: the capture button held focus when the click
 * that started the capture landed on it, and `export.js` used to leave it disabled-and-unfocused once
 * the capture finished (disabling a focused element silently drops focus, and browsers never restore
 * it just because the element becomes enabled again) - since this backdrop's keydown listener only
 * fires for events that bubble through it, a focus left outside the dialog made Escape do nothing.
 * `export.js` now re-focuses the button in its `finally`; the `check` below would catch a regression. */
async function closeExportDialog(page, label) {
	await page.keyboard.press('Escape');
	await page.waitForTimeout(150);
	const stillOpen = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-dialog-backdrop')?.hidden === false);
	check(`[${label}] Escape closes the export dialog after a capture (focus wasn't lost)`, !stillOpen);
	if (stillOpen) {
		// Don't leave a later scenario's clicks landing on a stray backdrop - force it shut so the
		// suite can still report every other check meaningfully.
		await realClick(page, await shadowQuery(page, "[aria-label='Close export dialog']"));
		await page.waitForTimeout(150);
	}
}

/** Everything about the live frame this suite checks is restored byte-for-byte after a capture
 * (requirement 5): scroll position, and the ABSENCE of every throwaway attribute `export.js` uses
 * (`data-svc-shot-fixed`, `data-svc-shot-select-value`) plus the theme `<select>`'s exact markup. */
async function snapshotLiveState(frame) {
	return frame.evaluate(() => ({
		scrollY: window.scrollY,
		bodyStyleAttr: document.body.getAttribute('style'),
		leftoverFixedMarks: document.body.querySelectorAll('[data-svc-shot-fixed]').length,
		leftoverSelectMarks: document.body.querySelectorAll('[data-svc-shot-select-value]').length,
		themeSelectOuterHTML: document.querySelector('starlight-theme-select select')?.outerHTML ?? null,
	}));
}

/**
 * Decodes both PNGs via `<canvas>`/`getImageData` IN THE BROWSER (no new npm dependency, per the
 * coordinator's brief) and diffs them: overall stats over the full overlapping area, plus per-region
 * stats for whatever rects are passed in `regions` (frame-viewport-relative `{x,y,width,height}`,
 * e.g. the sidebar/TOC/theme-select boxes), plus an ALIGNMENT check (round 2 - see `ALIGNMENT_TOLERANCE_PX`):
 * for each entry in `alignmentProbes`, scans a line of pixels in `ours` and the same line in `ref` and
 * finds the position of the single sharpest luminance jump (the real edge, e.g. a border or a
 * background-color change) - a systematic render offset moves that position in `ours` relative to
 * `ref` even when every region-level diff fraction stays "close enough" (region checks are fooled by
 * a shift because a shifted region still overlaps its own content heavily; this checks a geometric
 * position directly, not a fuzzy pixel match). Also renders a diff visualization: pixels over
 * `PIXEL_CHANNEL_TOLERANCE` painted solid red, everything else a dim grayscale passthrough of `ours`.
 * @param {import('playwright-core').Page} page
 * @param {{oursB64: string, refB64: string, regions: Record<string, {x:number,y:number,width:number,height:number}>, alignmentProbes: {name: string, axis: 'x'|'y', fixed: number, scanStart: number, scanEnd: number}[]}} args
 */
async function compareImages(page, { oursB64, refB64, regions, alignmentProbes }) {
	return page.evaluate(
		async ({ oursB64, refB64, regions, alignmentProbes, tolerance }) => {
			function loadImage(b64) {
				return new Promise((resolve, reject) => {
					const img = new Image();
					img.onload = () => resolve(img);
					img.onerror = () => reject(new Error('image decode failed'));
					img.src = `data:image/png;base64,${b64}`;
				});
			}
			function toImageData(img) {
				const c = document.createElement('canvas');
				c.width = img.naturalWidth;
				c.height = img.naturalHeight;
				const ctx = c.getContext('2d');
				ctx.drawImage(img, 0, 0);
				return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
			}
			/** Finds the position (between two adjacent samples, so e.g. 63.5) along a fixed row/column
			 * where consecutive-pixel luminance changes the MOST - the sharpest real edge in that line,
			 * as opposed to individual pixels differing from noise/antialiasing. */
			function findEdge(imgData, axis, fixed, scanStart, scanEnd) {
				const { width, data } = imgData;
				const lumAt = (x, y) => {
					const i = (y * width + x) * 4;
					return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
				};
				let bestPos = scanStart;
				let bestDelta = -1;
				for (let p = scanStart; p < scanEnd - 1; p++) {
					const l1 = axis === 'y' ? lumAt(fixed, p) : lumAt(p, fixed);
					const l2 = axis === 'y' ? lumAt(fixed, p + 1) : lumAt(p + 1, fixed);
					const delta = Math.abs(l2 - l1);
					if (delta > bestDelta) {
						bestDelta = delta;
						bestPos = p + 0.5;
					}
				}
				return { position: bestPos, delta: bestDelta };
			}

			const [oursImg, refImg] = await Promise.all([loadImage(oursB64), loadImage(refB64)]);
			const ours = toImageData(oursImg);
			const ref = toImageData(refImg);

			/** @type {Record<string, {ours: number, ref: number, offsetPx: number, oursEdgeStrength: number, refEdgeStrength: number}>} */
			const alignment = {};
			for (const probe of alignmentProbes || []) {
				const oursEdge = findEdge(ours, probe.axis, probe.fixed, probe.scanStart, probe.scanEnd);
				const refEdge = findEdge(ref, probe.axis, probe.fixed, probe.scanStart, probe.scanEnd);
				alignment[probe.name] = {
					ours: oursEdge.position,
					ref: refEdge.position,
					offsetPx: oursEdge.position - refEdge.position,
					oursEdgeStrength: oursEdge.delta,
					refEdgeStrength: refEdge.delta,
				};
			}

			const w = Math.min(ours.width, ref.width);
			const h = Math.min(ours.height, ref.height);

			const diffCanvas = document.createElement('canvas');
			diffCanvas.width = w;
			diffCanvas.height = h;
			const diffCtx = diffCanvas.getContext('2d');
			const diffImageData = diffCtx.createImageData(w, h);
			const od = ours.data;
			const rd = ref.data;
			const dd = diffImageData.data;

			let diffPixels = 0;
			let sumChannelDiff = 0;
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					const oIdx = (y * ours.width + x) * 4;
					const rIdx = (y * ref.width + x) * 4;
					const dr = Math.abs(od[oIdx] - rd[rIdx]);
					const dg = Math.abs(od[oIdx + 1] - rd[rIdx + 1]);
					const db = Math.abs(od[oIdx + 2] - rd[rIdx + 2]);
					const maxDiff = Math.max(dr, dg, db);
					const dIdx = (y * w + x) * 4;
					if (maxDiff > tolerance) {
						diffPixels++;
						dd[dIdx] = 255;
						dd[dIdx + 1] = 0;
						dd[dIdx + 2] = 0;
						dd[dIdx + 3] = 255;
					} else {
						const gray = Math.round(0.299 * od[oIdx] + 0.587 * od[oIdx + 1] + 0.114 * od[oIdx + 2]);
						dd[dIdx] = gray;
						dd[dIdx + 1] = gray;
						dd[dIdx + 2] = gray;
						dd[dIdx + 3] = 90;
					}
					sumChannelDiff += (dr + dg + db) / 3;
				}
			}
			diffCtx.putImageData(diffImageData, 0, 0);

			/** @type {Record<string, {diffFraction: number, stdDevLuminance: number, pixelCount: number}|{skipped: true}>} */
			const regionResults = {};
			for (const [name, rect] of Object.entries(regions || {})) {
				const rx = Math.max(0, Math.round(rect.x));
				const ry = Math.max(0, Math.round(rect.y));
				const rw = Math.max(0, Math.min(w - rx, Math.round(rect.width)));
				const rh = Math.max(0, Math.min(h - ry, Math.round(rect.height)));
				if (rw <= 0 || rh <= 0) {
					regionResults[name] = { skipped: true };
					continue;
				}
				let rDiffPixels = 0;
				let total = 0;
				let sumLum = 0;
				let sumSqLum = 0;
				for (let y = ry; y < ry + rh; y++) {
					for (let x = rx; x < rx + rw; x++) {
						const oIdx = (y * ours.width + x) * 4;
						const rIdx = (y * ref.width + x) * 4;
						const dr = Math.abs(od[oIdx] - rd[rIdx]);
						const dg = Math.abs(od[oIdx + 1] - rd[rIdx + 1]);
						const db = Math.abs(od[oIdx + 2] - rd[rIdx + 2]);
						if (Math.max(dr, dg, db) > tolerance) rDiffPixels++;
						const lum = 0.299 * od[oIdx] + 0.587 * od[oIdx + 1] + 0.114 * od[oIdx + 2];
						sumLum += lum;
						sumSqLum += lum * lum;
						total++;
					}
				}
				const meanLum = sumLum / total;
				const variance = Math.max(0, sumSqLum / total - meanLum * meanLum);
				regionResults[name] = { diffFraction: rDiffPixels / total, stdDevLuminance: Math.sqrt(variance), pixelCount: total };
			}

			return {
				dims: { ours: { w: ours.width, h: ours.height }, ref: { w: ref.width, h: ref.height } },
				sameDimensions: ours.width === ref.width && ours.height === ref.height,
				overall: { totalPixels: w * h, diffPixels, diffFraction: diffPixels / (w * h), meanChannelDiff: sumChannelDiff / (w * h) },
				regions: regionResults,
				alignment,
				diffPngB64: diffCanvas.toDataURL('image/png').split(',')[1],
			};
		},
		{ oursB64, refB64, regions, alignmentProbes, tolerance: PIXEL_CHANNEL_TOLERANCE }
	);
}

/** Round 2: 1px tolerance on the alignment probes above, per the coordinator's brief - a real render
 * (different rasterizer, subpixel antialiasing) can legitimately land an edge's exact sharpest-jump
 * position a fraction of a pixel apart between two otherwise-identical images; a SYSTEMATIC render
 * offset (the ~8px margin bug this round fixes) moves it by whole pixels, so 1px cleanly separates
 * "same rasterizer noise" from "actually shifted". */
const ALIGNMENT_TOLERANCE_PX = 1;

/** @param {{x:number,y:number,width:number,height:number}} headerRect
 * @param {{x:number,y:number,width:number,height:number}} sidebarRect
 * @returns {{name: string, axis: 'x'|'y', fixed: number, scanStart: number, scanEnd: number}[]} */
function alignmentProbesFor(headerRect, sidebarRect) {
	const probes = [];
	if (headerRect) {
		// Header's bottom border row: scan straight down through the header's own flat left padding
		// (x=4 - inside the nav bar, before any logo/text glyph starts) from the top of the frame past
		// where the header should end, looking for the header-background -> below-header-background
		// step.
		probes.push({ name: 'headerBottomEdge', axis: 'y', fixed: 4, scanStart: 0, scanEnd: Math.round(headerRect.height) + 60 });
	}
	if (sidebarRect) {
		// Left sidebar's right border column: scan across a row comfortably inside the sidebar's own
		// vertical extent, from just past the sidebar's left edge to well past its right edge, looking
		// for the sidebar-background -> main-content-background step.
		const y = Math.round(sidebarRect.y) + 40;
		probes.push({ name: 'sidebarRightEdge', axis: 'x', fixed: y, scanStart: Math.round(sidebarRect.x) + 50, scanEnd: Math.round(sidebarRect.x + sidebarRect.width) + 100 });
	}
	return probes;
}

/** @param {string} label @param {Record<string, {ours: number, ref: number, offsetPx: number}>} alignment */
function checkAlignment(label, alignment) {
	for (const [name, result] of Object.entries(alignment)) {
		console.log(`[${label}] alignment "${name}": ours=${result.ours} ref=${result.ref} offset=${result.offsetPx.toFixed(2)}px`);
		check(`[${label}] alignment "${name}" is within ${ALIGNMENT_TOLERANCE_PX}px of the reference (no systematic offset)`, Math.abs(result.offsetPx) <= ALIGNMENT_TOLERANCE_PX, `${result.offsetPx.toFixed(2)}px`);
	}
}

/**
 * Runs one "Visible area" scenario end-to-end: set the theme via the toolbar's real segmented
 * control, scroll the FRAME (never the host) to `scrollY`, take a Playwright reference screenshot of
 * the on-screen iframe, open Export, click "Visible area" (all real mouse), diff the two, and assert.
 * @param {import('playwright-core').Page} page
 * @param {{label: string, scrollY: number, themeLabel: 'Light'|'Dark'}} opts
 */
async function runVisibleAreaScenario(page, { label, scrollY, themeLabel }) {
	await realClick(page, await lightQueryByText(page, '.svc-seg-btn', themeLabel));
	await page.waitForTimeout(200);

	const frame = await getFrame(page);
	await frame.evaluate((y) => window.scrollTo(0, y), scrollY);
	await page.waitForTimeout(250);

	const geo = await frame.evaluate(() => {
		/** @param {Element|null} el */
		function rect(el) {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		}
		const select = document.querySelector('starlight-theme-select select');
		return {
			width: window.innerWidth,
			viewportHeight: window.innerHeight,
			scrollY: window.scrollY,
			header: rect(document.querySelector('.header')),
			sidebar: rect(document.querySelector('.sidebar-pane')),
			toc: rect(document.querySelector('.right-sidebar')),
			themeSelect: rect(document.querySelector('starlight-theme-select label')),
			themeSelectText: select?.selectedOptions?.[0]?.textContent ?? null,
		};
	});
	check(`[${label}] the frame is actually scrolled to the requested position`, geo.scrollY === scrollY, `${geo.scrollY} vs ${scrollY}`);
	check(`[${label}] the theme select reflects "${themeLabel}" in the live DOM before capture`, geo.themeSelectText === themeLabel, geo.themeSelectText);

	const before = await snapshotLiveState(frame);

	// The reference: a genuine Playwright screenshot of the on-screen iframe, taken BEFORE the export
	// dialog's backdrop covers it - "what the frame shows" is exactly what "Visible area" must match.
	const frameHandle = await page.$('iframe[data-svc-preview][data-svc-lane="light"]');
	const referenceBuffer = await frameHandle.screenshot();

	await openExportDialog(page);
	const downloadEvent = page.waitForEvent('download', { timeout: 60000 });
	await realClick(page, await shadowQuery(page, '.svc-export-shot-visible-btn'));
	const download = await downloadEvent;
	const oursBuffer = readFileSync(await download.path());
	await closeExportDialog(page, label);

	const after = await snapshotLiveState(frame);
	check(`[${label}] live page is restored exactly after the capture (scroll, no leftover marks, select markup)`, JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

	writeFileSync(path.join(BATCH_DIR, `screenshot-${label}-ours.png`), oursBuffer);
	writeFileSync(path.join(BATCH_DIR, `screenshot-${label}-reference.png`), referenceBuffer);

	/** @type {Record<string, {x:number,y:number,width:number,height:number}>} */
	const regions = {};
	if (geo.sidebar) regions.sidebar = geo.sidebar;
	if (geo.toc) regions.toc = geo.toc;
	if (geo.themeSelect) regions.themeSelect = geo.themeSelect;

	const alignmentProbes = alignmentProbesFor(geo.header, geo.sidebar);
	const cmp = await compareImages(page, { oursB64: oursBuffer.toString('base64'), refB64: referenceBuffer.toString('base64'), regions, alignmentProbes });
	if (cmp.diffPngB64) writeFileSync(path.join(BATCH_DIR, `screenshot-${label}-diff.png`), Buffer.from(cmp.diffPngB64, 'base64'));

	console.log(
		`[${label}] dims ours=${cmp.dims.ours.w}x${cmp.dims.ours.h} ref=${cmp.dims.ref.w}x${cmp.dims.ref.h}; overall diff ${(cmp.overall.diffFraction * 100).toFixed(2)}% of pixels, mean channel diff ${cmp.overall.meanChannelDiff.toFixed(2)}/255`
	);
	for (const [name, r] of Object.entries(cmp.regions)) {
		if (r.skipped) console.log(`[${label}] region "${name}" skipped (no rect)`);
		else console.log(`[${label}] region "${name}": diff ${(r.diffFraction * 100).toFixed(2)}%, stdDev luminance ${r.stdDevLuminance.toFixed(2)}`);
	}

	// Round 2: the alignment check - fails hard on any systematic render offset, regardless of
	// whether the region-diff-fraction checks below happen to still pass.
	checkAlignment(label, cmp.alignment);

	// (a) same dimensions
	check(`[${label}] "Visible area" PNG dimensions equal the frame's viewport (W x H)`, cmp.dims.ours.w === geo.width && cmp.dims.ours.h === geo.viewportHeight, JSON.stringify(cmp.dims.ours));
	check(`[${label}] "Visible area" PNG has the same dimensions as the Playwright reference`, cmp.sameDimensions, JSON.stringify(cmp.dims));

	// (b) sidebar / TOC not blank and match the reference
	if (geo.sidebar) {
		check(`[${label}] left sidebar region is not blank (stdDev luminance > ${BLANK_STDDEV_THRESHOLD})`, cmp.regions.sidebar.stdDevLuminance > BLANK_STDDEV_THRESHOLD, cmp.regions.sidebar.stdDevLuminance.toFixed(2));
		check(`[${label}] left sidebar region matches the reference (diff < ${REGION_DIFF_FRACTION_THRESHOLD * 100}%)`, cmp.regions.sidebar.diffFraction < REGION_DIFF_FRACTION_THRESHOLD, `${(cmp.regions.sidebar.diffFraction * 100).toFixed(2)}%`);
	} else {
		check(`[${label}] left sidebar region found in the live frame`, false, 'no .sidebar-pane element');
	}
	if (geo.toc) {
		check(`[${label}] right TOC region is not blank (stdDev luminance > ${BLANK_STDDEV_THRESHOLD})`, cmp.regions.toc.stdDevLuminance > BLANK_STDDEV_THRESHOLD, cmp.regions.toc.stdDevLuminance.toFixed(2));
		check(`[${label}] right TOC region matches the reference (diff < ${REGION_DIFF_FRACTION_THRESHOLD * 100}%)`, cmp.regions.toc.diffFraction < REGION_DIFF_FRACTION_THRESHOLD, `${(cmp.regions.toc.diffFraction * 100).toFixed(2)}%`);
	} else {
		check(`[${label}] right TOC region found in the live frame`, false, 'no .right-sidebar element');
	}

	// (c) overall pixel difference below threshold
	check(`[${label}] overall pixel difference below threshold (${OVERALL_DIFF_FRACTION_THRESHOLD * 100}%)`, cmp.overall.diffFraction < OVERALL_DIFF_FRACTION_THRESHOLD, `${(cmp.overall.diffFraction * 100).toFixed(2)}%`);

	// (d) theme select text matches - both the DOM (checked above) and the RENDERED pixels (this
	// catches export.js showing the wrong option even if the live DOM were somehow fine, and vice
	// versa: it's the same class of "trust the pixels, not just the DOM" reasoning as the sidebar/TOC
	// checks above).
	if (geo.themeSelect) {
		check(
			`[${label}] theme select region's rendered pixels match the reference (confirms "${themeLabel}" is what's drawn, diff < ${THEME_SELECT_DIFF_FRACTION_THRESHOLD * 100}%)`,
			cmp.regions.themeSelect.diffFraction < THEME_SELECT_DIFF_FRACTION_THRESHOLD,
			`${(cmp.regions.themeSelect.diffFraction * 100).toFixed(2)}%`
		);
	} else {
		check(`[${label}] theme select region found in the live frame`, false, 'no starlight-theme-select label element');
	}

	return { geo, cmp };
}

/** Full page smoke check: dimensions = W x full scroll height, and the top viewport-height slice
 * matches a Playwright reference (a real iframe screenshot only ever shows the current viewport, so
 * it's naturally a "top of the page" reference - this reuses `compareImages`'s overlap-clamped overall
 * diff, since `min(oursHeight, refHeight)` IS exactly that top slice when `ours` is much taller).
 * `header` is passed separately from `regions` (rather than folded into it) because it only drives the
 * alignment probes here, not a blank/diff-fraction region check like sidebar/toc get. */
async function runFullPageScenario(page, { label, regions, header }) {
	const frame = await getFrame(page);
	await frame.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(200);

	const geo = await frame.evaluate(() => ({
		width: window.innerWidth,
		viewportHeight: window.innerHeight,
		fullHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
	}));

	const before = await snapshotLiveState(frame);
	const frameHandle = await page.$('iframe[data-svc-preview][data-svc-lane="light"]');
	const referenceBuffer = await frameHandle.screenshot();

	await openExportDialog(page);
	const downloadEvent = page.waitForEvent('download', { timeout: 90000 });
	await realClick(page, await shadowQuery(page, '.svc-export-shot-full-btn'));
	const download = await downloadEvent;
	const oursBuffer = readFileSync(await download.path());
	await closeExportDialog(page, label);

	const after = await snapshotLiveState(frame);
	check(`[${label}] live page is restored exactly after the capture`, JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

	writeFileSync(path.join(BATCH_DIR, `screenshot-${label}-ours.png`), oursBuffer);
	writeFileSync(path.join(BATCH_DIR, `screenshot-${label}-reference-top.png`), referenceBuffer);

	const alignmentProbes = alignmentProbesFor(header, regions?.sidebar);
	const cmp = await compareImages(page, { oursB64: oursBuffer.toString('base64'), refB64: referenceBuffer.toString('base64'), regions, alignmentProbes });
	if (cmp.diffPngB64) writeFileSync(path.join(BATCH_DIR, `screenshot-${label}-diff.png`), Buffer.from(cmp.diffPngB64, 'base64'));

	console.log(`[${label}] dims ours=${cmp.dims.ours.w}x${cmp.dims.ours.h} (expected ${geo.width}x${geo.fullHeight}); top-slice overall diff ${(cmp.overall.diffFraction * 100).toFixed(2)}%`);

	// Round 2: same alignment check as the Visible area scenarios - the ~8px margin bug this round
	// fixed hit Full page identically (it happens at scroll 0, and Full page always renders from
	// scroll 0 regardless of the live page's current scroll position).
	checkAlignment(label, cmp.alignment);

	check(`[${label}] "Full page" PNG dimensions equal W x full scroll height`, cmp.dims.ours.w === geo.width && cmp.dims.ours.h === geo.fullHeight, `${cmp.dims.ours.w}x${cmp.dims.ours.h} vs ${geo.width}x${geo.fullHeight}`);
	check(`[${label}] "Full page" top region matches the reference (diff < ${OVERALL_DIFF_FRACTION_THRESHOLD * 100}%)`, cmp.overall.diffFraction < OVERALL_DIFF_FRACTION_THRESHOLD, `${(cmp.overall.diffFraction * 100).toFixed(2)}%`);
	if (regions?.sidebar) check(`[${label}] left sidebar is not blank in "Full page" either (regression check)`, cmp.regions.sidebar.stdDevLuminance > BLANK_STDDEV_THRESHOLD, cmp.regions.sidebar.stdDevLuminance.toFixed(2));
	if (regions?.toc) check(`[${label}] right TOC is not blank in "Full page" either (regression check)`, cmp.regions.toc.stdDevLuminance > BLANK_STDDEV_THRESHOLD, cmp.regions.toc.stdDevLuminance.toFixed(2));
}

async function main() {
	mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	mkdirSync(BATCH_DIR, { recursive: true });

	// Wide enough that the studio's own "shrink 1440 to fit the column" logic never kicks in - the
	// device stays at scale 1 (verified below), so the frame's internal CSS pixels are exactly the
	// PNG's pixels, matching `export.js`'s own `scale: 1` (never devicePixelRatio-scaled) assumption.
	const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
	const page = await browser.newPage({ viewport: { width: 2100, height: 1150 } });

	// try/finally: a crash partway through must still close the browser (and with it, the Chromium
	// child process) - an uncaught rejection here previously left both running as orphans.
	try {
		const errors = [];
		page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(`[console error] ${msg.text()}`);
		});

		await page.goto(`${SVC_BASE_URL}/studio/?page=/guides/kitchen-sink/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		await page.waitForTimeout(300);

		// ---- Setup: Desktop 1440 device, Document page (already loaded via the URL above), a
		// non-default preset, light mode. ------------------------------------------------------------
		await clickDevice(page, '1440px');
		await page.waitForTimeout(300);

		let frame = await getFrame(page);
		const frameWidth = await frame.evaluate(() => window.innerWidth);
		check('the Desktop 1440 device sets the frame to exactly 1440 CSS px wide', frameWidth === 1440, frameWidth);
		const laneScale = await page.evaluate(() => document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]')?.dataset.svcScale ?? null);
		check('the lane is unscaled (scale 1) - the viewport is wide enough for the 1440 device to fit', laneScale === null, `dataset.svcScale=${laneScale}`);

		// Presets is the rail's default-active group (a rail item click on the ALREADY-active group
		// collapses the panel instead of opening it - panel.js's F3 behavior), so open a different
		// group first to guarantee the Presets click below actually opens it rather than toggling it
		// shut.
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(200);
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Presets"]'));
		await page.waitForTimeout(200);
		await realClick(page, await shadowQueryByText(page, '.svc-preset-card', 'Editorial Serif'));
		await page.waitForTimeout(300);
		const presetState = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().preset);
		check('a non-default preset ("Editorial Serif") is applied', presetState === 'editorial-serif', presetState);

		// ---- Scenario geometry: a mid-page scroll position, proportional to this fixture's actual
		// scrollable range so the suite isn't tied to kitchen-sink's exact current word count. --------
		const fullRange = await frame.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight);
		const midScrollY = Math.max(200, Math.round(fullRange * 0.4));

		// ---- Scenario 1: mid-scroll, light mode - the bug's exact repro shape. ----------------------
		await runVisibleAreaScenario(page, { label: 'mid-scroll-light', scrollY: midScrollY, themeLabel: 'Light' });

		// ---- Scenario 2: mid-scroll, dark mode. ------------------------------------------------------
		const scenario2 = await runVisibleAreaScenario(page, { label: 'mid-scroll-dark', scrollY: midScrollY, themeLabel: 'Dark' });

		// ---- Scenario 3: scroll 0 (the trivial case - regression check that it's still correct). -----
		await runVisibleAreaScenario(page, { label: 'scroll0-light', scrollY: 0, themeLabel: 'Light' });

		// ---- Scenario 4: Full page smoke check, reusing scenario 2's sidebar/TOC rects
		// (position:fixed, viewport-relative, so unaffected by scroll or by which capture produced
		// them). ----------------------------------------------------------------------------------------
		await runFullPageScenario(page, { label: 'full-page', regions: { sidebar: scenario2.geo.sidebar, toc: scenario2.geo.toc }, header: scenario2.geo.header });

		console.log(`\n${errors.length} browser console/page errors observed across the whole suite.`);
		for (const e of errors.slice(0, 20)) console.log(e);
		check('no page/console errors were logged anywhere in this suite (including during any capture)', errors.length === 0, `${errors.length} error(s)`);
	} finally {
		await browser.close();
	}

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => {
		// Belt-and-suspenders: force the process to end even if some dangling handle (a pipe to an
		// already-closed browser, etc.) would otherwise keep the event loop alive.
		process.exit(process.exitCode ?? 0);
	});
