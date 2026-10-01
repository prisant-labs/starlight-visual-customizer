// @ts-check
/**
 * @file Acceptance suite: hex color entry, preset cards,
 * the restyled structure editor, and the site title text control. Also owns two later,
 * unrelated export-dialog additions kept here rather than a new suite:
 * "Download all (.zip)" and "Screenshot (PNG)" (Visible area / Full page). Complements
 * `shell.mjs` (which this suite's contrast/hit-test extensions also live in)
 * rather than duplicating its shell-level checks.
 *
 * Needs a running server; start one first: `npm run build` then
 * `npm run preview:bg` (or `npx astro preview --background --port 4420`).
 *   node tests/e2e/editors.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420), SVC_CHROME_PATH.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
const EXECUTABLE_PATH =
	process.env.SVC_CHROME_PATH || chromium.executablePath();
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

let failures = 0;
function check(name, cond, note = '') {
	if (cond) console.log(`PASS - ${name}`);
	else {
		failures++;
		console.log(`FAIL - ${name}${note ? ` (${note})` : ''}`);
	}
}

// ---- Shared real-mouse/keyboard + shadow-DOM query helpers (same shapes as shell.mjs's own -
// duplicated here rather than imported so this file stays a self-contained e2e entry point, matching
// every other suite in this folder). --------------------------------------------------------------

async function centerOf(handle) {
	if (!handle) throw new Error('centerOf: null element handle (selector matched nothing)');
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

/** Real mouse drag from one element's center to another's - genuine mousedown -> stepped
 * mousemove -> mouseup, exercising HTML5 drag-and-drop the way a person dragging would. */
async function realDragTo(page, fromHandle, toHandle, { toFraction = 0.5, steps = 12, pauseMs = 0 } = {}) {
	const from = await centerOf(fromHandle);
	const toBox = (await toHandle.boundingBox());
	const toY = toBox.y + toBox.height * toFraction;
	const toX = toBox.x + toBox.width / 2;
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move((from.x + toX) / 2, (from.y + toY) / 2, { steps: Math.ceil(steps / 2) });
	await page.mouse.move(toX, toY, { steps: Math.ceil(steps / 2) });
	if (pauseMs) await page.waitForTimeout(pauseMs);
	return async () => {
		await page.mouse.up();
	};
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

async function lightQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector(sel), selector);
	return handle.asElement();
}

async function lightQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelectorAll(selector)).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
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
			return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-group-studio'));
		},
		{ timeout }
	);
}

async function waitForComputed(getValue, predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		last = await getValue();
		if (predicate(last)) return last;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return last;
}

/** Polls until `getValue()` both satisfies `predicate` AND agrees with the PREVIOUS poll - a hex
 * commit's rAF-deferred "produced color" readback (see commitHex) means a naive "differs from
 * baseline" wait can catch the raw, not-yet-normalized typed text (or a stray intermediate paint)
 * instead of the settled final value; requiring two consecutive matching reads avoids that. */
