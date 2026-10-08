// @ts-check
/**
 * @file Export dialog e2e suite. The dialog opens from the studio's Export, Screenshot and Share
 * buttons, and from the overlay panel's Export button. This suite checks that:
 * - each of the five outcomes takes one click: the agent message on the clipboard, the zip, the
 *   settings file, the share link and the PNG;
 * - every file tab downloads its own file, by name and content, including the agent message as a
 *   `.md` file, and its Copy icon copies the same text;
 * - the zip holds one folder with theme.css and APPLY-THEME.md, and nothing else;
 * - the small screenshot renders on open, opens the Screenshot tab, and renders again after a theme
 *   change;
 * - a status replaces the line of the action it confirms, and the previous line returns;
 * - focus, Escape, Tab and the arrow keys behave as in any modal dialog;
 * - a dark capture leaves the preview's mode, the stored `starlight-theme` and the toolbar as they were,
 *   and Split view captures from its dark lane without switching anything;
 * - a page switch during a capture of a long page does not hold up the next page's picture;
 * - a lazy image that has never loaded does not hold up a capture, and keeps its attribute;
 * - a downloaded settings file imports back to the same theme;
 * - a theme name shows as text, never as markup;
 * - the dialog fits a phone-width window, and the overlay panel's dialog works without the small
 *   screenshot.
 *
 * Every expected file comes from `core/export-files.js`, run here in Node on the studio's own state,
 * so the dialog must show and download exactly what the core module builds.
 *
 * Needs a running server; start one first: `npm run build` then `npm run preview:bg`.
 *   node tests/e2e/export.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420; under a sub-path build, the full origin
 * plus base path), SVC_CHROME_PATH. Chromium only: the clipboard checks need both clipboard
 * permissions, and only Chromium grants both.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

import { launchBrowser, chromiumOnly } from './browser.mjs';
import { buildExportFiles } from '../../src/customizer/core/export-files.js';
import { tryDecodeState, sameTheme } from '../../src/customizer/core/state.js';
import { SHARE_HASH_PREFIX } from '../../src/customizer/core/share-link.js';

chromiumOnly('export.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = (process.env.SVC_BASE_URL || 'http://localhost:4420').replace(/\/$/, '');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPORT_BTN = 'button.svc-tb-btn-primary[aria-label="Export"]';
const OPTIONS_BTN = '.svc-xp-link[aria-controls="svc-xp-shotopts"]';
const TAB_NAMES = { message: 'Agent message', css: 'Stylesheet', apply: 'Setup steps', settings: 'Settings file' };

let failures = 0;
function check(name, cond, note = '') {
	if (cond) console.log(`PASS - ${name}`);
	else {
		failures++;
		console.log(`FAIL - ${name}${note ? ` (${note})` : ''}`);
	}
}

/** @param {import('playwright-core').ElementHandle|null} handle */
async function centerOf(handle) {
	if (!handle) throw new Error('centerOf: null element handle (selector matched nothing)');
	await handle.scrollIntoViewIfNeeded();
	const box = await handle.boundingBox();
	if (!box) throw new Error('centerOf: the element has no box (is it hidden?)');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real mouse click at the element's center. */
async function realClick(page, handle) {
	const { x, y } = await centerOf(handle);
	await page.mouse.click(x, y);
}

/** An element inside the customizer's shadow root. */
async function shadowQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector('sl-customizer')?.shadowRoot?.querySelector(sel) ?? null, selector);
	return handle.asElement();
}

/** An element inside the customizer's shadow root whose text includes `text`. */
async function shadowQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelector('sl-customizer')?.shadowRoot?.querySelectorAll(selector) ?? []).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
}

/** Clicks an element in the shadow root, then lets the dialog repaint. */
async function clickIn(page, selector) {
	await realClick(page, await shadowQuery(page, selector));
	await page.waitForTimeout(150);
}

/** Clicks an element in the studio's own page (the top bar), then lets the page repaint. */
async function clickPage(page, selector) {
	await realClick(page, await page.$(selector));
	await page.waitForTimeout(200);
}

async function readClipboard(page) {
	const text = await page.evaluate(() => navigator.clipboard.readText());
	return text.replace(/\r\n/g, '\n');
}

