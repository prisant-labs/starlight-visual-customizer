// @ts-check
/**
 * @file Captures `app/public/og.png` - the social preview card other sites show when this
 * repository's README, or a page on the live site, gets linked - from `composer.html` in this
 * same folder, using playwright-core's chromium at exactly 1200x630, deviceScaleFactor 1.
 *
 * The composer lays out the project name, a one-line pitch, and a crop of the README hero
 * screenshot (`docs/images/studio.png`) beside it. Run this after recapturing that hero shot (see
 * `capture-readme-shots.mjs`, one level up) or after editing `composer.html`'s copy or styling.
 *
 * Needs no running server: `composer.html` has no network or filesystem dependency of its own -
 * this script inlines the Inter Variable woff2 (`app/node_modules/@fontsource-variable/inter`)
 * and the hero screenshot (`docs/images/studio.png`) as base64 data: URIs before rendering it. It
 * does need that hero screenshot to already exist on disk; if `docs/images/` is stale or missing,
 * run `capture-readme-shots.mjs` first, which does need a running server (from `app/`:
 * `npm run build` then `npm run preview:bg`).
 *
 * Usage (from `app/`):
 *   node scripts/social-card/capture.mjs                  # writes app/public/og.png
 *   node scripts/social-card/capture.mjs --out <file>     # writes somewhere else instead
 *   node scripts/social-card/capture.mjs --with-mark       # also shows the product mark
 *
 * The committed card (`app/public/og.png`) omits the product mark, so `--with-mark` defaults to
 * off; `composer.html`'s own header comment explains the `[[MARK_CLASS]]` token this flag sets.
 *
 * Needs playwright-core's chromium (an `app/` devDependency) and sharp (an `app/` dependency,
 * already used by the export dialog) to recompress the capture under ~300 KB.
 *
 * Env override: `SVC_CHROME_PATH` (a pinned Chrome/Chromium executable), the same convention
 * `tests/e2e/*.mjs` and `capture-readme-shots.mjs` use.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const FONT_PATH_REL = 'app/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2';
const SHOT_PATH_REL = 'docs/images/studio.png';
const TEMPLATE_PATH = path.join(__dirname, 'composer.html');
const DEFAULT_OUT = path.join(REPO_ROOT, 'app', 'public', 'og.png');

const MAX_BYTES = 300 * 1024;

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		out: { type: 'string' },
		'with-mark': { type: 'boolean', default: false },
	},
});

const OUT_PATH = values.out ? path.resolve(values.out) : DEFAULT_OUT;

function toDataUri(filePath, mime) {
	const data = readFileSync(filePath).toString('base64');
	return `data:${mime};base64,${data}`;
}

async function capture(browser, html, outPath) {
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
	await page.setContent(html, { waitUntil: 'networkidle' });
	await page.evaluate(async () => {
		await document.fonts.ready;
	});
	// document.fonts.ready resolves even if every @font-face source failed to load (it just means
	// font matching/layout settled) - it would silently pass with the card rendered in a system
	// fallback font. Confirm Inter Variable specifically reports "loaded".
	const interLoaded = await page.evaluate(() =>
		[...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Inter Variable' && f.status === 'loaded')
	);
	if (!interLoaded) {
		await page.close();
		throw new Error(`${path.basename(outPath)}: Inter Variable never reached status "loaded" - the card would render in a fallback font`);
	}
	let png = await page.screenshot({ type: 'png' });
	await page.close();

	// Keep the card under ~300 KB. The capture is already a clean PNG (no photographic noise
	// outside the screenshot crop), so a palette-indexed re-encode is enough; fall back to
	// lowering the crop's resolution only if that's not sufficient.
	if (png.length > MAX_BYTES) {
		png = await sharp(png).png({ palette: true, colors: 256, compressionLevel: 9 }).toBuffer();
	}
	if (png.length > MAX_BYTES) {
		throw new Error(`${path.basename(outPath)} is ${png.length} bytes after compression, over the ~${MAX_BYTES} byte target`);
	}
	mkdirSync(path.dirname(outPath), { recursive: true });
	writeFileSync(outPath, png);
	console.log(`wrote ${outPath} (${png.length} bytes)`);
}

async function main() {
	const fontDataUri = toDataUri(path.join(REPO_ROOT, FONT_PATH_REL), 'font/woff2');
	const shotDataUri = toDataUri(path.join(REPO_ROOT, SHOT_PATH_REL), 'image/png');
	// replaceAll: [[FONT_DATA_URI]] and [[SHOT_DATA_URI]] each appear twice in composer.html -
	// once documented in its own header comment, once at the real usage site - and a single
	// `.replace` would patch only the first (the comment), leaving the real `@font-face`/`<img>`
	// untouched.
	const html = readFileSync(TEMPLATE_PATH, 'utf8')
		.replaceAll('[[FONT_DATA_URI]]', fontDataUri)
		.replaceAll('[[SHOT_DATA_URI]]', shotDataUri)
		.replaceAll('[[MARK_CLASS]]', values['with-mark'] ? 'with-mark' : '');

	const browser = await chromium.launch({
		executablePath: process.env.SVC_CHROME_PATH || chromium.executablePath(),
		headless: true,
	});
	await capture(browser, html, OUT_PATH);
	await browser.close();
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