async function waitForStableComputed(getValue, predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let previous = null;
	while (Date.now() < deadline) {
		const current = await getValue();
		if (predicate(current) && previous === current) return current;
		if (predicate(current)) previous = current;
		else previous = null;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return previous;
}

/** Selects all text in a focused input/textarea and types a replacement (Ctrl+A then real keystrokes). */
async function retypeFocused(page, text) {
	await page.keyboard.press('Control+A');
	await page.keyboard.type(text, { delay: 15 });
}

/** Only the FIRST section of a group starts open (B's existing collapsible-sections rule) - a real
 * click can't reach a control in a collapsed section (no bounding box), so tests that need one
 * (Colors' "Role overrides", Header's "Site title") must open it first, with a real click too. */
async function ensureSectionOpen(page, sectionLabel) {
	const isOpen = await page.evaluate((label) => {
		const section = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-section')).find((s) => s.querySelector('.svc-section-toggle-label')?.textContent === label);
		return section?.dataset.open === 'true';
	}, sectionLabel);
	if (isOpen) return;
	const toggle = await shadowQueryByText(page, '.svc-section-toggle', sectionLabel);
	await realClick(page, toggle);
	await page.waitForTimeout(150);
}

async function main() {
	mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });
	const errors = [];
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
	});

	await page.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
	await waitForPanelBody(page);
	await page.waitForTimeout(300);

	// =============================================================================================
	// Hex entry - accent hex field, one undo step (real bug repro, real clicks throughout).
	// The bug: clicking the top-bar Undo button BLURS the hex field, and blur used to unconditionally
	// re-commit whatever the field currently displayed (the just-produced color), back-solving a
	// SECOND, slightly different hue/chroma and recording a second history step - so the first real
	// Undo click appeared to do nothing. Must use a REAL click on the top-bar button (not
	// `__svc.undo()`), since a script-invoked undo never blurs anything and would never have caught this.
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors', { scroll: false }));
		await page.waitForTimeout(200);

		const baselineHue = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const baselineChroma = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.chroma']);
		const baselineHex = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		const frame = await getFrame(page, 'light');
		const baselineAccent = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sl-color-accent').trim());

		const hexInput = await shadowQuery(page, "[data-control-id='color.accent.hue'] .svc-color-hex");
		await realClick(page, hexInput);
		await retypeFocused(page, '#e63946');
		await page.keyboard.press('Enter');

		// Wait for the SETTLED state, not just "changed from baseline" - the field briefly shows the
		// raw typed text before commitHex's rAF callback overwrites it with the produced color, and a
		// naive "differs from baseline" check can catch that transient instead of the final value.
		const accentAfterType = await waitForStableComputed(
			() => frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sl-color-accent').trim()),
			(v) => !!v && v !== baselineAccent
		);
		const hueAfterType = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const chromaAfterType = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.chroma']);
		check('the hex commit actually changed hue and/or chroma (not a no-op)', hueAfterType !== baselineHue || chromaAfterType !== baselineChroma, `${baselineHue}/${baselineChroma} -> ${hueAfterType}/${chromaAfterType}`);
		// A back-solve lands on each control's own step (hue 1, accent chroma 0.005), not a raw float.
		const onSteps = (hueAfterType === undefined || Number.isInteger(hueAfterType)) &&
			(chromaAfterType === undefined || Math.abs(chromaAfterType * 200 - Math.round(chromaAfterType * 200)) < 1e-9);
		check('the hex commit stores hue and chroma on their slider steps', onSteps, `${hueAfterType}/${chromaAfterType}`);
		const hueBoxText = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type='number']").value);
		check('the accent hue box shows a whole number after the hex commit', /^\d+$/.test(hueBoxText), hueBoxText);
		const hexAfterType = await waitForStableComputed(
			() => page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value),
			(v) => /^#[0-9a-f]{6}$/.test(v) && v !== baselineHex
		);
		const canUndoAfterType = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('undo is available after the hex commit', canUndoAfterType);

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-hex-accent.png') });

		// The actual repro: a REAL mouse click on the top-bar Undo button (blurs the hex field).
		await realClick(page, await lightQuery(page, "button[aria-label='Undo']"));
		await page.waitForTimeout(200);
		const hueAfterUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const chromaAfterUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.chroma']);
		check(
			'one real click on Undo restores BOTH hue and chroma to their pre-hex-commit values (a single step, not two)',
			hueAfterUndo === baselineHue && chromaAfterUndo === baselineChroma,
			`hue ${hueAfterUndo} vs ${baselineHue}, chroma ${chromaAfterUndo} vs ${baselineChroma}`
		);
		const hexAfterUndo = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		check('the hex field shows the ORIGINAL color after one real Undo click', hexAfterUndo === baselineHex, `${hexAfterUndo} vs ${baselineHex}`);
		const canUndoAfterUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		const canRedoAfterUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canRedo());
		check('after one real Undo click, nothing more is left to undo (it really was one step)', canUndoAfterUndo === false, String(canUndoAfterUndo));
		check('after one real Undo click, redo is available', canRedoAfterUndo === true);

		const frameAfterUndo = await getFrame(page, 'light');
		const accentAfterUndo = await frameAfterUndo.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sl-color-accent').trim());
		check('the frame accent reverted too after one real Undo click', accentAfterUndo !== accentAfterType, `${accentAfterUndo} vs ${accentAfterType}`);

		// Real click on Redo - the red comes back.
		await realClick(page, await lightQuery(page, "button[aria-label='Redo']"));
		await page.waitForTimeout(200);
		const hueAfterRedo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const chromaAfterRedo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.chroma']);
		check('a real click on Redo restores the hex-typed accent', hueAfterRedo === hueAfterType && chromaAfterRedo === chromaAfterType, `${hueAfterRedo}/${chromaAfterRedo} vs ${hueAfterType}/${chromaAfterType}`);
		const hexAfterRedo = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		check('the hex field shows the produced red again after Redo', hexAfterRedo === hexAfterType, `${hexAfterRedo} vs ${hexAfterType}`);

		// Leave undone for a clean baseline before the remaining sections.
		await realClick(page, await lightQuery(page, "button[aria-label='Undo']"));
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// E1: an invalid hex changes nothing and shows an inline message
	// =============================================================================================
	{
		const baselineHue = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const hexInput = await shadowQuery(page, "[data-control-id='color.accent.hue'] .svc-color-hex");
		await realClick(page, hexInput);
		await retypeFocused(page, 'not-a-color');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(150);
		const hueAfter = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('an invalid hex leaves the value unchanged', hueAfter === baselineHue, `${baselineHue} -> ${hueAfter}`);
		const errorVisible = await page.evaluate(() => {
			const row = document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue']");
			const msg = row.querySelector(".svc-color-hex-msg[data-kind='error']");
			return !!msg && !msg.hidden;
		});
		check('an inline error message appears for invalid hex input', errorVisible);
		// An invalid commit must never touch history either - confirms the earlier section's own
		// "leave undone" cleanup really did leave nothing pending (clicking Undo/Redo here to "test"
		// that would itself call svc.redo(), which re-applies whatever's on the redo stack and would
		// contaminate every section after this one - reading canUndo/canRedo is the safe check).
		const canUndoAfterInvalid = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('an invalid hex commit does not touch the undo stack', canUndoAfterInvalid === false, String(canUndoAfterInvalid));
	}

	// =============================================================================================
	// Role override - the SAME undo bug repro, with a real click on the top-bar Undo button, plus
	// the "Auto" tag / clear button (never both shown at once).
	// =============================================================================================
	{
		await ensureSectionOpen(page, 'Role overrides');
		const rowSel = "[data-control-id='color.role.link']";
		const before = await page.evaluate((sel) => {
			const row = document.querySelector('sl-customizer').shadowRoot.querySelector(sel);
			return {
				value: document.querySelector('sl-customizer').__svc.getState().values['color.role.link'],
				hex: row.querySelector('.svc-color-hex').value,
				autoTagHidden: row.querySelector('.svc-color-auto-tag').hidden,
				clearHidden: row.querySelector('.svc-color-clear').hidden,
				resetHidden: row.querySelector('.svc-reset:not(.svc-color-clear)')?.hidden,
			};
		}, rowSel);
		check('a fresh role override starts as "Auto" (tag shown, clear hidden)', before.autoTagHidden === false && before.clearHidden === true, JSON.stringify(before));
		check('no separate reset arrow is shown for a role override (the clear button already covers it)', before.resetHidden !== false, JSON.stringify(before));

		const hexInput = await shadowQuery(page, `${rowSel} .svc-color-hex`);
		await realClick(page, hexInput);
		await retypeFocused(page, '#112233');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(150);
		const afterSet = await page.evaluate((sel) => {
			const row = document.querySelector('sl-customizer').shadowRoot.querySelector(sel);
			return {
				value: document.querySelector('sl-customizer').__svc.getState().values['color.role.link'],
				autoTagHidden: row.querySelector('.svc-color-auto-tag').hidden,
				clearHidden: row.querySelector('.svc-color-clear').hidden,
			};
		}, rowSel);
		check('a role override set by hex applies to state', afterSet.value === '#112233', String(afterSet.value));
		check('once overridden, the "Auto" tag hides and the clear button shows', afterSet.autoTagHidden === true && afterSet.clearHidden === false, JSON.stringify(afterSet));

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-role-override-hex.png') });

		// The bug repro, role-override flavor: a real click on Undo must blur the field as a no-op
		// (the value didn't change since the Enter commit), restoring in exactly one step.
		const canUndoBeforeClick = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('undo is available after the role-override hex commit', canUndoBeforeClick);
		await realClick(page, await lightQuery(page, "button[aria-label='Undo']"));
		await page.waitForTimeout(200);
		const afterUndo = await page.evaluate((sel) => {
			const row = document.querySelector('sl-customizer').shadowRoot.querySelector(sel);
			return {
				value: document.querySelector('sl-customizer').__svc.getState().values['color.role.link'],
				hex: row.querySelector('.svc-color-hex').value,
				autoTagHidden: row.querySelector('.svc-color-auto-tag').hidden,
				clearHidden: row.querySelector('.svc-color-clear').hidden,
			};
		}, rowSel);
		check('one real click on Undo restores the role override to "auto" (a single step)', (afterUndo.value === undefined || afterUndo.value === 'auto') && afterUndo.hex === before.hex, JSON.stringify({ before, afterUndo }));
		check('after undo, the row shows "Auto" again (tag shown, clear hidden)', afterUndo.autoTagHidden === false && afterUndo.clearHidden === true, JSON.stringify(afterUndo));
		const canUndoAfterUndo2 = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('after one real Undo click, nothing more is left to undo for the role override either', canUndoAfterUndo2 === false, String(canUndoAfterUndo2));

		await realClick(page, await lightQuery(page, "button[aria-label='Redo']"));
		await page.waitForTimeout(150);
		const afterRedo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.role.link']);
		check('a real click on Redo re-applies the role override', afterRedo === '#112233', String(afterRedo));

		const clearBtn = await shadowQuery(page, `${rowSel} .svc-color-clear`);
		await realClick(page, clearBtn);
		await page.waitForTimeout(150);
		const valueAfterClear = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.role.link']);
		check('the clear button returns a role override to "auto" (follows the palette)', valueAfterClear === undefined || valueAfterClear === 'auto', String(valueAfterClear));
		// Note: the clear button click above is itself a valid, intentionally-left undo step (clicking
		// "Undo" right now would legitimately restore the override, not "clean up" anything) - the P3
		// section below clears the WHOLE stack itself before relying on an empty one, rather than this
		// section pretending its own history never happened.
	}

	// =============================================================================================
	// The hex-first color popover (vanilla-colorful). A real click
	// opens it with the hex field prefilled; typing a hex and pressing Enter commits hue+chroma as
	// ONE undo step (matching the row's own primary hex field); a real drag on the popover's hue bar
	// (many mousemove events) coalesces into ONE undo step too (the coalesceKey addition to
	// onChangeMany - see panel.js); Escape and an outside click both close it.
	// =============================================================================================
	{
		// Start from a genuinely empty undo stack - this section's own "nothing left to undo" checks
		// below assume it.
		while (await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo())) {
			await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
			await page.waitForTimeout(80);
		}
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors', { scroll: false }));
		await page.waitForTimeout(200);

		const swatchBtn = await shadowQuery(page, "[data-control-id='color.accent.hue'] .svc-color-picker");
		await realClick(page, swatchBtn);
		await page.waitForTimeout(200);
		const popoverState = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const popover = host.shadowRoot.querySelector('.svc-color-popover');
			const hexField = popover?.querySelector('.svc-color-popover-hex');
			return {
				open: !!popover && !popover.hidden,
				hexPrefilled: hexField ? /^#[0-9a-f]{6}$/.test(hexField.value) : false,
				hasPicker: !!popover?.querySelector('hex-color-picker'),
			};
		});
		check('a real click on the swatch button opens the popover with the hex field prefilled', popoverState.open && popoverState.hexPrefilled && popoverState.hasPicker, JSON.stringify(popoverState));

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-color-popover.png') });

		const baselineHue = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const popoverHexField = await shadowQuery(page, '.svc-color-popover:not([hidden]) .svc-color-popover-hex');
		await realClick(page, popoverHexField);
		await retypeFocused(page, '#337799');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(250);
		const afterPopoverHex = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values);
		check('typing a hex into the popover field commits hue and chroma', afterPopoverHex['color.accent.hue'] !== baselineHue && afterPopoverHex['color.accent.hue'] !== undefined, JSON.stringify(afterPopoverHex));
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const afterUndo1 = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('one undo after a popover hex commit fully reverts it (one step)', afterUndo1 === baselineHue, `${baselineHue} vs ${afterUndo1}`);
		const canUndoAfterUndo1 = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('after one undo, nothing more is left from the popover hex commit', canUndoAfterUndo1 === false, String(canUndoAfterUndo1));

		// A real drag on the hue bar - vanilla-colorful's own `[part="hue"]` slider, inside
		// hex-color-picker's OWN nested shadow root - many mousemove events, one coalesced undo step.
		const pickerHandle = await shadowQuery(page, '.svc-color-popover:not([hidden]) hex-color-picker');
		const hueBarBox = await page.evaluate((picker) => {
			const hue = picker.shadowRoot.querySelector('[part="hue"]');
			const r = hue.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		}, pickerHandle);
		const dragY = hueBarBox.y + hueBarBox.height / 2;
		await page.mouse.move(hueBarBox.x + hueBarBox.width * 0.1, dragY);
		await page.mouse.down();
		await page.mouse.move(hueBarBox.x + hueBarBox.width * 0.35, dragY, { steps: 6 });
		await page.mouse.move(hueBarBox.x + hueBarBox.width * 0.6, dragY, { steps: 6 });
		await page.mouse.up();
		await page.waitForTimeout(450); // the popover's own trailing settle timer (200ms) + a rAF tick
		const afterDrag = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('a real drag on the popover hue bar changes the accent hue', afterDrag !== baselineHue && afterDrag !== undefined, `${baselineHue} -> ${afterDrag}`);
		const canUndoAfterDrag = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('undo is available after the hue-bar drag', canUndoAfterDrag);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const afterDragUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		check('one undo after the hue-bar drag fully reverts it (one coalesced step)', afterDragUndo === baselineHue, `${baselineHue} vs ${afterDragUndo}`);
		const canUndoAfterDragUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('after one undo, nothing more is left from the hue-bar drag', canUndoAfterDragUndo === false, String(canUndoAfterDragUndo));

		// Escape closes it.
		const stillOpenBeforeEsc = await page.evaluate(() => !document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover')?.hidden);
		check('the popover is still open before Escape', stillOpenBeforeEsc);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		const closedByEsc = await page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover')?.hidden);
		check('Escape closes the popover', closedByEsc);

		// An outside click closes it too.
		await realClick(page, swatchBtn);
		await page.waitForTimeout(200);
		await realClick(page, await shadowQuery(page, '.svc-filter'));
		await page.waitForTimeout(150);
		const closedByOutsideClick = await page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-color-popover')?.hidden);
		check('an outside click closes the popover', closedByOutsideClick);
	}

	// =============================================================================================
	// Color popover formats: HEX by default, RGB and HSL on request, the last choice remembered
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors', { scroll: false }));
		await page.waitForTimeout(200);
		const popoverState = () =>
			page.evaluate(() => {
				const pop = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-color-popover')).find((p) => !p.hidden);
				if (!pop) return null;
				return {
					pressed: pop.querySelector('.svc-color-format-btn[aria-pressed="true"]')?.dataset.format,
					hexVisible: !pop.querySelector('.svc-color-popover-hex').hidden,
					rgbVisible: !pop.querySelector('.svc-color-channels[data-format="rgb"]').hidden,
					hex: pop.querySelector('.svc-color-popover-hex').value,
					rgb: Array.from(pop.querySelectorAll('.svc-color-channels[data-format="rgb"] input')).map((i) => i.value),
					hsl: Array.from(pop.querySelectorAll('.svc-color-channels[data-format="hsl"] input')).map((i) => i.value),
				};
			});
		const hexToInts = (hex) => [1, 3, 5].map((i) => String(parseInt(hex.slice(i, i + 2), 16)));

		await realClick(page, await shadowQuery(page, "[data-control-id='color.accent.hue'] .svc-color-picker"));
		await page.waitForTimeout(250);
		const initial = await popoverState();
		check('the color popover opens in HEX by default', initial?.pressed === 'hex' && initial.hexVisible && !initial.rgbVisible, JSON.stringify(initial));

		await realClick(page, await shadowQuery(page, '.svc-color-popover:not([hidden]) .svc-color-format-btn[data-format="rgb"]'));
		await page.waitForTimeout(150);
		const inRgb = await popoverState();
		check(
			'RGB shows three whole-number boxes that match the hex',
			inRgb?.pressed === 'rgb' && inRgb.rgbVisible && !inRgb.hexVisible && JSON.stringify(inRgb.rgb) === JSON.stringify(hexToInts(inRgb.hex)),
			JSON.stringify(inRgb)
		);
		const focusedChannel = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.activeElement?.dataset?.channel);
		check('switching to RGB focuses the red box', focusedChannel === 'r', String(focusedChannel));

		const stateBeforeRgb = await page.evaluate(() => JSON.stringify(document.querySelector('sl-customizer').__svc.getState().values));
		await retypeFocused(page, '200');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);
		const afterRgb = await popoverState();
		const stateAfterRgb = await page.evaluate(() => JSON.stringify(document.querySelector('sl-customizer').__svc.getState().values));
		check('an RGB edit commits a new accent', stateAfterRgb !== stateBeforeRgb && afterRgb?.rgb[0] === '200', `${afterRgb?.rgb} ${stateAfterRgb}`);
		check('the popover hex follows the RGB edit', afterRgb?.hex?.startsWith('#c8'), String(afterRgb?.hex));

		await realClick(page, await shadowQuery(page, '.svc-color-popover:not([hidden]) .svc-color-format-btn[data-format="hsl"]'));
		await page.waitForTimeout(150);
		const inHsl = await popoverState();
		check('HSL shows three whole-number boxes', inHsl?.pressed === 'hsl' && inHsl.hsl.length === 3 && inHsl.hsl.every((v) => /^\d+$/.test(v)), JSON.stringify(inHsl));

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		await realClick(page, await shadowQuery(page, "[data-control-id='color.accent.hue'] .svc-color-picker"));
		await page.waitForTimeout(250);
		const reopened = await popoverState();
		const stored = await page.evaluate(() => localStorage.getItem('svc-color-format'));
		check('the popover reopens in the last format picked, remembered per browser', reopened?.pressed === 'hsl' && stored === 'hsl', `${reopened?.pressed} / ${stored}`);

		// Leave HEX selected and the RGB edit undone, so later sections start from the usual state.
		await realClick(page, await shadowQuery(page, '.svc-color-popover:not([hidden]) .svc-color-format-btn[data-format="hex"]'));
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(200);
		const stateAfterUndo = await page.evaluate(() => JSON.stringify(document.querySelector('sl-customizer').__svc.getState().values));
		check('one undo reverts the RGB edit', stateAfterUndo === stateBeforeRgb, stateAfterUndo);
	}

	// =============================================================================================
	// E2: preset cards show an accent anchor, a name and a swatch strip (no mini page preview), and a real click applies a preset
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Presets', { scroll: false }));
		await page.waitForTimeout(200);

		const previews = await page.evaluate(() => {
			const cards = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-preset-card'));
			return cards.map((c) => {
				const anchor = c.querySelector('.svc-preset-anchor');
				const accentSwatch = c.querySelectorAll('.svc-preset-swatch')[1];
				return {
					name: c.querySelector('.svc-preset-name')?.textContent,
					hasMiniDoc: !!c.querySelector('.svc-preset-mini-doc'),
					anchor: anchor ? getComputedStyle(anchor).backgroundColor : null,
					accent: accentSwatch ? getComputedStyle(accentSwatch).backgroundColor : null,
					anchorFirst: c.firstElementChild === anchor,
				};
			});
		});
		check('every preset card has a name', previews.length >= 3 && previews.every((p) => !!p.name), JSON.stringify(previews));
		check('no preset card renders a mini page preview', previews.every((p) => !p.hasMiniDoc), JSON.stringify(previews));
		check('every preset card leads with an anchor chip in its accent color', previews.every((p) => p.anchorFirst && !!p.anchor && p.anchor === p.accent), JSON.stringify(previews));
		check('preset card names are distinct', new Set(previews.map((p) => p.name)).size === previews.length, JSON.stringify(previews));

		// One column - every card's left edge lines up (stacked vertically, not
		// side by side), and the description text is gone (kept only as the card's `title` tooltip).
		const layoutInfo = await page.evaluate(() => {
			const cards = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-preset-card'));
			const lefts = cards.slice(0, 3).map((c) => Math.round(c.getBoundingClientRect().left));
			return { sameLeft: new Set(lefts).size === 1, hasDescText: !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-preset-desc'), firstCardTitle: cards[0]?.title || '' };
		});
		check('P1: preset cards stack in one column (same left edge)', layoutInfo.sameLeft, JSON.stringify(layoutInfo));
		check('P1: the description is not rendered as body text (only as the card tooltip)', !layoutInfo.hasDescText && layoutInfo.firstCardTitle.length > 0, JSON.stringify(layoutInfo));

		// Swatch strip (the palette strip under the name): every
		// card shows 7 swatches (accent-low/accent/accent-high + 4 grays), and the strip actually
		// differs between presets rather than 7 cards' worth of the same 7 colors.
		const swatchInfo = await page.evaluate(() => {
			const cards = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-preset-card'));
			return cards.map((c) => ({
				name: c.querySelector('.svc-preset-name')?.textContent,
				colors: Array.from(c.querySelectorAll('.svc-preset-swatch')).map((s) => getComputedStyle(s).backgroundColor),
			}));
		});
		check('every preset card shows a 7-swatch palette strip', swatchInfo.every((p) => p.colors.length === 7), JSON.stringify(swatchInfo.map((p) => p.colors.length)));
		const swatchesDiffer = swatchInfo.some((a, i) => swatchInfo.slice(i + 1).some((b) => a.colors.some((color, idx) => color !== b.colors[idx])));
		check('preset card swatch colors differ between at least two presets', swatchesDiffer, JSON.stringify(swatchInfo));

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-preset-cards.png') });

		const denseCard = await shadowQueryByText(page, '.svc-preset-card', 'Dense Technical');
		await realClick(page, denseCard);
		await page.waitForTimeout(300);
		const appliedPreset = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().preset);
		check('a real click on a preset card applies it', appliedPreset === 'dense-technical', appliedPreset);
		const selectedNow = await page.evaluate(() => {
			const card = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-preset-card')).find((c) => c.textContent.includes('Dense Technical'));
			return card?.classList.contains('svc-preset-active') && !!card.querySelector('.svc-preset-check');
		});
		check('the newly-applied preset card shows the selected treatment (border + check)', selectedNow);

		// After a preset apply, the accent hex field must show the NEW
		// resolved color (Dense Technical sets accent hue 199, a real hue change from the default).
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors', { scroll: false }));
		await page.waitForTimeout(200);
		const hexAfterPreset = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		const resolvedAfterPreset = await page.evaluate(() => {
			const probe = document.createElement('div');
			probe.style.color = 'var(--sl-color-accent)';
			document.body.appendChild(probe);
			const rgb = getComputedStyle(probe).color;
			probe.remove();
			return rgb;
		});
		check('the accent hex field shows a non-empty resolved color right after a preset apply', /^#[0-9a-f]{6}$/.test(hexAfterPreset), hexAfterPreset);

		// Back to a known baseline for later sections - and the hex field must refresh here too.
		await realClick(page, await lightQuery(page, "button[aria-label='Undo']"));
		await page.waitForTimeout(200);
		const hexAfterPresetUndo = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		check('the accent hex field shows the resolved color again after undoing a preset apply', /^#[0-9a-f]{6}$/.test(hexAfterPresetUndo) && hexAfterPresetUndo !== hexAfterPreset, `${hexAfterPresetUndo} vs ${hexAfterPreset}`);
	}

	// =============================================================================================
	// Hex fields refresh to the current resolved color after group reset,
	// reset all, and import too (undo/redo/preset apply are covered above).
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Colors', { scroll: false }));
		await page.waitForTimeout(200);
		const hexInput = await shadowQuery(page, "[data-control-id='color.accent.hue'] .svc-color-hex");
		await realClick(page, hexInput);
		await retypeFocused(page, '#22aa66');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(150);
		const hexAfterSet = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);

		// --- Group reset (real click on the Colors group's own reset button). ---
		await realClick(page, await shadowQuery(page, '.svc-reset-group'));
		await page.waitForTimeout(200);
		const hueAfterGroupReset = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().values['color.accent.hue']);
		const hexAfterGroupReset = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		check('group reset clears the accent override', hueAfterGroupReset === undefined, String(hueAfterGroupReset));
		check('the hex field shows the resolved default color right after a group reset', hexAfterGroupReset !== hexAfterSet && /^#[0-9a-f]{6}$/.test(hexAfterGroupReset), `${hexAfterGroupReset} vs ${hexAfterSet}`);
		await realClick(page, await lightQuery(page, "button[aria-label='Undo']"));
		await page.waitForTimeout(150);

		// --- Reset all (host.__svc.resetAll - studio mode has no visible button for this). ---
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.resetAll());
		await page.waitForTimeout(200);
		const hexAfterResetAll = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		check('the hex field shows the resolved default color right after Reset all', hexAfterResetAll === hexAfterGroupReset, `${hexAfterResetAll} vs ${hexAfterGroupReset}`);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);

		// --- Import (host.__svc.importState - one undo step, sets accent hue 30). ---
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({ preset: 'starlight-default', values: { 'color.accent.hue': 30, 'color.accent.chroma': 0.2 } }));
		await page.waitForTimeout(200);
		const hexAfterImport = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='color.accent.hue'] .svc-color-hex").value);
		check('the hex field shows the resolved color right after an import', /^#[0-9a-f]{6}$/.test(hexAfterImport) && hexAfterImport !== hexAfterResetAll, `${hexAfterImport} vs ${hexAfterResetAll}`);

		// Clean up back to defaults for whatever runs next against this server.
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.resetAll());
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// E3: the structure editor - toolbar reorder, drag-and-drop reorder, APPLY-THEME.md reflects it
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(250);

		const noteText = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-note')?.textContent);
		check('the structure editor shows the required note about APPLY-THEME.md', (noteText || '').includes('APPLY-THEME.md'), noteText);

		const rowsBefore = await page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')).map((r) => r.querySelector('.svc-structure-label').textContent));
		check('the structure tree renders at least 2 top-level rows', rowsBefore.length >= 2, JSON.stringify(rowsBefore));

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-structure-tree.png') });

		// --- Toolbar reorder: select the first row, click "Move down". ---
		const firstRow = await shadowQuery(page, '.svc-structure-row');
		await realClick(page, firstRow);
		await page.waitForTimeout(150);
		const firstLabel = rowsBefore[0];
		// Toolbar buttons carry no text (icon glyphs only) - select by title instead.
		const downBtn = await page.evaluateHandle(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-toolbar button[title="Move down"]'));
		await realClick(page, downBtn.asElement());
		await page.waitForTimeout(200);
		const rowsAfterToolbar = await page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')).map((r) => r.querySelector('.svc-structure-label').textContent));
		check('the "Move down" toolbar button reorders the selected row', rowsAfterToolbar[1] === firstLabel && rowsAfterToolbar[0] !== firstLabel, JSON.stringify({ before: rowsBefore, after: rowsAfterToolbar }));

		// --- Drag and drop: drag the (now second) row back above the first. `.svc-structure-row` sits
		// inside a `.svc-structure-node` wrapper per item, so `:nth-of-type` on the row class itself
		// isn't reliable across nested groups - select by flat DOM order instead. ---
		const rowAt = async (i) => {
			const handle = await page.evaluateHandle((idx) => document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')[idx], i);
			return handle.asElement();
		};
		const dragSrc = await rowAt(1); // the row we just moved to index 1
		const dragTarget = await rowAt(0);
		const finishDrag = await realDragTo(page, dragSrc, dragTarget, { toFraction: 0.15, pauseMs: 150 }); // top edge - "before"
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-structure-drag.png') });
		await finishDrag();
		await page.waitForTimeout(250);
		const rowsAfterDrag = await page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')).map((r) => r.querySelector('.svc-structure-label').textContent));
		check('a real mouse drag reorders the tree (top-edge drop = "before")', rowsAfterDrag[0] === firstLabel, JSON.stringify({ afterToolbar: rowsAfterToolbar, afterDrag: rowsAfterDrag }));

		// --- APPLY-THEME.md reflects the new order. ---
		await page.keyboard.press('Control+e');
		await page.waitForTimeout(250);
		const applyItem = await shadowQueryByText(page, '.svc-file-item', 'APPLY-THEME.md');
		await realClick(page, applyItem);
		await page.waitForTimeout(150);
		const applyContent = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector("textarea[aria-label='APPLY-THEME.md']")?.value || '');
		check('APPLY-THEME.md contains a sidebar replacement step', applyContent.includes('Replace the sidebar navigation'), applyContent.slice(0, 200));
		// `ia.js`'s round-trip omits a `label:` key when it equals `titleCase(lastSlugSegment(slug))` -
		// true for the "Getting Started"/slug 'guides/getting-started' fixture item, but no longer for
		// the other top-level item (slug 'specimen', display label "Style guide" since the rename),
		// whose label now DOES appear verbatim in the generated source. Either way the underlying
		// `slug:` VALUE always appears, so search for that instead of relying on label-omission.
		const slugsInNewOrder = await page.evaluate(() =>
			document.querySelector('sl-customizer').__svc.getState().ia.slice(0, 2).map((item) => item.slug)
		);
		const idxA = applyContent.indexOf(`slug: '${slugsInNewOrder[0]}'`);
		const idxB = applyContent.indexOf(`slug: '${slugsInNewOrder[1]}'`);
		check('APPLY-THEME.md lists the reordered items in the new order', idxA !== -1 && idxB !== -1 && idxA < idxB, `${slugsInNewOrder[0]}@${idxA}, ${slugsInNewOrder[1]}@${idxB}`);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// Structure edits must be their own undo step. Exact repro: apply a preset
	// (real click on the preset card), reorder in Structure (real pointer drag), Undo once - before
	// the fix, the reorder was never recorded at all, so Undo silently undid the PRESET instead and
	// jumped straight to 0 changes. Fixed: Undo once keeps the preset and restores the order; Undo
	// again reaches 0; Redo twice restores both; a following edit builds on the RESTORED structure.
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({})); // clean slate: values, preset AND ia all back to default
		await page.waitForTimeout(150);

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Presets', { scroll: false }));
		await page.waitForTimeout(150);
		const editorialCard = await shadowQueryByText(page, '.svc-preset-card', 'Editorial Serif');
		await realClick(page, editorialCard);
		await page.waitForTimeout(200);
		const countAfterPreset = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		check('applying the Editorial Serif preset changes several controls', countAfterPreset > 0, String(countAfterPreset));

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(200);
		const rowAtIdx = async (i) => (await page.evaluateHandle((idx) => document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')[idx], i)).asElement();
		const rowLabels = () => page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')).map((r) => r.querySelector('.svc-structure-label').textContent));
		const labelsBeforeDrag = await rowLabels();
		const dragSrc = await rowAtIdx(1);
		const dragDst = await rowAtIdx(0);
		const finishReproDrag = await realDragTo(page, dragSrc, dragDst, { toFraction: 0.1, pauseMs: 150 });
		await finishReproDrag();
		await page.waitForTimeout(250);
		const labelsAfterDrag = await rowLabels();
		check('the drag actually reordered the top-level tree', labelsAfterDrag[0] === labelsBeforeDrag[1] && labelsAfterDrag[1] === labelsBeforeDrag[0], JSON.stringify({ labelsBeforeDrag, labelsAfterDrag }));
		const countAfterDrag = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		check('the reorder itself counts as exactly one more change (ia materialized)', countAfterDrag === countAfterPreset + 1, `${countAfterPreset} -> ${countAfterDrag}`);

		// --- Undo once: the PRESET survives, the ORDER reverts (the exact bug). ---
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(200);
		const countAfterUndo1 = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		const labelsAfterUndo1 = await rowLabels();
		check('Undo once keeps the preset (change count == right after the preset, not 0)', countAfterUndo1 === countAfterPreset, `${countAfterPreset} vs ${countAfterUndo1}`);
		check('Undo once restores the pre-drag order', JSON.stringify(labelsAfterUndo1) === JSON.stringify(labelsBeforeDrag), JSON.stringify({ labelsBeforeDrag, labelsAfterUndo1 }));

		// --- The Structure editor's OWN internal state (tree/selection/form) resynced, not stale. ---
		const editorResync = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const rows = Array.from(host.shadowRoot.querySelectorAll('.svc-structure-row'));
			return { rowCount: rows.length, formPresent: !!host.shadowRoot.querySelector('.svc-structure-form-title') };
		});
		check('after Undo, the Structure tree still renders with rows and its "Selected item" form', editorResync.rowCount > 0 && editorResync.formPresent, JSON.stringify(editorResync));

		// --- Undo again: back to 0 changes (the preset itself reverts). ---
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(200);
		const countAfterUndo2 = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		check('Undo again returns to 0 changes from Starlight default', countAfterUndo2 === 0, String(countAfterUndo2));

		// --- Redo twice: both come back. ---
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.redo());
		await page.waitForTimeout(200);
		const countAfterRedo1 = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		check('Redo once restores the preset', countAfterRedo1 === countAfterPreset, `${countAfterPreset} vs ${countAfterRedo1}`);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.redo());
		await page.waitForTimeout(200);
		const countAfterRedo2 = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		const labelsAfterRedo2 = await rowLabels();
		check(
			'Redo again restores the reorder too',
			countAfterRedo2 === countAfterDrag && JSON.stringify(labelsAfterRedo2) === JSON.stringify(labelsAfterDrag),
			JSON.stringify({ countAfterDrag, countAfterRedo2, labelsAfterDrag, labelsAfterRedo2 })
		);

		// --- An edit after Undo builds on the RESTORED structure, not a stale one: undo once more
		// (back to preset-only/pre-drag order) then perform a NEW toolbar move - it must move the
		// RESTORED first row, and undoing it must land exactly back on that restored order. ---
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(200);
		const labelsBeforeNewMove = await rowLabels();
		const firstRowNow = await rowAtIdx(0);
		await realClick(page, firstRowNow);
		await page.waitForTimeout(120);
		const downBtnHandle = await page.evaluateHandle(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-toolbar button[title="Move down"]'));
		await realClick(page, downBtnHandle.asElement());
		await page.waitForTimeout(200);
		const labelsAfterNewMove = await rowLabels();
		check(
			'an edit after Undo builds on the restored structure (moves the RESTORED first row down)',
			labelsAfterNewMove[1] === labelsBeforeNewMove[0] && labelsAfterNewMove[0] === labelsBeforeNewMove[1],
			JSON.stringify({ labelsBeforeNewMove, labelsAfterNewMove })
		);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const labelsAfterMoveUndo = await rowLabels();
		check('undoing that new toolbar move restores it exactly (its own, separate step)', JSON.stringify(labelsAfterMoveUndo) === JSON.stringify(labelsBeforeNewMove), JSON.stringify({ labelsBeforeNewMove, labelsAfterMoveUndo }));

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({}));
		await page.waitForTimeout(150);
	}

	// --- a rename then Undo: the whole typing+blur gesture coalesces into ONE undo step. ---
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(200);
		// Baseline BEFORE the rename (not necessarily "nothing to undo" - the previous block's own
		// `importState({})` cleanup is itself one undo step) - the rename must add exactly one more,
		// not two, so undoing it once must return to exactly this same canUndo() reading.
		const canUndoBeforeRename = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		const firstRow = await shadowQuery(page, '.svc-structure-row');
		await realClick(page, firstRow);
		await page.waitForTimeout(120);
		const labelInput = await shadowQuery(page, '.svc-structure-form .svc-ia-label-input');
		const originalLabel = await page.evaluate((el) => el.value, labelInput);
		await realClick(page, labelInput);
		await page.keyboard.press('Control+A');
		await page.keyboard.type('Renamed Item', { delay: 15 });
		await page.waitForTimeout(100);
		const liveLabel = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-row.svc-structure-row-selected .svc-structure-label')?.textContent);
		check('typing into the "Selected item" label field updates the tree row live', liveLabel === 'Renamed Item', liveLabel);
		await page.keyboard.press('Tab'); // blur -> the `change` handler's own commit
		await page.waitForTimeout(150);
		const labelAfterBlur = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-form .svc-ia-label-input')?.value);
		check('blurring the field keeps the typed rename', labelAfterBlur === 'Renamed Item', labelAfterBlur);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const labelAfterUndo = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-form .svc-ia-label-input')?.value);
		const canUndoAfterOneUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('ONE Undo fully reverts a typed rename (typing + blur coalesced into one step)', labelAfterUndo === originalLabel, `${originalLabel} vs ${labelAfterUndo}`);
		check(
			'the rename added exactly ONE undo step (typing + blur did not split into two)',
			canUndoAfterOneUndo === canUndoBeforeRename,
			`before: ${canUndoBeforeRename}, after one undo: ${canUndoAfterOneUndo}`
		);
	}

	// --- the no-op guard specifically: a rename, a pause LONGER than history.js's 650ms coalescing
	// window, THEN a real click on the top-bar Undo button (which blurs the field, firing `change`) -
	// without panel.js's "unchanged ia" no-op guard this would record a second, redundant step (same
	// class of bug as the hex field's own blur-recommit bug, E1's repro above), so ONE Undo click
	// must still fully revert it. ---
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({}));
		await page.waitForTimeout(150);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(200);
		const canUndoBeforePausedRename = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		const firstRow = await shadowQuery(page, '.svc-structure-row');
		await realClick(page, firstRow);
		await page.waitForTimeout(120);
		const labelInput = await shadowQuery(page, '.svc-structure-form .svc-ia-label-input');
		const originalLabel = await page.evaluate((el) => el.value, labelInput);
		await realClick(page, labelInput);
		await page.keyboard.press('Control+A');
		await page.keyboard.type('Paused Rename', { delay: 15 });
		await page.waitForTimeout(800); // longer than history.js's 650ms coalesceMs
		await realClick(page, await lightQuery(page, "button[aria-label='Undo']")); // blurs the field -> `change` fires its own onIaChange call
		await page.waitForTimeout(150);
		const labelAfterRealUndoClick = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-form .svc-ia-label-input')?.value);
		const canUndoAfterRealUndoClick = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check(
			'a real Undo click after a long pause still fully reverts the rename (the no-op guard, not just coalescing timing, stops a second step)',
			labelAfterRealUndoClick === originalLabel,
			`${originalLabel} vs ${labelAfterRealUndoClick}`
		);
		check(
			'nothing more is left to undo (the paused blur did not record its own redundant step)',
			canUndoAfterRealUndoClick === canUndoBeforePausedRename,
			`before: ${canUndoBeforePausedRename}, after: ${canUndoAfterRealUndoClick}`
		);
	}

	// --- a toolbar action (Indent) then Undo. ---
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({}));
		await page.waitForTimeout(150);
		// Baseline right after the reset - `importState({})` is itself one undo step, so "nothing
		// left to undo" is never the right expectation here; the indent must add exactly one MORE.
		const canUndoAfterReset = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(200);
		const productRow = await shadowQueryByText(page, '.svc-structure-row', 'Product');
		await realClick(page, productRow);
		await page.waitForTimeout(120);
		const indentBtnHandle = await page.evaluateHandle(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-toolbar button[title="Indent into previous group"]'));
		const indentDisabled = await page.evaluate((btn) => btn.disabled, indentBtnHandle);
		check('the Indent button is enabled for "Product" (its previous top-level sibling is a group)', indentDisabled === false, String(indentDisabled));
		await realClick(page, indentBtnHandle.asElement());
		await page.waitForTimeout(200);
		const topLevelAfterIndent = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().ia.map((i) => i.label));
		check('Indent moves "Product" INTO the previous group (no longer top-level)', !topLevelAfterIndent.includes('Product'), JSON.stringify(topLevelAfterIndent));
		const canUndoAfterIndent = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('the indent recorded its own undo step', canUndoAfterIndent);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const iaAfterUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getState().ia);
		const stillTopLevel = Array.isArray(iaAfterUndo) ? iaAfterUndo.some((i) => i.label === 'Product') : true; // null ia (untouched) also means "still top-level" via the pristine fixture
		check('Undo restores "Product" to the top level', stillTopLevel, JSON.stringify(iaAfterUndo));
		const canUndoAfterIndentUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check(
			'the indent added exactly ONE undo step (undoing it returns to the post-reset baseline)',
			canUndoAfterIndentUndo === canUndoAfterReset,
			`after reset: ${canUndoAfterReset}, after indent+undo: ${canUndoAfterIndentUndo}`
		);
	}

	// --- a toolbar action (Delete) then Undo. ---
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({}));
		await page.waitForTimeout(150);
		const canUndoAfterReset = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(200);
		const gettingStartedRow = await shadowQueryByText(page, '.svc-structure-row', 'Getting Started');
		await realClick(page, gettingStartedRow);
		await page.waitForTimeout(120);
		const deleteBtnHandle = await page.evaluateHandle(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-toolbar button[title="Delete selected item"]'));
		await realClick(page, deleteBtnHandle.asElement());
		await page.waitForTimeout(200);
		const labelsAfterDelete = await page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')).map((r) => r.querySelector('.svc-structure-label').textContent));
		check('Delete removes the selected row', !labelsAfterDelete.includes('Getting Started'), JSON.stringify(labelsAfterDelete));
		const canUndoAfterDelete = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('the delete recorded its own undo step', canUndoAfterDelete);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.undo());
		await page.waitForTimeout(150);
		const labelsAfterDeleteUndo = await page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')).map((r) => r.querySelector('.svc-structure-label').textContent));
		check('Undo restores the deleted row', labelsAfterDeleteUndo.includes('Getting Started'), JSON.stringify(labelsAfterDeleteUndo));
		const canUndoAfterDeleteUndo = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check(
			'the delete added exactly ONE undo step (undoing it returns to the post-reset baseline)',
			canUndoAfterDeleteUndo === canUndoAfterReset,
			`after reset: ${canUndoAfterReset}, after delete+undo: ${canUndoAfterDeleteUndo}`
		);
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({}));
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// Sa: Structure drag feedback - a clear insertion marker mid-drag (before/after/into-group), and
	// Escape mid-drag cancels with no structure change and no history step.
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Navigation', { scroll: false }));
		await page.waitForTimeout(200);
		const rowAtIdx = async (i) => (await page.evaluateHandle((idx) => document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')[idx], i)).asElement();
		const rowLabels = () => page.evaluate(() => Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row')).map((r) => r.querySelector('.svc-structure-label').textContent));

		// A fresh, deterministic group (top-level, right after the first row) for the "into a group" check.
		const firstRow = await rowAtIdx(0);
		await realClick(page, firstRow);
		await page.waitForTimeout(100);
		const addGroupBtn = await shadowQueryByText(page, '.svc-structure-add-row .svc-btn', '+ Group');
		await realClick(page, addGroupBtn);
		await page.waitForTimeout(150);
		const newGroupRow = await rowAtIdx(1);
		const newGroupLabel = await page.evaluate((r) => r.querySelector('.svc-structure-label').textContent, newGroupRow);
		check('a fresh group was added for the drop-into-group check', newGroupLabel === 'New group', newGroupLabel);

		// --- (a) marker mid-drag: drag the first row onto the new group's MIDDLE ("inside"). ---
		const draggedRow = await rowAtIdx(0);
		const draggedLabelBefore = await page.evaluate((r) => r.querySelector('.svc-structure-label').textContent, draggedRow);
		let finishDrag = await realDragTo(page, draggedRow, newGroupRow, { toFraction: 0.5, pauseMs: 150 });
		const midDragInside = await page.evaluate(() => {
			const rows = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row'));
			const dragging = rows.find((r) => r.classList.contains('svc-structure-row-dragging'));
			const dropRow = rows.find((r) => r.dataset.drop);
			const cs = dropRow ? getComputedStyle(dropRow) : null;
			return { draggingVisible: !!dragging, dropPos: dropRow?.dataset.drop ?? null, outlineWidth: cs?.outlineWidth ?? null, bg: cs?.backgroundColor ?? null };
		});
		check('mid-drag, the dragged row dims (existing behavior)', midDragInside.draggingVisible);
		check('dragging over a group\'s middle shows an "inside" marker (outline + highlight)', midDragInside.dropPos === 'inside', JSON.stringify(midDragInside));
		check('the "inside" marker paints a visible outline', midDragInside.outlineWidth != null && parseFloat(midDragInside.outlineWidth) > 0, JSON.stringify(midDragInside));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-structure-drag-marker-inside.png') });
		await finishDrag();
		await page.waitForTimeout(250);
		const groupChildrenAfter = await page.evaluate((groupLabel) => {
			const ia = document.querySelector('sl-customizer').__svc.getState().ia;
			function find(items) {
				for (const it of items) {
					if (it.label === groupLabel) return it;
					if (it.type === 'group') {
						const f = find(it.items);
						if (f) return f;
					}
				}
				return null;
			}
			const grp = find(ia || []);
			return grp ? grp.items.map((i) => i.label) : null;
		}, 'New group');
		check('the drop landed INSIDE the group, exactly where the marker was shown', Array.isArray(groupChildrenAfter) && groupChildrenAfter.includes(draggedLabelBefore), JSON.stringify(groupChildrenAfter));

		// --- (b) marker mid-drag: drag a row toward another row's TOP edge ("before"), then complete it. ---
		const rowB2 = await rowAtIdx(1); // "Style guide", still nested inside "New group" at this point
		const rowB1 = await rowAtIdx(0); // "New group" - the drop target, still containing "Style guide"
		const labelB1 = await page.evaluate((r) => r.querySelector('.svc-structure-label').textContent, rowB1);
		const labelB2 = await page.evaluate((r) => r.querySelector('.svc-structure-label').textContent, rowB2);
		const targetTopBefore = (await rowB1.boundingBox()).y;
		finishDrag = await realDragTo(page, rowB2, rowB1, { toFraction: 0.1, pauseMs: 150 });
		const midDragBefore = await page.evaluate(() => {
			const rows = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row'));
			const dropRow = rows.find((r) => r.dataset.drop);
			const line = document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-drop-line');
			const lineCs = line ? getComputedStyle(line) : null;
			const lineRect = line ? line.getBoundingClientRect() : null;
			const dropRowRect = dropRow ? dropRow.getBoundingClientRect() : null;
			return {
				dropPos: dropRow?.dataset.drop ?? null,
				dropRowLabel: dropRow?.querySelector('.svc-structure-label')?.textContent ?? null,
				lineVisible: !!line && lineCs.display !== 'none',
				lineBg: lineCs?.backgroundColor ?? null,
				lineHeight: lineCs?.height ?? null,
				lineTop: lineRect?.top ?? null,
				dropRowTop: dropRowRect?.top ?? null,
			};
		});
		check('dragging toward a row\'s top edge shows a "before" insertion marker', midDragBefore.dropPos === 'before', JSON.stringify(midDragBefore));
		check('the "before" marker is shown on the actual hovered target row ("New group")', midDragBefore.dropRowLabel === labelB1, JSON.stringify({ midDragBefore, labelB1 }));
		check(
			'the "before" marker is a visible line (non-zero height, opaque color)',
			midDragBefore.lineVisible && midDragBefore.lineHeight && parseFloat(midDragBefore.lineHeight) > 0 && midDragBefore.lineBg && !midDragBefore.lineBg.includes('0, 0, 0, 0'),
			JSON.stringify(midDragBefore)
		);
		// Geometry, not just presence: the line must sit AT the target row's own top edge (within a
		// couple of px for the 3px line's own half-height/centering), not on some other row - proves
		// "marker at the right place", not just "a marker exists somewhere".
		check(
			'the "before" marker sits at the target row\'s own top edge',
			midDragBefore.lineTop != null && midDragBefore.dropRowTop != null && Math.abs(midDragBefore.lineTop - midDragBefore.dropRowTop) <= 3,
			JSON.stringify({ lineTop: midDragBefore.lineTop, dropRowTop: midDragBefore.dropRowTop, targetTopBefore })
		);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-structure-drag-marker-before.png') });
		await finishDrag();
		await page.waitForTimeout(250);
		const labelsAfterBefore = await rowLabels();
		check(
			'the drop landed where the "before" marker was shown (the dragged row now precedes the group)',
			labelsAfterBefore[0] === labelB2 && labelsAfterBefore[1] === labelB1,
			JSON.stringify({ labelB1, labelB2, labelsAfterBefore })
		);

		// --- (c) Escape mid-drag cancels: no reorder, no history step, marker removed. ---
		const labelsBeforeEscape = await rowLabels();
		const changeCountBeforeEscape = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		const canUndoBeforeEscape = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		const escSrc = await rowAtIdx(0);
		const escTarget = await rowAtIdx(1);
		const escFrom = await centerOf(escSrc);
		const escToBox = await escTarget.boundingBox();
		const escToX = escToBox.x + escToBox.width / 2;
		const escToY = escToBox.y + escToBox.height * 0.15;
		await page.mouse.move(escFrom.x, escFrom.y);
		await page.mouse.down();
		await page.mouse.move((escFrom.x + escToX) / 2, (escFrom.y + escToY) / 2, { steps: 6 });
		await page.mouse.move(escToX, escToY, { steps: 6 });
		await page.waitForTimeout(120);
		const markerPresentBeforeEscape = await page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-row[data-drop]'));
		check('a marker is present right before pressing Escape', markerPresentBeforeEscape);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(120);
		const stateAfterEscape = await page.evaluate(() => {
			const rows = Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-structure-row'));
			const line = document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-structure-drop-line');
			return { markerPresent: rows.some((r) => r.dataset.drop), lineVisible: !!line && getComputedStyle(line).display !== 'none', anyDragging: rows.some((r) => r.classList.contains('svc-structure-row-dragging')) };
		});
		check('Escape mid-drag removes the insertion marker (data-drop and the line)', stateAfterEscape.markerPresent === false && stateAfterEscape.lineVisible === false, JSON.stringify(stateAfterEscape));
		check('Escape mid-drag removes the dragged row\'s dim', stateAfterEscape.anyDragging === false, JSON.stringify(stateAfterEscape));
		await page.mouse.up(); // release - must be a no-op now that Escape already cancelled the drag
		await page.waitForTimeout(150);
		const labelsAfterEscape = await rowLabels();
		const changeCountAfterEscape = await page.evaluate(() => document.querySelector('sl-customizer').__svc.getChangeCount());
		const canUndoAfterEscape = await page.evaluate(() => document.querySelector('sl-customizer').__svc.canUndo());
		check('Escape mid-drag leaves the row order unchanged', JSON.stringify(labelsAfterEscape) === JSON.stringify(labelsBeforeEscape), JSON.stringify({ labelsBeforeEscape, labelsAfterEscape }));
		check('Escape mid-drag leaves the change count unchanged', changeCountAfterEscape === changeCountBeforeEscape, `${changeCountBeforeEscape} -> ${changeCountAfterEscape}`);
		check('Escape mid-drag records no history step (canUndo unchanged)', canUndoAfterEscape === canUndoBeforeEscape, `${canUndoBeforeEscape} -> ${canUndoAfterEscape}`);

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.importState({}));
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// E4: site title - live in the frame, survives navigation
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openGroup('Header', { scroll: false }));
		await page.waitForTimeout(200);
		await ensureSectionOpen(page, 'Site title');
		const titleInput = await waitForComputed(
			async () => shadowQuery(page, "[data-control-id='site.title'] input[type=text]"),
			(h) => h != null
		);
		await realClick(page, titleInput);
		await page.keyboard.type('Acme Docs', { delay: 15 });
		await page.waitForTimeout(150);

		const frame = await getFrame(page, 'light');
		const titleInFrame = await waitForComputed(
			() => frame.evaluate(() => document.querySelector('.site-title span')?.textContent?.trim()),
			(t) => t === 'Acme Docs'
		);
		check('the site title control changes the frame\'s .site-title text live', titleInFrame === 'Acme Docs', titleInFrame);

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-site-title.png') });

		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Document'));
		await page.waitForTimeout(600);
		const frameAfterNav = await getFrame(page, 'light');
		const titleAfterNav = await waitForComputed(
			() => frameAfterNav.evaluate(() => document.querySelector('.site-title span')?.textContent?.trim()),
			(t) => t === 'Acme Docs'
		);
		check('the site title survives navigating to another page', titleAfterNav === 'Acme Docs', titleAfterNav);

		// Clear it back so it doesn't bleed a fixed value into whatever runs next against this server.
		await realClick(page, await shadowQuery(page, "[data-control-id='site.title'] input[type=text]"));
		await page.keyboard.press('Control+A');
		await page.keyboard.press('Delete');
		await page.keyboard.press('Tab');
	}

	// =============================================================================================
	// Item 2: export dialog - "Download all (.zip)" - a real click triggers a download; unzip it in
	// Node (fflate) and assert the three files' text equals exactly what the dialog itself shows.
	// =============================================================================================
	{
		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openExport());
		await page.waitForTimeout(200);

		const dialogContents = await page.evaluate(() => {
			const root = document.querySelector('sl-customizer').shadowRoot;
			return {
				css: root.querySelector("textarea[aria-label='theme.css']").value,
				apply: root.querySelector("textarea[aria-label='APPLY-THEME.md']").value,
				json: root.querySelector("textarea[aria-label='state.json']").value,
			};
		});

		const zipBtn = await shadowQueryByText(page, '.svc-btn', 'Download all (.zip)');
		const zipDownloadEvent = page.waitForEvent('download', { timeout: 15000 });
		await realClick(page, zipBtn);
		const zipDownload = await zipDownloadEvent;
		check('the zip downloads as "untitled-theme.zip" (default theme name, slugified)', zipDownload.suggestedFilename() === 'untitled-theme.zip', zipDownload.suggestedFilename());

		const zipPath = await zipDownload.path();
		const unzipped = unzipSync(new Uint8Array(readFileSync(zipPath)));
		const zipEntryNames = Object.keys(unzipped).sort();
		check('the zip contains exactly theme.css, APPLY-THEME.md and starlight-theme.json', JSON.stringify(zipEntryNames) === JSON.stringify(['APPLY-THEME.md', 'starlight-theme.json', 'theme.css']), zipEntryNames.join(', '));
		check('theme.css inside the zip matches the dialog exactly', unzipped['theme.css'] && strFromU8(unzipped['theme.css']) === dialogContents.css);
		check('APPLY-THEME.md inside the zip matches the dialog exactly', unzipped['APPLY-THEME.md'] && strFromU8(unzipped['APPLY-THEME.md']) === dialogContents.apply);
		check('starlight-theme.json inside the zip matches the dialog exactly', unzipped['starlight-theme.json'] && strFromU8(unzipped['starlight-theme.json']) === dialogContents.json);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
	}

	// =============================================================================================
	// Item 3: export dialog - "Screenshot (PNG)" (Visible area / Full page) - captures the primary
	// preview lane's page at its natural width W, current mode, current theme. Style guide (specimen)
	// has real scrollable height (~3200px, vs. an ~681px viewport here) and a real fixed header, so
	// scroll it before the "Visible area" click to exercise the interesting (scrolled) case, not just
	// the trivial scrollY=0 one - Long doc (kitchen-sink) has the same properties but ~3x the DOM size,
	// which pushes a full-document DOM-to-image render well past a minute; Style guide keeps this
	// suite's own runtime sane while still testing the identical scroll/fixed-header code path.
	// =============================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-page-tab', 'Style guide'));
		await page.waitForTimeout(500);
		const frame = await getFrame(page, 'light');
		await frame.evaluate(() => window.scrollTo(0, 500));
		await page.waitForTimeout(200);

		const geo = await frame.evaluate(() => ({
			width: window.innerWidth,
			viewportHeight: window.innerHeight,
			fullHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
			scrollY: window.scrollY,
			headerHeight: Math.round(document.querySelector('header.header')?.getBoundingClientRect().height || 0),
		}));
		check('the frame is actually scrolled before the Visible-area capture (the interesting case)', geo.scrollY > 0, geo.scrollY);

		// A real Playwright screenshot of the SAME on-screen frame, taken BEFORE the export dialog
		// (whose backdrop covers the frame) opens - the reference this suite diffs "Visible area"
		// against, catching the class of bug dimension/not-blank checks alone cannot (a double-shifted
		// render can still be the right size and non-blank while showing the wrong content/missing
		// chrome entirely - exactly what a first pass of this feature shipped).
		const frameHandle = await page.$('iframe[data-svc-preview][data-svc-lane="light"]');
		const referenceBuffer = await frameHandle.screenshot();

		await page.evaluate(() => document.querySelector('sl-customizer').__svc.openExport());
		await page.waitForTimeout(200);

		/** @param {'visible'|'full'} kind @param {string} btnLabel @param {number} expectedHeight */
		async function captureAndVerify(kind, btnLabel, expectedHeight) {
			const btn = await shadowQueryByText(page, '.svc-btn', btnLabel);
			const downloadEvent = page.waitForEvent('download', { timeout: 60000 });
			await realClick(page, btn);
			const download = await downloadEvent;
			const filename = download.suggestedFilename();
			check(`"${btnLabel}" filename follows <theme>-<page>-<mode>-<width>.png`, /^untitled-theme-specimen-light-\d+\.png$/.test(filename), filename);

			const pngPath = await download.path();
			const savedPath = path.join(SCREENSHOTS_DIR, `c-export-shot-${kind}.png`);
			copyFileSync(pngPath, savedPath);

			const meta = await sharp(pngPath).metadata();
			check(`"${btnLabel}" PNG width equals the frame's natural width W (${geo.width})`, meta.width === geo.width, `${meta.width} vs ${geo.width}`);
			check(`"${btnLabel}" PNG height equals the expected height (${expectedHeight})`, Math.abs(meta.height - expectedHeight) <= 2, `${meta.height} vs ${expectedHeight}`);
			check(`"${btnLabel}" PNG signature is a real PNG`, meta.format === 'png', meta.format);

			const stats = await sharp(pngPath).stats();
			const spread = Math.max(...stats.channels.map((c) => c.max - c.min));
			check(`"${btnLabel}" PNG is not blank (real pixel variance across channels)`, spread > 10, spread);

			// A header with real (non-blank) pixels is present near the top - catches "chrome missing
			// entirely" even when the overall image is correctly sized and non-blank on average (the
			// content column alone can supply enough variance to pass the check above).
			if (geo.headerHeight > 0) {
				const headerRegion = await sharp(pngPath)
					.extract({ left: 0, top: 0, width: geo.width, height: Math.min(geo.headerHeight, meta.height) })
					.raw()
					.toBuffer({ resolveWithObject: true });
				let darkOrTinted = 0;
				const { data, info } = headerRegion;
				for (let i = 0; i < data.length; i += info.channels) {
					const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
					if (r < 250 || g < 250 || b < 250) darkOrTinted++; // not pure white - text, icons, or a tinted nav background
				}
				const pixelCount = info.width * info.height;
				check(`"${btnLabel}" PNG's header strip has real content (not a blank band)`, darkOrTinted / pixelCount > 0.02, `${darkOrTinted}/${pixelCount}`);
			}

			return pngPath;
		}

		const visiblePngPath = await captureAndVerify('visible', 'Visible area', geo.viewportHeight);
		await captureAndVerify('full', 'Full page', geo.fullHeight);

		// Diff "Visible area" against the real Playwright reference captured above - same dimensions
		// (both W x viewport height), so a direct per-pixel mean-absolute-difference is meaningful.
		{
			const refInfo = await sharp(referenceBuffer)
				.resize(geo.width, geo.viewportHeight, { fit: 'fill' })
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			const shotInfo = await sharp(visiblePngPath)
				.resize(geo.width, geo.viewportHeight, { fit: 'fill' })
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			let sum = 0;
			const n = Math.min(refInfo.data.length, shotInfo.data.length);
			for (let i = 0; i < n; i++) sum += Math.abs(refInfo.data[i] - shotInfo.data[i]);
			const meanAbsDiff = sum / n;
			console.log(`"Visible area" vs a real Playwright frame screenshot: mean abs pixel diff ${meanAbsDiff.toFixed(2)} (0-255 scale)`);
			check('"Visible area" PNG is visually close to a real screenshot of the same frame (mean abs diff < 40/255)', meanAbsDiff < 40, meanAbsDiff.toFixed(2));
		}

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
	}

	console.log(`\n${errors.length} browser console/page errors observed.`);
	for (const e of errors.slice(0, 10)) console.log(e);

	await browser.close();

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
