// @ts-check
/**
 * @file Studio route e2e suite (`/studio/`). Verifies the docked layout, the page
 * switcher + device widths, and that every panel operation (theming, TOC stamping, sidebar
 * re-render, target highlighting, tiles, export) correctly targets the preview `<iframe>`'s
 * document instead of the host document, per the studio's `getPageDoc()` indirection.
 *
 * The "panel and frame don't overlap" / "host doesn't scroll" checks only run at 1440px here -
 * the full 1440/1280/900/mobile-drawer geometry (and the acceptance list's specific screenshot
 * names) is covered fully by shell.mjs instead, so this suite keeps only the always-current
 * 1440px layout check to avoid duplicating that coverage.
 *
 * Other suites (`smoke`, `ui-round2`, `treatments`, `targets`, `tiles`) exercise the customizer
 * against direct page URLs in plain overlay mode and are unaffected by the studio's existence.
 *
 * Needs a running server; start one first (see README.md): `npm run preview:bg` (after `npm run
 * build`) or `npm run dev:bg`.
 *   node tests/e2e/studio.mjs
 * Env overrides: SVC_BASE_URL (default http://localhost:4420; under a sub-path build, the full
 * origin plus base path, e.g. http://localhost:4425/starlight-visual-customizer), SVC_CHROME_PATH,
 * SVC_BROWSER (chromium (default), firefox, webkit - see browser.mjs).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchBrowser } from './browser.mjs';
import { withBase, stripBase } from '../../src/customizer/core/base-path.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVC_BASE_URL = process.env.SVC_BASE_URL || 'http://localhost:4420';
// D3a: the app's own configured base, e.g. '/' at root or '/starlight-visual-customizer'
// under a sub-path build - derived from SVC_BASE_URL's own pathname, never hardcoded, so this suite
// passes at any base. Every check below that compares a real browser pathname against one of this
// app's own base-free constants (STUDIO_PAGES paths, '/studio/', '/') routes through
// `stripBase(..., BASE_PATH)`/`withBase(..., BASE_PATH)` rather than a bare '/foo/' literal.
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

/** @param {import('playwright-core').Page} page @param {'light'|'dark'} [lane] @returns {Promise<import('playwright-core').Frame>} */
async function getFrame(page, lane = 'light') {
	const handle = await page.$(`iframe[data-svc-preview][data-svc-lane="${lane}"]`);
	return handle.contentFrame();
}

/** Waits until the studio panel's body has been built - lazy per attachToPageDoc, so it may not
 * exist the instant `/studio/` finishes its own top-level load. */
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

// These used to be script-dispatched `el.click()` calls, which bypass real
// hit-testing (see shell.mjs's file header for the pointer-events bug this class of bug produces) -
// every click below is now a genuine `page.mouse.click()` at the element's actual on-screen center.

