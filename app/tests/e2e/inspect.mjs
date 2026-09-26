// @ts-check
/**
 * @file Inspect acceptance suite: click an element on the
 * previewed page to reach exactly the controls that style it. Complements `shell.mjs` (which keeps
 * its own hit-test audit and A4 contrast walk green with Inspect active) rather than duplicating it.
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run
 * build`) or `npm run dev:bg`.
 *   node tests/e2e/inspect.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420), SVC_CHROME_PATH.
 *
 * Runs at the default device (Fit, scale 1, no transform) throughout - deliberately: `boundingBox()`
 * on a frame-obtained element handle already reports host-viewport coordinates (Playwright
 * normalizes it "relative to the main frame", accounting for the iframe's own position), which is
 * exactly what `page.mouse.move`/`page.mouse.click` need - but ONLY when the iframe itself carries no
 * CSS transform. At Fit that always holds (S8: "no transform at all"), so the same real-mouse
 * helpers `shell.mjs` uses for host/shadow-root elements work unchanged for frame-internal ones too.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** After an Inspect click, `scrollAnchorRowIntoView` scrolls the PANEL COLUMN's
 * own `.svc-panel-sections` (smooth) so the scope's first control is actually visible, not just
 * highlighted - polls for the settled outcome rather than a fixed wait before a screenshot. Checks
 * the row's TOP edge only (not full containment): a font-list/tile-grid row can be taller than the
 * panel's own visible height, so requiring the whole row to fit would be impossible geometry - what
 * matters is that the row's own label (its top) is scrolled into view, not clipped above the fold. */
async function waitForRowVisibleInPanel(page, controlId) {
	return waitForComputed(
		() =>
			page.evaluate((id) => {
				const host = document.querySelector('sl-customizer');
				const row = host.shadowRoot.querySelector(`.svc-control[data-control-id="${id}"]`);
				const container = host.shadowRoot.querySelector('.svc-panel-sections');
				if (!row || !container) return false;
				const r = row.getBoundingClientRect();
				const c = container.getBoundingClientRect();
				return r.top >= c.top - 4 && r.top < c.bottom;
			}, controlId),
		(v) => v === true,
		{ timeoutMs: 3000, intervalMs: 100 }
	);
}

// ---- real-mouse helpers (shell.mjs's pattern - see its file header for why script clicks are
// banned here). `centerOf`'s `boundingBox()` call works identically for a host/shadow element
// handle or a frame-obtained one - see this file's header note. ------------------------------------
/** @param {import('playwright-core').ElementHandle | null} handle */
async function centerOf(handle) {
	if (!handle) throw new Error('centerOf: null element handle (selector matched nothing)');
	await handle.scrollIntoViewIfNeeded({ timeout: 5000 });
	const box = await handle.boundingBox();
	if (!box) throw new Error('centerOf: element has no bounding box (not visible/laid out)');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
async function realClick(page, handle) {
	const { x, y } = await centerOf(handle);
	await page.mouse.click(x, y);
	return { x, y };
}
/** Real mouse hover (genuine `mousemove`, stepped) at an element's on-screen center. */
async function realMove(page, handle) {
	const { x, y } = await centerOf(handle);
	await page.mouse.move(x, y, { steps: 6 });
	return { x, y };
}

async function shadowQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector('sl-customizer').shadowRoot.querySelector(sel), selector);
	return handle.asElement();
}
async function lightQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelectorAll(selector)).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
}
async function lightQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector(sel), selector);
	return handle.asElement();
}