/** Arms the download listener, clicks, and returns the file's suggested name and bytes. */
async function downloadVia(page, selector, timeout = 30000) {
	const event = page.waitForEvent('download', { timeout });
	await clickIn(page, selector);
	const download = await event;
	const file = await download.path();
	return { name: download.suggestedFilename(), bytes: readFileSync(/** @type {string} */ (file)) };
}

/** What the dialog shows right now: open or not, its title, the selected tab, focus and the live region. */
async function dialogState(page) {
	return page.evaluate(() => {
		const root = /** @type {ShadowRoot} */ (document.querySelector('sl-customizer')?.shadowRoot);
		const backdrop = /** @type {HTMLElement|null} */ (root.querySelector('.svc-xp-backdrop'));
		const active = /** @type {HTMLElement|null} */ (root.activeElement);
		const selected = /** @type {HTMLElement|null} */ (root.querySelector('.svc-xp-tab[aria-selected="true"]'));
		return {
			open: !!backdrop && !backdrop.hidden,
			title: root.querySelector('#svc-xp-title')?.textContent ?? '',
			sub: root.querySelector('.svc-xp-sub')?.textContent ?? '',
			focus: active ? active.dataset.export || active.id || String(active.className) : '',
			inDialog: !!active?.closest('.svc-xp'),
			tab: selected?.dataset.file ?? '',
			live: root.querySelector('.svc-xp [role="status"]')?.textContent ?? '',
		};
	});
}

/** The line under an action, which a status replaces for a while. */
async function lineOf(page, kind) {
	return page.evaluate((kind) => {
		const root = /** @type {ShadowRoot} */ (document.querySelector('sl-customizer')?.shadowRoot);
		if (kind === 'png') return root.querySelector('.svc-xp-pngline')?.textContent ?? null;
		const btn = root.querySelector(`.svc-xp [data-export="${kind}"]`);
		return btn?.closest('.svc-xp-way, .svc-xp-opt')?.querySelector('.svc-xp-line')?.textContent ?? null;
	}, kind);
}

async function thumbSrc(page) {
	return page.evaluate(() => document.querySelector('sl-customizer')?.shadowRoot?.querySelector('.svc-xp-thumb-pic img')?.getAttribute('src') ?? null);
}

/** Waits for a small screenshot other than `notSrc`. Resolves to false on a timeout. */
async function waitForThumb(page, notSrc = null, timeout = 30000) {
	return page
		.waitForFunction(
			(notSrc) => {
				const src = document.querySelector('sl-customizer')?.shadowRoot?.querySelector('.svc-xp-thumb-pic img')?.getAttribute('src');
				return !!src && src !== notSrc;
			},
			notSrc,
			{ timeout }
		)
		.then(
			() => true,
			() => false
		);
}

/** The preview's mode as the stored setting, the frames and the toolbar's mode buttons report it. */
async function modeState(page) {
	return page.evaluate(() => {
		const themeOf = (lane) => /** @type {HTMLIFrameElement|null} */ (document.querySelector(`iframe[data-svc-preview][data-svc-lane="${lane}"]`))?.contentDocument?.documentElement.dataset.theme ?? null;
		const pressed = Array.from(document.querySelectorAll('.svc-seg-btn[aria-pressed="true"]'))
			.map((b) => b.textContent.trim())
			.filter((t) => ['Light', 'Dark', 'Split'].includes(t));
		return { stored: localStorage.getItem('starlight-theme'), light: themeOf('light'), dark: themeOf('dark'), toolbar: pressed.join(',') };
	});
}

async function getState(page) {
	return page.evaluate(() => /** @type {any} */ (document.querySelector('sl-customizer')).__svc.getState());
}

/** The theme the panel saved, for the overlay panel, which has no `__svc`. */
async function savedState(page) {
	const stored = await page.evaluate(() => localStorage.getItem('svc-state'));
	return stored ? tryDecodeState(stored) : null;
}

/** Types a theme name into the top bar's name field, as a person would. */
async function typeThemeName(page, name) {
	await clickPage(page, '#svc-theme-name');
	await page.keyboard.press('Control+A');
	await page.keyboard.type(name);
	await page.keyboard.press('Tab');
	await page.waitForTimeout(300);
}