/** @param {import('playwright-core').ElementHandle | null} handle */
async function realClick(page, handle) {
	if (!handle) throw new Error('realClick: null element handle (selector matched nothing)');
	// A short, explicit timeout - not Playwright's 30s default - so a click on an element that turns
	// out to be hidden fails fast instead of stalling the suite.
	await handle.scrollIntoViewIfNeeded({ timeout: 5000 });
	const box = await handle.boundingBox();
	if (!box) throw new Error('realClick: element has no bounding box (not visible/laid out)');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** @param {import('playwright-core').Page} page @param {string} selector @param {string} text @returns {Promise<import('playwright-core').ElementHandle | null>} */
async function lightQueryByText(page, selector, text) {
	const handle = await page.evaluateHandle(
		({ selector, text }) => Array.from(document.querySelectorAll(selector)).find((el) => el.textContent.includes(text)) ?? null,
		{ selector, text }
	);
	return handle.asElement();
}

/** @param {import('playwright-core').Page} page @param {string} selector @param {string} attr @param {string} value @returns {Promise<import('playwright-core').ElementHandle | null>} */
async function lightQueryByAttr(page, selector, attr, value) {
	const handle = await page.evaluateHandle(
		({ selector, attr, value }) => Array.from(document.querySelectorAll(selector)).find((el) => el.getAttribute(attr) === value) ?? null,
		{ selector, attr, value }
	);
	return handle.asElement();
}

/** @param {import('playwright-core').Page} page @param {string} selector @returns {Promise<import('playwright-core').ElementHandle | null>} */
async function shadowQuery(page, selector) {
	const handle = await page.evaluateHandle((sel) => document.querySelector('sl-customizer').shadowRoot.querySelector(sel), selector);
	return handle.asElement();
}

/** @param {import('playwright-core').Page} page @param {string} label The page tab's visible label. */
async function clickPageTab(page, label) {
	await realClick(page, await lightQueryByText(page, '.svc-page-tab', label));
}

/** @param {import('playwright-core').Page} page @param {string} title The segmented device button's `title` attribute. */
async function clickDevice(page, title) {
	await realClick(page, await lightQueryByAttr(page, '.svc-seg-btn', 'title', title));
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

	// =============================================================================================
	// 1. Entry points (design doc item E), and the demo site's move under `/demo/`.
	// =============================================================================================
	{
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		trackErrors(page);

		await page.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		await page.waitForTimeout(300);

		const frame = await getFrame(page);
		check('studio shows /demo/specimen/ in the frame by default', normalizePath(stripBase(new URL(frame.url()).pathname, BASE_PATH)) === '/demo/specimen/', frame.url());

		const frameHasNoPanel = await frame.evaluate(() => !document.querySelector('sl-customizer')?.shadowRoot);
		check('the frame never mounts its own panel', frameHasNoPanel);

		const noPreloadInFrame = await frame.evaluate(() => !document.getElementById('svc-preload'));
		check('no #svc-preload remains in the frame after attach', noPreloadInFrame);

		// The site root is the product page; home.mjs covers it, including the forward of a root link
		// that carries a shared theme (`#svc=...`) to the studio.

		// An old-style link to a page from before the demo moved under /demo/ (any path not under
		// /demo/ and not /404/) still works: the studio loads it under /demo/ instead. Deliberately
		// NOT /specimen/ here - that's also the default page (and, by this point, the studio's own
		// persisted sessionStorage page from the visits above), so a check against it would pass even
		// if the old-style rewrite were a no-op. /guides/kitchen-sink/ differs from both fallbacks.
		await page.goto(`${SVC_BASE_URL}/studio/?page=/guides/kitchen-sink/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		const oldStyleFrame = await getFrame(page);
		await oldStyleFrame.waitForLoadState('networkidle').catch(() => {});
		await page.waitForTimeout(300);
		const oldStylePath = normalizePath(stripBase(new URL(oldStyleFrame.url()).pathname, BASE_PATH));
		check('an old-style ?page=/guides/kitchen-sink/ link loads the studio with the preview showing /demo/guides/kitchen-sink/', oldStylePath === '/demo/guides/kitchen-sink/', oldStylePath);

		// /demo/ is the demo site's splash page ("Landing" in the studio's own switcher).
		await page.goto(`${SVC_BASE_URL}/demo/`, { waitUntil: 'networkidle' });
		const demoTitle = await page.title();
		check('/demo/ serves the splash page, titled "Welcome | Orbit Docs"', demoTitle === 'Welcome | Orbit Docs', demoTitle);

		// Starlight's own header site-title link points at the base-aware /demo/, not /.
		await page.goto(`${SVC_BASE_URL}/demo/specimen/`, { waitUntil: 'networkidle' });
		const siteTitleHref = await page.evaluate(() => document.querySelector('a.site-title')?.getAttribute('href') ?? null);
		const siteTitlePath = normalizePath(stripBase(new URL(siteTitleHref, page.url()).pathname, BASE_PATH));
		check('the site-title link on /demo/specimen/ resolves to the base-aware /demo/', siteTitlePath === '/demo/', siteTitlePath);

		await page.close();
	}

	// =============================================================================================
	// Main studio session - one page/frame reused for the rest of the suite.
	// =============================================================================================
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	trackErrors(page);
	await page.goto(`${SVC_BASE_URL}/studio/`, { waitUntil: 'networkidle' });
	await waitForPanelBody(page);
	let frame = await getFrame(page);
	await frame.waitForLoadState('networkidle').catch(() => {});
	await page.waitForTimeout(300);

	// =============================================================================================
	// 2. Layout: panel and frame side by side, host document never scrolls, at 1440px.
	// =============================================================================================
	{
		const rects = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const iframe = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
			return {
				panel: host.getBoundingClientRect(),
				frame: iframe.getBoundingClientRect(),
				docScrollableY: document.documentElement.scrollHeight > window.innerHeight + 2,
				docScrollableX: document.documentElement.scrollWidth > window.innerWidth + 2,
			};
		});
		const overlap = rects.panel.width > 0 && rects.frame.right > rects.panel.left && rects.panel.right > rects.frame.left;
		check('panel and frame do not overlap at 1440px', !overlap, JSON.stringify(rects));
		check('host document does not scroll at 1440px', !rects.docScrollableY && !rects.docScrollableX, JSON.stringify(rects));
	}

	// =============================================================================================
	// 3. Theming propagates to the frame; in-frame sidebar navigation preserves panel state and
	//    re-themes/re-stamps the new page. Every control row exists in the DOM regardless of which
	//    rail group is currently visible (studio builds all groups up front, same as B's accordion),
	//    so direct control manipulation below needs no group-opening step.
	// =============================================================================================
	{
		await clickPageTab(page, 'Document');
		await frame.waitForURL(/kitchen-sink/, { timeout: 10000 });
		await page.waitForTimeout(300);
		frame = await getFrame(page);

		const colorBefore = await frame.evaluate(() => {
			const a = document.querySelector('.sl-markdown-content a');
			return a ? getComputedStyle(a).color : null;
		});
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='color.accent.hue'] input[type=range]");
			input.value = '30';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(300);
		const colorAfter = await frame.evaluate(() => {
			const a = document.querySelector('.sl-markdown-content a');
			return a ? getComputedStyle(a).color : null;
		});
		check('changing accent hue restyles the frame', !!colorBefore && !!colorAfter && colorBefore !== colorAfter);

		// Record panel state (active rail group + a deliberately-nonzero scroll position) before navigating.
		await page.evaluate(() => {
			document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-panel-sections').scrollTop = 45;
		});
		await page.waitForTimeout(100);
		const stateBefore = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return {
				activeGroup: host.shadowRoot.querySelector('.svc-rail-item[aria-selected="true"]')?.dataset.group,
				scrollTop: host.shadowRoot.querySelector('.svc-panel-sections').scrollTop,
			};
		});

		const clicked = await frame.evaluate(() => {
			const link = Array.from(document.querySelectorAll('.sidebar-content a')).find(
				(a) => a.getAttribute('href') && a.getAttribute('href').includes('/guides/getting-started')
			);
			if (!link) return false;
			link.click();
			return true;
		});
		check('found a sidebar link inside the frame to click', clicked);
		await frame.waitForURL(/getting-started/, { timeout: 10000 });
		await page.waitForTimeout(400);
		frame = await getFrame(page);

		const stateAfter = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return {
				activeGroup: host.shadowRoot.querySelector('.svc-rail-item[aria-selected="true"]')?.dataset.group,
				scrollTop: host.shadowRoot.querySelector('.svc-panel-sections').scrollTop,
			};
		});
		check(
			'panel active rail group is unchanged after in-frame navigation',
			stateAfter.activeGroup === stateBefore.activeGroup,
			`${stateBefore.activeGroup} -> ${stateAfter.activeGroup}`
		);
		check(
			'panel scroll position is unchanged after in-frame navigation',
			stateAfter.scrollTop === stateBefore.scrollTop,
			`${stateBefore.scrollTop} -> ${stateAfter.scrollTop}`
		);

		const newPageInfo = await frame.evaluate(() => {
			const a = document.querySelector('.sl-markdown-content a');
			return {
				color: a ? getComputedStyle(a).color : null,
				tocStamped: !!document.querySelector('starlight-toc li[data-svc-level]'),
			};
		});
		check('the new page is themed with the accent change (probed color)', newPageInfo.color === colorAfter, `${newPageInfo.color} vs ${colorAfter}`);
		check('the new page has TOC-level stamping applied', newPageInfo.tocStamped);
	}

	// =============================================================================================
	// 4. Page switcher: every segment loads its path and is marked current; an unlisted page shows
	//    "Other"; ?page= restores after reload.
	// =============================================================================================
	const { STUDIO_PAGES } = await import('../../src/customizer/ui/studio.js');
	for (const spec of STUDIO_PAGES) {
		await clickPageTab(page, spec.label);
		await frame.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
		await page.waitForTimeout(350);
		frame = await getFrame(page);
		const framePath = normalizePath(stripBase(new URL(frame.url()).pathname, BASE_PATH));
		check(`switcher segment "${spec.label}" loads ${spec.path}`, framePath === normalizePath(spec.path), framePath);
		const marked = await page.evaluate((label) => {
			const btn = Array.from(document.querySelectorAll('.svc-page-tab')).find((b) => b.textContent.includes(label));
			return btn?.getAttribute('aria-selected') === 'true';
		}, spec.label);
		check(`switcher segment "${spec.label}" is marked current`, marked);

		if (spec.id === 'landing') await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'b13-landing.png') });
		if (spec.id === 'longdoc') await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'b13-document.png') });
		if (spec.id === '404') await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'b13-404.png') });
	}

	{
		// Tab-consolidation follow-up: Article, Short doc and Reference were dropped from the switcher
		// (they share Document's `template: doc` layout) but stay in the demo site, reachable through
		// its own sidebar - exercise that directly by clicking through to Article's old page
		// (/demo/resources/changelog/) via a REAL sidebar link click inside the frame, landing back on
		// the switcher's existing "Other" state rather than a page.evaluate() href assignment.
		await clickPageTab(page, 'Style guide');
		await frame.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
		await page.waitForTimeout(300);
		frame = await getFrame(page);
		const changelogLink = (
			await frame.evaluateHandle(() => Array.from(document.querySelectorAll('.sidebar-content a')).find((a) => a.getAttribute('href')?.includes('/resources/changelog')))
		).asElement();
		await realClick(page, changelogLink);
		await frame.waitForURL(/\/resources\/changelog\//, { timeout: 10000 });
		await frame.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
		await page.waitForTimeout(350);
		frame = await getFrame(page);
		const otherInfo = await page.evaluate(() => {
			const other = document.querySelector('.svc-page-other');
			const anyActive = Array.from(document.querySelectorAll('.svc-page-tab')).some((b) => b.getAttribute('aria-selected') === 'true');
			return { otherHidden: other?.hidden, otherText: other?.textContent, anyActive };
		});
		check(
			'reaching a page dropped from the switcher via a real sidebar link click shows "Other"',
			otherInfo.otherHidden === false && otherInfo.otherText.includes('/demo/resources/changelog/'),
			JSON.stringify(otherInfo)
		);
		check('no switcher segment is marked current for an unlisted page', !otherInfo.anyActive);
	}

	{
		await page.goto(`${SVC_BASE_URL}/studio/?page=/demo/guides/kitchen-sink/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		frame = await getFrame(page);
		await frame.waitForLoadState('networkidle').catch(() => {});
		await page.waitForTimeout(300);
		const restoredPath = normalizePath(stripBase(new URL(frame.url()).pathname, BASE_PATH));
		check('?page= restores the frame after reload', restoredPath === '/demo/guides/kitchen-sink/', restoredPath);
	}

	// =============================================================================================
	// 5. Device widths: mobile shows Starlight's real mobile layout in the frame.
	// =============================================================================================
	await clickDevice(page, '390px');
	await page.waitForTimeout(300);
	{
		const mobileLayout = await frame.evaluate(() => {
			const toggle = document.querySelector('.sl-menu-button');
			const sidebar = document.querySelector('.sidebar-pane');
			const toggleVisible = toggle && getComputedStyle(toggle).display !== 'none';
			const sidebarVisible = sidebar && getComputedStyle(sidebar).display !== 'none';
			return { toggleVisible, sidebarVisible };
		});
		check('mobile device width shows the mobile menu toggle', mobileLayout.toggleVisible, JSON.stringify(mobileLayout));
		check('mobile device width hides the desktop sidebar', !mobileLayout.sidebarVisible, JSON.stringify(mobileLayout));
	}
	await clickDevice(page, '820px');
	await page.waitForTimeout(300);
	await clickDevice(page, 'Fills the available width');
	await page.waitForTimeout(150);

	// =============================================================================================
	// 6. Follow-on-page: focusing code.frameRadius scrolls the frame to the code block and the
	//    overlay lines up with it (accounting for the frame's own offset in the host viewport).
	// =============================================================================================
	{
		await clickPageTab(page, 'Document');
		await frame.waitForURL(/kitchen-sink/, { timeout: 10000 });
		await page.waitForTimeout(300);
		frame = await getFrame(page);
		await frame.evaluate(() => window.scrollTo(0, 0));

		// Open the Code group via the rail (studio has no accordion toggle - the rail IS the group
		// selector) so the frameRadius input is actually the one currently focusable/visible.
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Code"]'));
		await page.waitForTimeout(150);

		const scrollBefore = await frame.evaluate(() => window.scrollY);
		await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const input = host.shadowRoot.querySelector("[data-control-id='code.frameRadius'] input[type=range]");
			input.focus();
		});

		// Deterministic settle: a fixed sleep after scrollY looks stable races target-highlight.js's
		// own rAF-throttled `schedulePosition()` (fires on 'scroll', so it can still be one frame
		// behind the smooth-scroll's true end) - poll the FULL snapshot (scrollY, the code block's
		// viewport-relative rect, and the overlay's rect) until two consecutive reads agree, rather
		// than guessing how long "catching up" takes - poll, never fixed sleeps.
		async function snapshot() {
			const [scrollY, codeRectInFrame] = await Promise.all([
				frame.evaluate(() => window.scrollY),
				frame.evaluate(() => {
					const el = document.querySelector('.expressive-code .frame');
					return el ? el.getBoundingClientRect().toJSON() : null;
				}),
			]);
			const hostSide = await page.evaluate(() => {
				const frameEl = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
				const host = document.querySelector('sl-customizer');
				const overlay = host.shadowRoot.querySelector('.svc-target-overlay');
				let overlayRect = null;
				if (overlay && !overlay.hidden) {
					const m = new DOMMatrixReadOnly(getComputedStyle(overlay).transform);
					overlayRect = { x: m.m41, y: m.m42, width: parseFloat(overlay.style.width), height: parseFloat(overlay.style.height) };
				}
				return { frameOffset: frameEl.getBoundingClientRect().toJSON(), overlayRect };
			});
			return { scrollY, codeRectInFrame, ...hostSide };
		}
		async function waitForSettledSnapshot({ timeoutMs = 6000, intervalMs = 120 } = {}) {
			const deadline = Date.now() + timeoutMs;
			let previous = await snapshot();
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, intervalMs));
				const current = await snapshot();
				if (JSON.stringify(current) === JSON.stringify(previous)) return current;
				previous = current;
			}
			return previous;
		}

		const settled = await waitForSettledSnapshot();
		check('focusing code.frameRadius scrolls the frame toward the code block', settled.scrollY !== scrollBefore, `${scrollBefore} -> ${settled.scrollY}`);
		check('the overlay is visible after focusing code.frameRadius', !!settled.overlayRect);
		if (settled.overlayRect && settled.codeRectInFrame) {
			const expectedX = settled.frameOffset.x + settled.codeRectInFrame.x;
			const expectedY = settled.frameOffset.y + settled.codeRectInFrame.y;
			const closeEnough = Math.abs(settled.overlayRect.x - expectedX) < 2 && Math.abs(settled.overlayRect.y - expectedY) < 2;
			check(
				'the overlay lines up with the code block, accounting for the frame offset',
				closeEnough,
				`overlay(${settled.overlayRect.x},${settled.overlayRect.y}) vs expected(${expectedX},${expectedY})`
			);
		} else {
			check('the overlay lines up with the code block, accounting for the frame offset', false, 'missing rect data');
		}
	}

	// =============================================================================================
	// 7. Light/dark toggle (now the toolbar's segmented control, S2 - the panel's own sun/moon
	//    button is gone) flips both documents; swatches resolve real colors; tiles render; export
	//    still produces non-empty CSS.
	// =============================================================================================
	{
		const before = await page.evaluate(() => ({ host: document.documentElement.dataset.theme }));
		const frameBefore = await frame.evaluate(() => document.documentElement.dataset.theme);
		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Dark'));
		await page.waitForTimeout(200);
		const after = await page.evaluate(() => ({ host: document.documentElement.dataset.theme }));
		const frameAfter = await frame.evaluate(() => document.documentElement.dataset.theme);
		check('the theme toggle flips data-theme on the host document', after.host !== before.host, `${before.host} -> ${after.host}`);
		check('the theme toggle flips data-theme on the frame document', frameAfter !== frameBefore, `${frameBefore} -> ${frameAfter}`);
		check('host and frame agree on data-theme after the toggle', after.host === frameAfter);

		// Flip back to Light so later state stays predictable.
		await realClick(page, await lightQueryByText(page, '.svc-seg-btn', 'Light'));
		await page.waitForTimeout(200);

		const swatchInfo = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const swatches = Array.from(host.shadowRoot.querySelectorAll('.svc-color-swatch'));
			return {
				count: swatches.length,
				nonTransparent: swatches.every((s) => {
					const c = getComputedStyle(s).backgroundColor;
					return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
				}),
			};
		});
		check('swatches have non-transparent backgrounds in the studio', swatchInfo.count > 0 && swatchInfo.nonTransparent, JSON.stringify(swatchInfo));

		// Tiles render: open Header (a live-sample tile group) via the rail and diff two option previews.
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Header"]'));
		await page.waitForTimeout(300);
		const tileCount = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			const row = host.shadowRoot.querySelector("[data-control-id='header.style']");
			const shadow = row.querySelector('.svc-tiles').shadowRoot;
			return shadow.querySelectorAll('.svc-tile-preview').length;
		});
		check('header.style tiles render in the studio (non-empty)', tileCount > 0, String(tileCount));
		if (tileCount >= 2) {
			const shots = [];
			for (let i = 0; i < 2; i++) {
				const handle = await page.evaluateHandle((i) => {
					const host = document.querySelector('sl-customizer');
					const row = host.shadowRoot.querySelector("[data-control-id='header.style']");
					const shadow = row.querySelector('.svc-tiles').shadowRoot;
					return shadow.querySelectorAll('.svc-tile-preview')[i];
				}, i);
				const el = handle.asElement();
				shots.push(await el.screenshot());
				await handle.dispose();
			}
			check('the first two header.style tiles are visually distinct in the studio', !shots[0].equals(shots[1]));
		}

		// Export (now the light-DOM top bar's primary button - S1/S14) still produces non-empty CSS.
		await realClick(page, await lightQueryByText(page, '.svc-tb-btn', 'Export'));
		await page.waitForTimeout(150);
		const exportCss = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return host.shadowRoot.querySelector('pre.svc-xp-pre[data-file="css"]')?.textContent ?? null;
		});
		check('export still produces non-empty CSS in the studio', !!exportCss && exportCss.trim().length > 0);
	}

	// =============================================================================================
	// 8. A plain top-level page visit mounts NO panel at all - just the
	//    saved theme (no-flash preload) plus a fixed "Open in Studio" pill; `?svc-overlay` restores
	//    the overlay panel for the engine test suites.
	// =============================================================================================
	{
		const outsidePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		trackErrors(outsidePage);
		await outsidePage.goto(`${SVC_BASE_URL}/demo/guides/kitchen-sink/`, { waitUntil: 'networkidle' });
		const noFlag = await outsidePage.evaluate(() => ({
			hasShadowRoot: !!document.querySelector('sl-customizer')?.shadowRoot,
			pill: document.getElementById('svc-open-in-studio-pill')?.getAttribute('href') ?? null,
		}));
		check('a plain page visit mounts no panel', !noFlag.hasShadowRoot, JSON.stringify(noFlag));
		check(
			'the "Open in Studio" pill exists and links to /studio/?page=...',
			noFlag.pill === `${withBase('/studio/', BASE_PATH)}?page=%2Fdemo%2Fguides%2Fkitchen-sink%2F`,
			String(noFlag.pill)
		);

		const pillBox = await outsidePage.locator('#svc-open-in-studio-pill').boundingBox();
		const pillHit = await outsidePage.evaluate(
			({ x, y }) => {
				const el = document.elementFromPoint(x, y);
				const pill = document.getElementById('svc-open-in-studio-pill');
				return !!el && (el === pill || pill.contains(el));
			},
			{ x: pillBox.x + pillBox.width / 2, y: pillBox.y + pillBox.height / 2 }
		);
		check('a real click at the pill\'s center hits the pill (hit-test)', pillHit);
		await outsidePage.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-open-in-studio-pill.png') });

		await Promise.all([
			outsidePage.waitForNavigation({ waitUntil: 'networkidle' }),
			outsidePage.mouse.click(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2),
		]);
		check(
			'clicking the pill opens /studio/ at the same page',
			normalizePath(stripBase(new URL(outsidePage.url()).pathname, BASE_PATH)) === '/studio/' && outsidePage.url().includes('kitchen-sink'),
			outsidePage.url()
		);

		await outsidePage.goto(`${SVC_BASE_URL}/demo/guides/kitchen-sink/?svc-overlay`, { waitUntil: 'networkidle' });
		const withFlag = await outsidePage.evaluate(() => ({
			hasDrawer: !!document.querySelector('sl-customizer')?.shadowRoot?.querySelector('.svc-drawer, .svc-fab'),
			pillExists: !!document.getElementById('svc-open-in-studio-pill'),
		}));
		check('?svc-overlay still mounts the overlay panel', withFlag.hasDrawer && !withFlag.pillExists, JSON.stringify(withFlag));
		await outsidePage.close();
	}

	// =============================================================================================
	// 9. Larger device widths and the zoom control.
	// =============================================================================================
	{
		await clickPageTab(page, 'Document');
		await frame.waitForURL(/kitchen-sink/, { timeout: 10000 }).catch(() => {});
		frame = await getFrame(page);
		await page.waitForTimeout(300);

		await clickDevice(page, '2560px');
		await page.waitForTimeout(300);
		const innerWidth2560 = await frame.evaluate(() => window.innerWidth);
		check('device Ultra-wide 2560 sets the frame innerWidth to 2560 within 1px', Math.abs(innerWidth2560 - 2560) <= 1, String(innerWidth2560));

		// Zoom in past 100% - the scale label should climb above the natural fit percentage, the frame
		// should still report the DEVICE's own width (never the zoomed CSS box size), and the lane
		// should become pannable (F0's one deliberate x-axis-only scroll-container exception).
		const zoomInBtn = await lightQueryByAttr(page, '.svc-zoom-seg button', 'aria-label', 'Zoom in');
		for (let i = 0; i < 6; i++) {
			await realClick(page, zoomInBtn);
			await page.waitForTimeout(100);
		}
		const zoomed = await page.evaluate(() => {
			const iframe = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
			const wrap = iframe.closest('.svc-lane-wrap');
			return {
				scale: iframe.dataset.svcScale,
				zoomLabel: document.querySelector('.svc-zoom-value')?.textContent,
				pannable: wrap.dataset.pannable,
				scaleLabel: document.getElementById('svc-scale-label').textContent,
			};
		});
		check('zoom can go above 100% (s > 1 keeps its transform, F0 fix)', parseFloat(zoomed.scale) > 1, JSON.stringify(zoomed));
		check('the zoom value reads 150%', zoomed.zoomLabel === '150%', zoomed.zoomLabel);
		check('a zoom wider than the lane makes it pannable', zoomed.pannable === 'true', JSON.stringify(zoomed));
		const innerWidthZoomed = await frame.evaluate(() => window.innerWidth);
		check('the frame innerWidth stays the device width while zoomed (only the CSS box scales)', Math.abs(innerWidthZoomed - 2560) <= 1, String(innerWidthZoomed));
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-zoom-ultrawide.png') });

		// Fit resets zoom and clears pannable.
		const zoomFitBtn = await lightQueryByAttr(page, '.svc-zoom-seg button', 'aria-label', 'Zoom to fit');
		await realClick(page, zoomFitBtn);
		await page.waitForTimeout(200);
		const afterFit = await page.evaluate(() => {
			const iframe = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
			return { pannable: iframe.closest('.svc-lane-wrap').dataset.pannable, zoomLabel: document.querySelector('.svc-zoom-value')?.textContent };
		});
		check('"Fit" resets the zoom label to Fit and clears pannable', afterFit.zoomLabel === 'Fit' && afterFit.pannable === 'false', JSON.stringify(afterFit));

		// Zoom is disabled while the device itself is Fit (nothing to zoom relative to).
		await clickDevice(page, 'Fills the available width');
		await page.waitForTimeout(200);
		const zoomDisabled = await page.evaluate(() => Array.from(document.querySelectorAll('.svc-zoom-seg button')).every((b) => b.disabled));
		check('zoom buttons are disabled while device is Fit', zoomDisabled);
		await clickDevice(page, '1440px');
		await page.waitForTimeout(200);
	}

	// =============================================================================================
	// 10. Clicking the already-selected
	//     rail item used to collapse the panel column - it now just re-selects the group like any
	//     other rail click instead, so the panel column stays
	//     open. Collapsing happens only via the panel column's own header button or '\'; any rail
	//     item click, the button again, or '\' again reopens/toggles it; state persists.
	// =============================================================================================
	{
		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Presets"]'));
		await page.waitForTimeout(150);
		const wide = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('sl-customizer')).width));
		check('a rail item is selected before the collapse check', wide > 300, String(wide));

		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Presets"]')); // re-click the already-selected item
		await page.waitForTimeout(200);
		const afterReclick = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return { width: parseFloat(getComputedStyle(host).width), panelHidden: host.shadowRoot.getElementById('svc-panel-col').hidden };
		});
		check('clicking the already-selected rail item no longer collapses the panel (F3 reversed)', afterReclick.width > 300 && !afterReclick.panelHidden, JSON.stringify(afterReclick));

		await realClick(page, await shadowQuery(page, '.svc-panel-collapse-btn'));
		await page.waitForTimeout(200);
		let collapsedState = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return { width: parseFloat(getComputedStyle(host).width), panelHidden: host.shadowRoot.getElementById('svc-panel-col').hidden };
		});
		check('the panel column\'s own collapse button collapses the panel (rail stays)', collapsedState.width < 100 && collapsedState.panelHidden, JSON.stringify(collapsedState));
		const railStillVisible = await page.evaluate(() => !!document.querySelector('sl-customizer').shadowRoot.querySelector('.svc-rail-item[aria-selected="true"]'));
		check('the rail stays visible while the panel is collapsed', railStillVisible);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-panel-collapsed.png') });

		await realClick(page, await shadowQuery(page, '.svc-rail-item[data-group="Colors"]'));
		await page.waitForTimeout(200);
		const reopened = await page.evaluate(() => {
			const host = document.querySelector('sl-customizer');
			return {
				width: parseFloat(getComputedStyle(host).width),
				selected: host.shadowRoot.querySelector('.svc-rail-item[data-group="Colors"]').getAttribute('aria-selected'),
			};
		});
		check('clicking a different rail item reopens the panel AND selects that group', reopened.width > 300 && reopened.selected === 'true', JSON.stringify(reopened));

		await realClick(page, await shadowQuery(page, '.svc-panel-collapse-btn'));
		await page.waitForTimeout(200);
		const viaHeaderBtn = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.getElementById('svc-panel-col').hidden);
		check('the panel column\'s own collapse button also collapses it', viaHeaderBtn);

		await page.keyboard.press('\\');
		await page.waitForTimeout(200);
		const viaBackslash = await page.evaluate(() => document.querySelector('sl-customizer').shadowRoot.getElementById('svc-panel-col').hidden);
		check('the "\\" key reopens the panel', !viaBackslash);

		await page.reload({ waitUntil: 'networkidle' });
		await waitForPanelBody(page);
		await page.waitForTimeout(300);
		const afterReload = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('sl-customizer')).width));
		check('panel-collapse state is not collapsed after a reload (last state was expanded)', afterReload > 300, String(afterReload));
		frame = await getFrame(page);
	}

	// =============================================================================================
	// 11. Focusing controls at a scaled device never scrolls any
	//     host ancestor of the lane iframe, and the iframe's top stays aligned with its wrapper's -
	//     exact repro: 1600x1000 window, Long doc, device 1440.
	// =============================================================================================
	{
		const f0page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
		trackErrors(f0page);
		await f0page.goto(`${SVC_BASE_URL}/studio/?page=/demo/guides/kitchen-sink/`, { waitUntil: 'networkidle' });
		await waitForPanelBody(f0page);
		await f0page.waitForTimeout(150);
		await clickDevice(f0page, '1440px');
		await f0page.waitForTimeout(300);

		async function ancestorScrollTops() {
			return f0page.evaluate(() => {
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
		}
		function allZero(tops) {
			return Object.values(tops).every((v) => v === 0);
		}

		await realClick(f0page, await shadowQuery(f0page, '.svc-rail-item[data-group="Code"]'));
		await f0page.waitForTimeout(150);
		await f0page.evaluate(() => {
			document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='code.fontSize'] input")?.focus();
		});
		await f0page.waitForTimeout(400);
		let tops = await ancestorScrollTops();
		check('focusing code.fontSize at device 1440 leaves every lane wrapper ancestor at scrollTop 0', allZero(tops), JSON.stringify(tops));

		await realClick(f0page, await shadowQuery(f0page, '.svc-rail-item[data-group="Footer"]'));
		await f0page.waitForTimeout(150);
		await f0page.evaluate(() => {
			document.querySelector('sl-customizer').shadowRoot.querySelector("[data-control-id='footer.paginationShadow'] input")?.focus();
		});
		await f0page.waitForTimeout(400);
		tops = await ancestorScrollTops();
		check('focusing footer.paginationShadow next leaves every lane wrapper ancestor at scrollTop 0', allZero(tops), JSON.stringify(tops));

		const geometry = await f0page.evaluate(() => {
			const iframe = document.querySelector('iframe[data-svc-preview][data-svc-lane="light"]');
			const shell = iframe.closest('.svc-lane-shell');
			const shellRect = shell.getBoundingClientRect();
			const iframeRect = iframe.getBoundingClientRect();
			return { diff: Math.abs(shellRect.top - iframeRect.top) };
		});
		check('the iframe top equals its wrapper content-box top within 1px', geometry.diff <= 1, String(geometry.diff));
		await f0page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'c3-scaled-no-clip.png') });
		await f0page.close();
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