/** @param {import('playwright-core').Frame} frame @param {string} selector */
function frameQuery(frame, selector) {
	return frame.$(selector);
}

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

	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	trackErrors(page);
	await page.goto(`${SVC_BASE_URL}/studio/?page=specimen`, { waitUntil: 'networkidle' });
	await waitForPanelBody(page);
	await page.waitForTimeout(300);

	const inspectToggle = await lightQueryByText(page, '.svc-inspect-toggle', 'Inspect');

	// =================================================================================================
	// I1: toggle by a real click, and by keyboard `I` (not while typing).
	// =================================================================================================
	{
		await realClick(page, inspectToggle);
		const pressedAfterClick = await page.evaluate(() => document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed'));
		check('a real click on the Inspect button turns it on (aria-pressed=true)', pressedAfterClick === 'true', pressedAfterClick);

		await realClick(page, inspectToggle);
		const pressedAfterSecondClick = await page.evaluate(() => document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed'));
		check('a second click turns it back off', pressedAfterSecondClick === 'false', pressedAfterSecondClick);

		// Focus somewhere neutral (not a text field) before the keyboard shortcut.
		await realClick(page, await lightQuery(page, '.svc-brand'));
		await page.keyboard.press('i');
		const pressedAfterKey = await waitForComputed(
			() => page.evaluate(() => document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed')),
			(v) => v === 'true'
		);
		check('the "I" key toggles Inspect on when focus is not in a text field', pressedAfterKey === 'true', pressedAfterKey);

		// While typing, "i" must NOT toggle Inspect - type it into the theme name field. Reset with a
		// real click (never a script `.click()` - the "I" key just turned it on, so this turns it off).
		await realClick(page, inspectToggle);
		await page.waitForTimeout(100);
		await realClick(page, await lightQuery(page, '#svc-theme-name'));
		await page.keyboard.type('i');
		const pressedWhileTyping = await page.evaluate(() => document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed'));
		check('typing the letter "i" in a text field does not toggle Inspect', pressedWhileTyping === 'false', pressedWhileTyping);
		await page.evaluate(() => {
			document.getElementById('svc-theme-name').value = '';
			document.getElementById('svc-theme-name').blur();
		});
	}

	// =================================================================================================
	// I2/I3: hover the current sidebar item - solid outline on it, dashed on other sidebar links, a
	// scope tag naming the group/section.
	// =================================================================================================
	{
		await realClick(page, inspectToggle);
		await waitForComputed(
			() => page.evaluate(() => document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed')),
			(v) => v === 'true'
		);

		const frame = await getFrame(page, 'light');
		const activeLink = await frameQuery(frame, 'nav.sidebar a[aria-current="page"]');
		check('the active sidebar link exists on /specimen/', !!activeLink);
		await realMove(page, activeLink);

		const hoverState = await waitForComputed(
			() =>
				frame.evaluate(() => {
					const active = document.querySelector('nav.sidebar a[aria-current="page"]');
					const otherLinks = Array.from(document.querySelectorAll('.sidebar-content a')).filter((a) => a !== active);
					return {
						activeSolid: active?.classList.contains('svc-insp-hover-solid') ?? false,
						someOtherDashed: otherLinks.some((a) => a.classList.contains('svc-insp-hover-dashed')),
						tagVisible: !document.getElementById('svc-inspect-tag')?.hidden,
						tagText: document.getElementById('svc-inspect-tag')?.textContent || '',
					};
				}),
			(v) => v.activeSolid === true
		);
		check('hovering the active sidebar item outlines it solid', hoverState.activeSolid, JSON.stringify(hoverState));
		check('hovering the active sidebar item dashes at least one other sidebar link', hoverState.someOtherDashed, JSON.stringify(hoverState));
		check('a scope tag is shown near the pointer while hovering', hoverState.tagVisible, JSON.stringify(hoverState));
		check('the scope tag names a group and section, not a tag name', /[a-z]/i.test(hoverState.tagText) && !/^(a|div|li)$/i.test(hoverState.tagText.trim()), hoverState.tagText);

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-inspect-hover-sidebar.png') });
	}

	// =================================================================================================
	// I4: click the active sidebar item - Sidebar rail item selected, scope's controls carry the
	// inspected state, frame URL/scroll unchanged.
	// =================================================================================================
	{
		const frame = await getFrame(page, 'light');
		const urlBefore = frame.url();
		const scrollBefore = await frame.evaluate(() => window.scrollY);

		const activeLink = await frameQuery(frame, 'nav.sidebar a[aria-current="page"]');
		await realClick(page, activeLink);

		const railSelected = await waitForComputed(
			() => page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-item[data-group="Sidebar"]')?.getAttribute('aria-selected')),
			(v) => v === 'true'
		);
		check('clicking the active sidebar item selects the Sidebar rail item', railSelected === 'true', railSelected);

		const inspectedIds = await page.evaluate(() =>
			Array.from(document.querySelector('sl-customizer').shadowRoot.querySelectorAll('.svc-control-inspected')).map((el) => el.dataset.controlId)
		);
		check('the scope\'s controls carry the "inspected" highlight', inspectedIds.some((id) => id?.startsWith('sidebar.')), JSON.stringify(inspectedIds));

		const urlAfter = frame.url();
		const scrollAfter = await frame.evaluate(() => window.scrollY);
		check("the frame's URL did not change on an Inspect click", urlAfter === urlBefore, `${urlBefore} -> ${urlAfter}`);
		check("the frame's scroll position did not change on an Inspect click", scrollAfter === scrollBefore, `${scrollBefore} -> ${scrollAfter}`);

		const chipVisible = await page.evaluate(() => {
			const chip = document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-inspect-chip');
			return !!chip && !chip.hidden;
		});
		check('an "Inspecting: ..." chip is shown in the panel column', chipVisible);

		const linkStillActive = await frame.evaluate(() => document.querySelector('nav.sidebar a[aria-current="page"]') != null);
		check('the click did not navigate the page (the same link is still marked current)', linkStillActive);
	}

	// =================================================================================================
	// I4: an H2 (heading controls -> Typography), a code block (Code), a callout (Content).
	// =================================================================================================
	{
		const frame = await getFrame(page, 'light');
		const h2 = await frameQuery(frame, '.sl-markdown-content h2');
		check('an h2 exists on /specimen/', !!h2);
		await realClick(page, h2);
		const typographySelected = await waitForComputed(
			() => page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-item[data-group="Typography"]')?.getAttribute('aria-selected')),
			(v) => v === 'true'
		);
		check('clicking an h2 selects the Typography rail item', typographySelected === 'true', typographySelected);
		// The chip lists "Heading font" first (the scope's first/anchor control),
		// but the Fonts section's own first row is "Body font" - the panel must scroll so the anchor
		// row is actually visible, not just marked inspected below the fold.
		const headingRowVisible = await waitForRowVisibleInPanel(page, 'type.font.heading');
		check('the panel column scrolls the scope\'s first control into view after an Inspect click', headingRowVisible === true, String(headingRowVisible));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-inspect-click-heading.png') });

		const codeBlock = await frameQuery(frame, '.expressive-code, .sl-markdown-content pre');
		if (codeBlock) {
			await realClick(page, codeBlock);
			const codeSelected = await waitForComputed(
				() => page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-item[data-group="Code"]')?.getAttribute('aria-selected')),
				(v) => v === 'true'
			);
			check('clicking a code block selects the Code rail item', codeSelected === 'true', codeSelected);
		} else {
			check('a code block exists on /specimen/ to click', false, 'not found - skipped');
		}

		const callout = await frameQuery(frame, '.sl-markdown-content .starlight-aside, .sl-markdown-content aside');
		if (callout) {
			await realClick(page, callout);
			const contentSelected = await waitForComputed(
				() => page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-item[data-group="Content"]')?.getAttribute('aria-selected')),
				(v) => v === 'true'
			);
			check('clicking a callout selects the Content rail item', contentSelected === 'true', contentSelected);
			const chipTitle = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-inspect-chip-title')?.textContent || '');
			check('the chip names the Callouts section for a callout', chipTitle.includes('Callouts'), chipTitle);
		} else {
			check('a callout exists on /specimen/ to click', false, 'not found - skipped');
		}
	}

	// =================================================================================================
	// I1: Esc clears everything.
	// =================================================================================================
	{
		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		const stateAfterEsc = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return {
				pressed: document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed'),
				anyInspected: !!host.shadowRoot.querySelector('.svc-control-inspected'),
				chipVisible: (() => {
					const chip = host.shadowRoot.querySelector('.svc-inspect-chip');
					return !!chip && !chip.hidden;
				})(),
			};
		});
		check('Esc turns Inspect off', stateAfterEsc.pressed === 'false', JSON.stringify(stateAfterEsc));
		check('Esc clears the inspected-control highlight', stateAfterEsc.anyInspected === false, JSON.stringify(stateAfterEsc));
		check('Esc hides the chip', stateAfterEsc.chipVisible === false, JSON.stringify(stateAfterEsc));

		const frame = await getFrame(page, 'light');
		const outlineState = await frame.evaluate(() => ({
			anySolid: !!document.querySelector('.svc-insp-sel-solid, .svc-insp-hover-solid'),
			anyDashed: !!document.querySelector('.svc-insp-sel-dashed, .svc-insp-hover-dashed'),
		}));
		check('Esc removes every outline from the frame', !outlineState.anySolid && !outlineState.anyDashed, JSON.stringify(outlineState));
	}

	// =================================================================================================
	// I6: a click in Split's dark lane works.
	// =================================================================================================
	{
		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Split'));
		await page.waitForTimeout(500);
		await realClick(page, inspectToggle);
		await waitForComputed(
			() => page.evaluate(() => document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed')),
			(v) => v === 'true'
		);

		// Each Split lane is well under Starlight's 50em sidebar breakpoint at a 1440px window (two
		// ~500px-wide lanes), so the sidebar collapses to a mobile drawer there - an h2 stays visible
		// regardless of that breakpoint and is a perfectly good "does Inspect work in this lane" probe.
		const darkFrame = await getFrame(page, 'dark');
		const darkHeading = await frameQuery(darkFrame, '.sl-markdown-content h2');
		check('an h2 exists in the dark lane', !!darkHeading);
		if (darkHeading) {
			await realClick(page, darkHeading);
			const railSelected = await waitForComputed(
				() => page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-item[data-group="Typography"]')?.getAttribute('aria-selected')),
				(v) => v === 'true'
			);
			check('clicking the dark lane selects the Typography rail item too', railSelected === 'true', railSelected);
			await waitForRowVisibleInPanel(page, 'type.font.heading');
		}
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-inspect-split.png') });

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Light'));
		await page.waitForTimeout(300);
	}

	// =================================================================================================
	// I5: the element list selects by keyboard.
	// =================================================================================================
	{
		await realClick(page, inspectToggle);
		await waitForComputed(
			() => page.evaluate(() => document.querySelector('.svc-inspect-toggle').getAttribute('aria-pressed')),
			(v) => v === 'true'
		);
		await realClick(page, await lightQueryByText(page, '.svc-inspect-elements-btn', 'Elements'));
		const popoverOpen = await waitForComputed(
			() => page.evaluate(() => !document.querySelector('.svc-inspect-elements-popover')?.hidden),
			(v) => v === true
		);
		check('the Elements button opens a popover list', popoverOpen === true, String(popoverOpen));

		const groupCount = await page.evaluate(() => document.querySelectorAll('.svc-inspect-elements-group').length);
		check('the element list is grouped by manifest group', groupCount > 1, String(groupCount));

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c2-inspect-list.png') });

		const focusedIsListItem = await page.evaluate(() => document.activeElement?.classList.contains('svc-inspect-elements-item'));
		check('opening the list moves focus to its first item (a keyboard starting point)', focusedIsListItem === true, String(focusedIsListItem));

		await page.keyboard.press('Enter');
		const selectedAfterEnter = await waitForComputed(
			() => page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-control-inspected')),
			(v) => v === true
		);
		check('pressing Enter on a focused list item selects it (a keyboard path to the same selection)', selectedAfterEnter === true, String(selectedAfterEnter));

		// The Elements list's own selection scrolls the frame
		// (`{scroll: true}`, unlike a plain click) - `inspect.js` routes that through
		// `scrollElementIntoView` (target-highlight.js), never `Element.scrollIntoView`, so no host
		// ancestor of the lane iframe should ever pick up a nonzero scroll position from it.
		await page.waitForTimeout(400); // let any smooth scroll settle
		const ancestorTops = await page.evaluate(() => {
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
			"selecting an Elements-list item leaves every lane wrapper ancestor at scrollTop 0",
			Object.values(ancestorTops).every((v) => v === 0),
			JSON.stringify(ancestorTops)
		);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
	}

	await page.close();

	console.log('\nBROWSER ERRORS:', errors.length ? errors.join('\n') : '(none)');
	await browser.close();

	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
