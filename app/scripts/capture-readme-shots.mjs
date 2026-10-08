// @ts-check
/**
 * @file Captures the five screenshots README.md embeds from `docs/images/`: `studio.png`,
 * `studio-split.png`, `studio-colors.png`, `studio-export.png` and `studio-about.png`. Each shot
 * starts from a fresh browser context, so the studio opens in its default state. Run this after a
 * UI change that affects the studio's look, to refresh the images the README shows.
 *
 * Launches Chromium directly, the way the suites under `tests/e2e/*.mjs` do, rather than
 * importing the `SVC_BROWSER`-switchable launcher in `tests/e2e/browser.mjs`: these shots must
 * always be Chromium, since that is what the committed images were captured with, and reusing
 * that launcher would let a stray `SVC_BROWSER=firefox` in the environment silently change the
 * renderer.
 *
 * Needs a running server. From `app/`, first run:
 *   npm run build
 *   npm run preview:bg
 * Then, still from `app/`:
 *   node scripts/capture-readme-shots.mjs                    # all five, into docs/images/
 *   node scripts/capture-readme-shots.mjs --out <folder>     # into a different folder instead
 *   node scripts/capture-readme-shots.mjs studio-split        # just one shot, by id
 *   node scripts/capture-readme-shots.mjs studio-split --out <folder>
 * Stop the preview server afterward with `npm run preview:stop`.
 *
 * Env overrides: `SVC_BASE_URL` (default `http://localhost:4420`, no trailing slash - the same
 * convention `tests/e2e/*.mjs` uses), `SVC_CHROME_PATH` (a pinned Chrome/Chromium executable).
 *
 * Keep each shot's viewport, preset and wait timings in sync with the committed images: they were
 * tuned so a re-run reproduces the same crop, and so a preset's CDN-loaded fonts finish painting
 * before the screenshot is taken.
 */
import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'docs', 'images');

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: { out: { type: 'string' } },
	allowPositionals: true,
});

const OUT = values.out ? path.resolve(values.out) : DEFAULT_OUT;
const BASE = process.env.SVC_BASE_URL || 'http://localhost:4420';
const ONLY = positionals[0];

async function waitForStudio(page) {
	await page.waitForFunction(() => {
		const host = document.querySelector('sl-customizer');
		return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.svc-group-studio'));
	}, null, { timeout: 15000 });
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(800);
}

async function openGroup(page, group) {
	await page.locator(`.svc-rail-item[data-group="${group}"]`).click();
	await page.waitForTimeout(400);
}

async function applyPreset(page, label) {
	await openGroup(page, 'Presets');
	await page.locator('.svc-preset-card', { hasText: label }).first().click();
	// Fonts load from the CDN after a preset switch; give the frame time to repaint.
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1500);
}

async function split(page) {
	await page.locator('#svc-toolbar button', { hasText: 'Split' }).first().click();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1500);
}

// Each shot's id is the committed file's base name (docs/images/<id>.png).
const SHOTS = [
	{
		// The README's hero image. Editorial Serif gives the most visible change from stock
		// Starlight. 900px tall, not the 840 the other full-page shots below use: at 840 the rail
		// fills and the pinned Studio-sizing control half-covers the Structure rail item.
		id: 'studio',
		viewport: { width: 1600, height: 900 },
		run: async (page) => { await applyPreset(page, 'Editorial Serif'); },
	},
	{
		id: 'studio-split',
		viewport: { width: 1440, height: 900 },
		// Laptop 1280, scaled to fit: each lane shows Starlight's desktop layout, not the mobile one.
		run: async (page) => {
			await applyPreset(page, 'Designer: Ocean');
			await split(page);
			await page.locator('#svc-toolbar button[title="1280px"]').click();
			// Collapse the panel column (the rail stays) so each lane gets more width.
			await page.locator('.svc-panel-collapse-btn').click();
			await page.waitForTimeout(1200);
		},
	},
	{
		id: 'studio-colors',
		viewport: { width: 1440, height: 900 },
		run: async (page) => { await applyPreset(page, 'Designer: Ocean'); await openGroup(page, 'Colors'); },
	},
	{
		id: 'studio-export',
		viewport: { width: 1440, height: 900 },
		run: async (page) => {
			await applyPreset(page, 'Designer: Ocean');
			await page.locator('#svc-topbar button[aria-label="Export"]').click();
			// The dialog renders its small screenshot after it opens; the shot waits for that picture.
			await page.waitForFunction(() => !!document.querySelector('sl-customizer')?.shadowRoot?.querySelector('.svc-xp-thumb-pic img'), undefined, { timeout: 20000 });
			await page.waitForTimeout(600);
		},
	},
	{
		id: 'studio-about',
		viewport: { width: 1440, height: 900 },
		run: async (page) => { await page.locator('#svc-about-btn').click(); await page.waitForTimeout(600); },
	},
];

if (ONLY && !SHOTS.some((shot) => shot.id === ONLY)) {
	console.error(`Unknown shot id "${ONLY}". Valid ids: ${SHOTS.map((shot) => shot.id).join(', ')}`);
	process.exitCode = 1;
} else {
	mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch({
		executablePath: process.env.SVC_CHROME_PATH || chromium.executablePath(),
		headless: true,
	});
	for (const shot of SHOTS) {
		if (ONLY && shot.id !== ONLY) continue;
		const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: 1, colorScheme: 'light' });
		const page = await context.newPage();
		await page.goto(`${BASE}/studio/`, { waitUntil: 'networkidle' });
		await waitForStudio(page);
		await shot.run(page);
		const file = path.join(OUT, `${shot.id}.png`);
		await page.screenshot({ path: file });
		console.log('wrote', file);
		await context.close();
	}
	await browser.close();
}