/** The studio opens the Presets group from its rail first; the overlay panel shows the cards as they are. */
async function pickPreset(page, label) {
	const rail = await shadowQuery(page, '.svc-rail-item[data-group="Presets"]');
	if (rail) {
		await realClick(page, rail);
		await page.waitForTimeout(200);
	}
	await realClick(page, await shadowQueryByText(page, '.svc-preset-card', label));
	await page.waitForTimeout(1200);
}

async function closeDialog(page) {
	await page.keyboard.press('Escape');
	await page.waitForTimeout(200);
}

/** Every section, in order. `main` closes the browser afterwards, even after a crash.
 * @param {import('playwright-core').Browser} browser */
async function run(browser) {
	/** @type {string[]} */
	const errors = [];
	const trackErrors = (p) => {
		p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
		p.on('console', (m) => {
			if (m.type() === 'error') errors.push(`console: ${m.text()}`);
		});
	};
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true });
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SVC_BASE_URL).origin });
	const page = await context.newPage();
	trackErrors(page);
	await page.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
	await page.waitForFunction(() => !!document.querySelector('sl-customizer')?.shadowRoot?.querySelector('.svc-group'), undefined, { timeout: 30000 });
	await page.waitForTimeout(600);

	// =============================================================================================
	// 0. A named theme on a preset, and what the core module builds for it.
	// =============================================================================================
	await pickPreset(page, 'Editorial Serif');
	await typeThemeName(page, 'Acme Docs');
	const state = await getState(page);
	const expected = buildExportFiles(state);
	check(
		'0. the core module names the files after the theme',
		expected.names.zip === 'acme-docs.zip' && expected.names.message === 'acme-docs.agent-message.md' && expected.names.settings === 'acme-docs.customizer.json',
		JSON.stringify(expected.names)
	);

	// =============================================================================================
	// 1. Export opens the dialog on the agent message, and the small screenshot follows.
	// =============================================================================================
	const openedAt = Date.now();
	await clickPage(page, EXPORT_BTN);
	let d = await dialogState(page);
	check('1. Export opens the dialog, titled with the theme name', d.open && d.title === 'Export “Acme Docs”', d.title);
	check('1. the subtitle names the preset and the change count', /^Editorial Serif · \d+ changes?$/.test(d.sub), d.sub);
	check('1. focus starts on "Copy for your coding agent", and the Agent message tab shows', d.focus === 'agent' && d.tab === 'message', JSON.stringify(d));
	const firstThumb = await waitForThumb(page);
	const firstThumbMs = Date.now() - openedAt;
	check('1. the small screenshot shows within 15 seconds of opening', firstThumb && firstThumbMs < 15000, `${firstThumbMs} ms`);
	await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'export-dialog-1440.png') });

	// =============================================================================================
	// 2. Every file tab shows the core module's text, under the file's own name.
	// =============================================================================================
	const shown = await page.evaluate(() => {
		const root = /** @type {ShadowRoot} */ (document.querySelector('sl-customizer')?.shadowRoot);
		/** @type {Record<string, {text: string, name: string}>} */
		const out = {};
		for (const id of ['message', 'css', 'apply', 'settings']) {
			const panel = root.querySelector(`#svc-xp-panel-${id}`);
			out[id] = { text: panel?.querySelector('pre.svc-xp-pre')?.textContent ?? '', name: panel?.querySelector('.svc-xp-fname')?.textContent ?? '' };
		}
		return out;
	});
	for (const id of ['message', 'css', 'apply', 'settings']) {
		check(`2. the ${TAB_NAMES[id]} tab shows ${expected.names[id]} with the core module's text`, shown[id].text === expected[id] && shown[id].name === expected.names[id], shown[id].name);
	}

	// =============================================================================================
	// 3. The five outcomes, one click each, and the line that confirms each one.
	// =============================================================================================
	await clickIn(page, '.svc-xp-go[data-export="agent"]');
	await page.waitForTimeout(250);
	const agentClip = await readClipboard(page);
	check('3. "Copy for your coding agent" puts the agent message on the clipboard', agentClip === expected.message, `${agentClip.length} characters`);
	const agentLine = await lineOf(page, 'agent');
	d = await dialogState(page);
	check('3. the agent line turns into the confirmation, and the live region says it', !!agentLine?.startsWith('Copied. Paste it') && d.live === agentLine, String(agentLine));

	const zip = await downloadVia(page, '.svc-xp-go[data-export="files"]');
	const entries = unzipSync(new Uint8Array(zip.bytes));
	const entryNames = Object.keys(entries).sort();
	check('3. "Download the files (.zip)" downloads acme-docs.zip', zip.name === 'acme-docs.zip', zip.name);
	check('3. the zip holds one folder with APPLY-THEME.md and theme.css, and nothing else', JSON.stringify(entryNames) === JSON.stringify(['acme-docs/APPLY-THEME.md', 'acme-docs/theme.css']), entryNames.join(', '));
	check(
		'3. the zipped files match the core module exactly',
		!!entries['acme-docs/theme.css'] && strFromU8(entries['acme-docs/theme.css']) === expected.css && !!entries['acme-docs/APPLY-THEME.md'] && strFromU8(entries['acme-docs/APPLY-THEME.md']) === expected.apply
	);
	check('3. a new status puts the agent line back to its resting text', (await lineOf(page, 'agent')) === 'Paste one message into Claude Code, Codex or Cursor.', String(await lineOf(page, 'agent')));

	const settings = await downloadVia(page, '.svc-xp-quiet[data-export="settings"]');
	check('3. "Download settings file" downloads acme-docs.customizer.json with the core module\'s text', settings.name === 'acme-docs.customizer.json' && settings.bytes.toString('utf8') === expected.settings, settings.name);
	check('3. the settings line confirms the download and names Import', !!(await lineOf(page, 'settings'))?.startsWith('Download started. Open it with Import'), String(await lineOf(page, 'settings')));

	await clickIn(page, '.svc-xp-quiet[data-export="link"]');
	await page.waitForTimeout(250);
	const link = await readClipboard(page);
	const hashAt = link.indexOf(SHARE_HASH_PREFIX);
	const linked = hashAt >= 0 ? tryDecodeState(link.slice(hashAt + SHARE_HASH_PREFIX.length)) : null;
	check('3. "Copy share link" copies a studio link that opens this same theme', link.startsWith(`${SVC_BASE_URL}/studio/`) && !!linked && sameTheme(linked, state), link.slice(0, 90));
	check('3. the link line confirms the copy', (await lineOf(page, 'link')) === 'Copied. Send the link to anyone.', String(await lineOf(page, 'link')));

	const png = await downloadVia(page, '.svc-xp-quiet[data-export="png"]', 60000);
	await page.waitForTimeout(200);
	check('3. "Download PNG" downloads a light PNG named <theme>-<page>-<mode>-<width>.png', /^acme-docs-[a-z0-9-]+-light-\d+\.png$/.test(png.name) && png.bytes.subarray(0, 8).equals(PNG_SIGNATURE), png.name);
	check('3. the screenshot line confirms the download', (await lineOf(page, 'png')) === 'Download started.', String(await lineOf(page, 'png')));

	// =============================================================================================
	// 4. One file at a time: each tab's Download and Copy.
	// =============================================================================================
	for (const id of ['message', 'css', 'apply', 'settings']) {
		await clickIn(page, `#svc-xp-tab-${id}`);
		const file = await downloadVia(page, `#svc-xp-panel-${id} .svc-xp-dl`);
		check(`4. the ${TAB_NAMES[id]} tab downloads ${expected.names[id]} with the same text`, file.name === expected.names[id] && file.bytes.toString('utf8') === expected[id], file.name);
		await clickIn(page, `#svc-xp-panel-${id} .svc-xp-tool`);
		await page.waitForTimeout(250);
		const clip = await readClipboard(page);
		check(`4. the ${TAB_NAMES[id]} tab's Copy icon copies the same text`, clip === expected[id], `${clip.length} characters`);
	}
	await clickIn(page, '#svc-xp-tab-png');
	const tabPng = await downloadVia(page, '#svc-xp-panel-png .svc-xp-dl', 60000);
	check('4. the Screenshot tab downloads the PNG', /^acme-docs-[a-z0-9-]+-light-\d+\.png$/.test(tabPng.name) && tabPng.bytes.subarray(0, 8).equals(PNG_SIGNATURE), tabPng.name);
	check('4. the Screenshot tab has Download and no Copy', await page.evaluate(() => !document.querySelector('sl-customizer')?.shadowRoot?.querySelector('#svc-xp-panel-png .svc-xp-tool')));

	// =============================================================================================
	// 5. The small screenshot opens the Screenshot tab.
	// =============================================================================================
	await clickIn(page, '#svc-xp-tab-message');
	await clickIn(page, '.svc-xp-thumb');
	d = await dialogState(page);
	const tabHasPicture = await page.evaluate(() => !!document.querySelector('sl-customizer')?.shadowRoot?.querySelector('#svc-xp-panel-png .svc-xp-img img'));
	check('5. clicking the small screenshot shows the Screenshot tab with the picture', d.tab === 'png' && tabHasPicture, d.tab);

	// =============================================================================================
	// 6. The keyboard: Escape, Tab, and the arrow keys in the tabs and the radio groups.
	// =============================================================================================
	await closeDialog(page);
	d = await dialogState(page);
	const focusAfterEscape = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
	check('6. Escape closes the dialog and focus returns to Export', !d.open && focusAfterEscape === 'Export', focusAfterEscape);

	await clickPage(page, EXPORT_BTN);
	for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
	d = await dialogState(page);
	check('6. forty presses of Tab keep focus inside the dialog', d.inDialog, d.focus);
	for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+Tab');
	d = await dialogState(page);
	check('6. forty presses of Shift+Tab keep focus inside the dialog', d.inDialog, d.focus);

	await clickIn(page, '#svc-xp-tab-message');
	await page.keyboard.press('ArrowLeft');
	d = await dialogState(page);
	check('6. ArrowLeft on the first tab wraps to Screenshot, selects it and keeps focus there', d.tab === 'png' && d.focus === 'svc-xp-tab-png', JSON.stringify(d));
	await page.keyboard.press('Home');
	d = await dialogState(page);
	check('6. Home selects the first tab', d.tab === 'message' && d.focus === 'svc-xp-tab-message', JSON.stringify(d));
	await page.keyboard.press('End');
	d = await dialogState(page);
	check('6. End selects the last tab', d.tab === 'png' && d.focus === 'svc-xp-tab-png', JSON.stringify(d));

	await clickIn(page, OPTIONS_BTN);
	await clickIn(page, '.svc-export-shot-visible-btn');
	await page.keyboard.press('ArrowRight');
	const areaChecked = await page.evaluate(() => document.querySelector('sl-customizer')?.shadowRoot?.querySelector('.svc-export-shot-full-btn')?.getAttribute('aria-checked'));
	d = await dialogState(page);
	check('6. ArrowRight in the page-area choice selects "Full page" and moves focus to it', areaChecked === 'true' && d.focus.includes('svc-export-shot-full-btn'), `${areaChecked} ${d.focus}`);
	await closeDialog(page);

	// =============================================================================================
	// 7. The top bar's Screenshot and Share open the same dialog at their own exports.
	// =============================================================================================
	await clickPage(page, '#svc-screenshot-btn');
	d = await dialogState(page);
	check('7. Screenshot opens the dialog on the Screenshot tab, with focus on Download PNG', d.open && d.tab === 'png' && d.focus === 'png', JSON.stringify(d));
	await closeDialog(page);
	check('7. Escape returns focus to Screenshot', (await page.evaluate(() => document.activeElement?.id)) === 'svc-screenshot-btn');
	await clickPage(page, '#svc-share-btn');
	d = await dialogState(page);
	check('7. Share opens the dialog on the Settings file tab, with focus on Copy share link', d.open && d.tab === 'settings' && d.focus === 'link', JSON.stringify(d));
	await closeDialog(page);

	// =============================================================================================
	// 8. A dark picture of a light preview: the preview, its stored mode and the toolbar stay light.
	// =============================================================================================
	const modeBefore = await modeState(page);
	await clickPage(page, EXPORT_BTN);
	await waitForThumb(page);
	const lightThumb = await thumbSrc(page);
	await clickIn(page, OPTIONS_BTN);
	await clickIn(page, '.svc-xp-seg [data-value="dark"]');
	const darkThumb = await waitForThumb(page, lightThumb);
	const modeAfterThumb = await modeState(page);
	check('8. choosing Dark renders a dark small screenshot', darkThumb);
	check('8. after the dark small screenshot, the preview, its stored mode and the toolbar are unchanged', modeBefore.light === 'light' && JSON.stringify(modeAfterThumb) === JSON.stringify(modeBefore), `${JSON.stringify(modeBefore)} -> ${JSON.stringify(modeAfterThumb)}`);
	await clickIn(page, OPTIONS_BTN);
	check('8. with the options folded, the screenshot line still says "Dark, visible area."', (await lineOf(page, 'png')) === 'Dark, visible area.', String(await lineOf(page, 'png')));
	const darkPng = await downloadVia(page, '.svc-xp-quiet[data-export="png"]', 60000);
	check('8. Download PNG with Dark chosen downloads a dark PNG', /^acme-docs-[a-z0-9-]+-dark-\d+\.png$/.test(darkPng.name) && darkPng.bytes.subarray(0, 8).equals(PNG_SIGNATURE), darkPng.name);
	await closeDialog(page);
	const modeAfterPng = await modeState(page);
	check('8. after the dark PNG, the preview, its stored mode and the toolbar are unchanged', JSON.stringify(modeAfterPng) === JSON.stringify(modeBefore), `${JSON.stringify(modeBefore)} -> ${JSON.stringify(modeAfterPng)}`);

	// =============================================================================================
	// 9. Split view: a dark picture comes from the dark lane, and nothing switches.
	// =============================================================================================
	{
		await realClick(page, await page.evaluateHandle(() => Array.from(document.querySelectorAll('.svc-seg-btn')).find((b) => b.textContent.trim() === 'Split') ?? null).then((h) => h.asElement()));
		await page.waitForTimeout(600);
		const splitBefore = await modeState(page);
		const darkLaneWidth = await page.evaluate(() => Math.round(/** @type {HTMLIFrameElement|null} */ (document.querySelector('iframe[data-svc-preview][data-svc-lane="dark"]'))?.contentWindow?.innerWidth ?? 0));
		await clickPage(page, EXPORT_BTN);
		await clickIn(page, OPTIONS_BTN);
		await clickIn(page, '.svc-xp-seg [data-value="dark"]');
		const splitPng = await downloadVia(page, '.svc-xp-quiet[data-export="png"]', 60000);
		await closeDialog(page);
		const splitAfter = await modeState(page);
		check('9. in Split view, the dark PNG comes from the dark lane, at its width', splitBefore.dark === 'dark' && splitPng.name.endsWith(`-dark-${darkLaneWidth}.png`), `${splitPng.name}, dark lane ${darkLaneWidth}px`);
		check('9. in Split view, both lanes, the stored mode and the toolbar are unchanged', JSON.stringify(splitAfter) === JSON.stringify(splitBefore), `${JSON.stringify(splitBefore)} -> ${JSON.stringify(splitAfter)}`);
		await realClick(page, await page.evaluateHandle(() => Array.from(document.querySelectorAll('.svc-seg-btn')).find((b) => b.textContent.trim() === 'Light') ?? null).then((h) => h.asElement()));
		await page.waitForTimeout(600);
	}

	// =============================================================================================
	// 10. The small screenshot follows the theme, and the settings file imports back.
	// =============================================================================================
	{
		await clickPage(page, EXPORT_BTN);
		await waitForThumb(page);
		const before = { src: await thumbSrc(page), css: shown.css };
		await closeDialog(page);
		await pickPreset(page, 'High Contrast Mono');
		const reopenedAt = Date.now();
		await clickPage(page, EXPORT_BTN);
		const fresh = await waitForThumb(page, before.src);
		const refreshMs = Date.now() - reopenedAt;
		const cssNow = await page.evaluate(() => document.querySelector('sl-customizer')?.shadowRoot?.querySelector('pre.svc-xp-pre[data-file="css"]')?.textContent ?? '');
		check('10. after a preset change, the dialog shows the new CSS and renders a new small screenshot', fresh && cssNow !== before.css, `${refreshMs} ms`);
		await closeDialog(page);

		const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
		await clickPage(page, 'button.svc-tb-btn[aria-label="Import"]');
		await (await chooser).setFiles({ name: settings.name, mimeType: 'application/json', buffer: settings.bytes });
		await page.waitForTimeout(800);
		check('10. importing the downloaded settings file brings back the same theme', sameTheme(await getState(page), state));
	}

	// =============================================================================================
	// 11. A theme name is text in the dialog, never markup.
	// =============================================================================================
	{
		const hostileName = '<img src=x onerror="window.__svcExportXss=1">';
		await typeThemeName(page, hostileName);
		await clickPage(page, EXPORT_BTN);
		const title = await page.evaluate(() => {
			const el = document.querySelector('sl-customizer')?.shadowRoot?.querySelector('#svc-xp-title');
			return { text: el?.textContent ?? '', hasImg: !!el?.querySelector('img'), ran: /** @type {any} */ (window).__svcExportXss === 1 };
		});
		check('11. a theme name with markup shows as text in the title', title.text === `Export “${hostileName}”` && !title.hasImg && !title.ran, JSON.stringify(title));
		await closeDialog(page);
		await typeThemeName(page, 'Acme Docs');
	}

	// =============================================================================================
	// 12. At phone width, the dialog stacks and fits the window.
	// =============================================================================================
	{
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(500);
		await clickPage(page, EXPORT_BTN);
		const fit = await page.evaluate(() => {
			const root = /** @type {ShadowRoot} */ (document.querySelector('sl-customizer')?.shadowRoot);
			const box = (sel) => root.querySelector(sel)?.getBoundingClientRect();
			const dialog = box('.svc-xp');
			const main = box('.svc-xp-main');
			const other = box('.svc-xp-other');
			const view = box('.svc-xp-view');
			const body = root.querySelector('.svc-xp-body');
			return {
				inside: !!dialog && dialog.left >= 0 && dialog.right <= window.innerWidth + 0.5,
				noSideScroll: !!body && body.scrollWidth <= body.clientWidth + 1,
				stacked: !!main && !!other && !!view && main.bottom <= other.top + 1 && other.bottom <= view.top + 1,
			};
		});
		check('12. at 390px the dialog fits the window with no sideways scroll', fit.inside && fit.noSideScroll, JSON.stringify(fit));
		check('12. at 390px the two ways, the other exports and the files stack in that order', fit.stacked, JSON.stringify(fit));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'export-dialog-390.png') });
		await closeDialog(page);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.waitForTimeout(300);
	}

	// =============================================================================================
	// 13. A page switch while a picture of a long page renders: the next page's picture still comes.
	//     A capture of an unloaded page never finishes, so the dialog must give it up, or every later
	//     capture waits behind it.
	// =============================================================================================
	{
		const pageTab = async (label) => (await page.evaluateHandle((l) => Array.from(document.querySelectorAll('.svc-page-tab')).find((t) => t.textContent.includes(l)) ?? null, label)).asElement();
		await realClick(page, await pageTab('Document'));
		await page.waitForTimeout(800);
		await clickPage(page, EXPORT_BTN);
		// The Document page's picture takes about 3 seconds, so it is still rendering at the switch.
		await page.waitForTimeout(300);
		await closeDialog(page);
		await realClick(page, await pageTab('Style guide'));
		await page.waitForTimeout(800);
		// A new scroll position means a new picture, so no earlier picture can pass this check.
		const frame = await (await page.$('iframe[data-svc-preview][data-svc-lane="light"]'))?.contentFrame();
		await frame?.evaluate(() => window.scrollTo(0, 300));
		await page.waitForTimeout(200);
		const switchedAt = Date.now();
		await clickPage(page, EXPORT_BTN);
		const fresh = await waitForThumb(page, null, 20000);
		check("13. after a page switch interrupts a long page's picture, the next page's picture shows within 20 seconds", fresh, `${Date.now() - switchedAt} ms`);
		await closeDialog(page);

		// The Document page has a lazy image below the fold that never loads on its own. A capture
		// used to wait 30 seconds for it; it now loads the image first and puts the attribute back.
		await realClick(page, await pageTab('Document'));
		await page.waitForTimeout(800);
		const docFrame = await (await page.$('iframe[data-svc-preview][data-svc-lane="light"]'))?.contentFrame();
		const lazyBefore = await docFrame?.evaluate(() => Array.from(document.querySelectorAll('img[loading="lazy"]')).filter((img) => !img.complete).length);
		const attrsBefore = await docFrame?.evaluate(() => Array.from(document.querySelectorAll('img')).map((img) => img.getAttribute('loading')));
		const openedOnDocument = Date.now();
		await clickPage(page, EXPORT_BTN);
		const docPicture = await waitForThumb(page, null, 20000);
		const docMs = Date.now() - openedOnDocument;
		const lazyAfter = await docFrame?.evaluate(() => Array.from(document.querySelectorAll('img')).map((img) => img.getAttribute('loading')));
		check('13. the Document page holds an unloaded lazy image before the capture', (lazyBefore ?? 0) > 0, String(lazyBefore));
		check("13. the Document page's small picture shows within 10 seconds", docPicture && docMs < 10000, `${docMs} ms`);
		check("13. after the capture, every image on the Document page keeps its loading attribute", !!lazyAfter && JSON.stringify(lazyAfter) === JSON.stringify(attrsBefore), `${JSON.stringify(attrsBefore)} -> ${JSON.stringify(lazyAfter)}`);
		await closeDialog(page);
		await realClick(page, await pageTab('Style guide'));
		await page.waitForTimeout(800);
	}

	// =============================================================================================
	// 14. The overlay panel: the same dialog, with no small screenshot, readable on a light ground,
	//     and its own Import button.
	// =============================================================================================
	{
		const overlay = await context.newPage();
		trackErrors(overlay);
		await overlay.goto(`${SVC_BASE_URL}/demo/guides/getting-started/?svc-overlay`, { waitUntil: 'networkidle' });
		await overlay.waitForFunction(() => !!document.querySelector('sl-customizer')?.shadowRoot?.querySelector('.svc-group'), undefined, { timeout: 30000 });
		await overlay.waitForTimeout(400);
		await realClick(overlay, await shadowQueryByText(overlay, '.svc-toolbar .svc-btn', 'Export…'));
		await overlay.waitForTimeout(300);
		const view = await overlay.evaluate(() => {
			const root = /** @type {ShadowRoot} */ (document.querySelector('sl-customizer')?.shadowRoot);
			const lum = (rgb) => {
				const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map((v) => {
					const c = Number(v) / 255;
					return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
				});
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			};
			const dialog = /** @type {HTMLElement} */ (root.querySelector('.svc-xp'));
			const title = /** @type {HTMLElement} */ (root.querySelector('#svc-xp-title'));
			const bg = lum(getComputedStyle(dialog).backgroundColor);
			const fg = lum(getComputedStyle(title).color);
			return {
				open: !(/** @type {HTMLElement} */ (root.querySelector('.svc-xp-backdrop')).hidden),
				thumbHidden: /** @type {HTMLElement} */ (root.querySelector('.svc-xp-thumb')).hidden,
				css: root.querySelector('pre.svc-xp-pre[data-file="css"]')?.textContent ?? '',
				contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
			};
		});
		check('14. the overlay panel opens the export dialog with the CSS filled in', view.open && view.css.trim().length > 0);
		check('14. the overlay dialog shows no small screenshot', view.thumbHidden);
		check('14. the overlay dialog title has at least 7:1 contrast on its ground', view.contrast >= 7, view.contrast.toFixed(2));
		const overlayPng = await downloadVia(overlay, '.svc-xp-quiet[data-export="png"]', 90000);
		check('14. the overlay dialog downloads a PNG of the page', /\.png$/.test(overlayPng.name) && overlayPng.bytes.subarray(0, 8).equals(PNG_SIGNATURE), overlayPng.name);
		await closeDialog(overlay);

		// The overlay page opens with the theme the studio saved, so change it before importing.
		await pickPreset(overlay, 'High Contrast Mono');
		const changed = await savedState(overlay);
		check('14. a preset change in the overlay panel moves away from the saved theme', !!changed && !sameTheme(changed, state));
		const chooser = overlay.waitForEvent('filechooser', { timeout: 10000 });
		await realClick(overlay, await shadowQueryByText(overlay, '.svc-toolbar .svc-btn', 'Import…'));
		await (await chooser).setFiles({ name: settings.name, mimeType: 'application/json', buffer: settings.bytes });
		await overlay.waitForTimeout(800);
		const imported = await savedState(overlay);
		check('14. the overlay panel\'s Import brings back the same theme', !!imported && sameTheme(imported, state));
		await overlay.close();
	}

	check('no page errors or console errors', errors.length === 0, errors.join(' | '));
}

async function main() {
	// try/finally: a crash partway through must still close the browser, or its process keeps this
	// suite running and `npm run test:e2e` never reaches the next suite.
	const browser = await launchBrowser();
	try {
		await run(browser);
	} finally {
		await browser.close();
	}
	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
