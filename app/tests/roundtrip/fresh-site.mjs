// @ts-check
/**
 * @file Scaffolds and manages the "fresh Starlight site" this suite applies exports to: a real,
 * separately-installed `@astrojs/starlight` site (pinned to this repo's own exact versions),
 * carrying the app's own demo content and Starlight config, but with none of the customizer's own
 * wiring (no studio route, no footer override, no preload/redirect head scripts, no `sl-customizer`
 * element). This is what makes the round-trip suite self-contained: nothing about it needs a
 * hand-scaffolded companion site checked in anywhere - a clean checkout runs `npm run
 * test:roundtrip` and this module builds one on first use.
 *
 * Lives outside the repo (a temp directory, not tracked by git) because it is itself a full,
 * separately-`npm install`ed Astro project - checking that in would mean a second `node_modules`
 * and a second lockfile inside this one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The app's own repo root (this file lives at `app/tests/roundtrip/`). */
const APP_ROOT = path.join(__dirname, '..', '..');

/**
 * Env for every child process (`npm`/`npx`) spawned against the FRESH site - `process.env` minus
 * a plain, generic `BASE_URL` that might be INHERITED from an outer shell (this suite's own var for
 * "the app's preview origin to compare against" is now `SVC_BASE_URL` - see `harness.mjs` - but the
 * empirical hazard below is about `BASE_URL` specifically, by that exact name, regardless of what
 * this suite itself calls its own setting). With a `BASE_URL` env var set, `astro build` was
 * observed emitting every internal link (sidebar hrefs, `site-title`, even `favicon.svg`) as an
 * ABSOLUTE url pointing at that origin instead of a relative path - which silently broke
 * `aria-current="page"` matching on the fresh site (its own links no longer matched its own current
 * URL) and cascaded into unrelated-looking surface mismatches (sidebar link colors, pagination
 * presence). The exact mechanism was NOT traced (it is not Vite's own `import.meta.env.BASE_URL`,
 * which only reflects the `base` config option, not `process.env.BASE_URL` - confirmed by reading
 * `create-vite.js`); this is an empirical fix, confirmed by building with `BASE_URL` set vs. unset
 * and diffing `dist/specimen/index.html`'s hrefs. Stripping it here is what makes this suite safe to
 * run even if a caller's shell happens to have `BASE_URL` set for something else entirely - the
 * FRESH site's own build must never see it.
 *
 * D3a: `SVC_SITE_BASE` gets the same guard, for the opposite direction - if the round-trip suite is
 * ever run from an outer shell that has `SVC_SITE_BASE` set (e.g. while also building/serving the
 * app itself under a sub-path), that value must never reach the fresh site's own `npm install`/
 * `astro build`/`astro preview` - this generated `FRESH_ASTRO_CONFIG` never reads it and always
 * builds at `/`, but stripping it here keeps that true defensively rather than by the accident of
 * the generated config simply not looking. `SVC_SITE_URL` is stripped alongside it for the same
 * reason, even though today's generated config has no `site` option either.
 * @returns {NodeJS.ProcessEnv}
 */
function freshSiteEnv() {
	const env = { ...process.env };
	delete env.BASE_URL;
	delete env.SVC_SITE_BASE;
	delete env.SVC_SITE_URL;
	return env;
}

/**
 * Reused across runs by default (not re-randomized every invocation) so a repeat run can skip
 * `npm install` entirely - see `ensureFreshSite`. Override to point at a throwaway location, or to
 * force a from-scratch scaffold.
 */
export const FRESH_SITE_DIR = process.env.FRESH_SITE_DIR || path.join(os.tmpdir(), 'svc-roundtrip-fresh-site');

/**
 * Exact versions this fresh site is pinned to - read directly from the app's OWN
 * `package.json`/`package-lock.json` (never hand-copied) so the two can never silently drift apart.
 * `sharp` is resolved from the lockfile because the app's own `package.json` range (`^0.35.3`)
 * doesn't pin an exact version on its own.
 * @returns {{astro: string, starlight: string, sharp: string}}
 */
function pinnedVersions() {
	const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
	const lock = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package-lock.json'), 'utf8'));
	const sharpEntry = lock.packages && lock.packages['node_modules/sharp'];
	if (!sharpEntry) throw new Error('fresh-site: could not resolve an exact sharp version from package-lock.json');
	return { astro: pkg.dependencies.astro, starlight: pkg.dependencies['@astrojs/starlight'], sharp: sharpEntry.version };
}

/** @param {{astro: string, starlight: string, sharp: string}} versions */
function freshSitePackageJson(versions) {
	return (
		JSON.stringify(
			{
				name: 'svc-roundtrip-fresh-site',
				type: 'module',
				private: true,
				dependencies: {
					'@astrojs/starlight': versions.starlight,
					astro: versions.astro,
					sharp: versions.sharp,
				},
			},
			null,
			2
		) + '\n'
	);
}

/**
 * The fresh site's `astro.config.mjs`: mirrors the app's own Starlight options (see
 * `app/astro.config.mjs`) MINUS every bit of customizer wiring - no `head` no-flash-preload /
 * redirect-to-studio scripts, no `components: { Footer: ... }` override (the app's own Footer
 * override only adds the `<sl-customizer>` mount point and its script; the fallback default
 * `Footer.astro` it wraps is exactly what this config gets by leaving `components` unset). Every
 * OTHER option is copied verbatim and deliberately - this is the "real config" a themed export is
 * applied against, and several of C's controls (`page.credits`, `page.toc.minLevel/maxLevel`) only
 * matter because this config's values differ from the manifest's own defaults (see the W1 report).
 */
const FRESH_ASTRO_CONFIG = `// @ts-check
// Generated by tests/roundtrip/fresh-site.mjs - mirrors app/astro.config.mjs minus customizer wiring.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { fixtureSidebar } from './src/fixture-sidebar.mjs';

export default defineConfig({
	integrations: [
		starlight({
			title: 'Starlight Customizer',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/prisant-labs/astro-starlight-visual-customizer',
				},
			],
			editLink: {
				baseUrl:
					'https://github.com/prisant-labs/astro-starlight-visual-customizer/edit/main/app/',
			},
			lastUpdated: false,
			pagination: true,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
			credits: true,
			sidebar: fixtureSidebar,
		}),
	],
});
`;

/** Files/directories copied as-is from the app into the fresh site (content only - no customizer code). */
const CONTENT_COPIES = [
	['src/content.config.ts', 'src/content.config.ts'],
	['tsconfig.json', 'tsconfig.json'],
	['src/fixture-sidebar.mjs', 'src/fixture-sidebar.mjs'],
	['src/content/docs', 'src/content/docs'],
	['src/assets/houston.webp', 'src/assets/houston.webp'],
	['public/favicon.svg', 'public/favicon.svg'],
];

function copyContent() {
	for (const [from, to] of CONTENT_COPIES) {
		const src = path.join(APP_ROOT, from);
		const dest = path.join(FRESH_SITE_DIR, to);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.rmSync(dest, { recursive: true, force: true });
		fs.cpSync(src, dest, { recursive: true });
	}
}

/**
 * Scaffolds the fresh site if it doesn't already look set up, and always re-copies the demo
 * content (cheap, no network) so a content change in the app is reflected on the next run even if
 * `node_modules` is reused. `npm install` only runs when `node_modules/@astrojs/starlight` is
 * missing (or `SVC_ROUNDTRIP_FORCE_INSTALL=1` is set) - the slow, network-dependent part of this
 * function is the one part a repeat run gets to skip.
 * @returns {{scaffolded: boolean, installed: boolean}}
 */
export function ensureFreshSite() {
	const alreadyExisted = fs.existsSync(FRESH_SITE_DIR);
	fs.mkdirSync(FRESH_SITE_DIR, { recursive: true });

	const versions = pinnedVersions();
	fs.writeFileSync(path.join(FRESH_SITE_DIR, 'package.json'), freshSitePackageJson(versions), 'utf8');
	fs.writeFileSync(path.join(FRESH_SITE_DIR, 'astro.config.mjs'), FRESH_ASTRO_CONFIG, 'utf8');
	copyContent();

	// A pristine copy, taken BEFORE any theme's `customCss` is ever added, so `resetToControl` can
	// restore exactly this (never a previous run's themed config) before the control build.
	fs.mkdirSync(path.join(FRESH_SITE_DIR, '_pristine'), { recursive: true });
	fs.copyFileSync(
		path.join(FRESH_SITE_DIR, 'astro.config.mjs'),
		path.join(FRESH_SITE_DIR, '_pristine', 'astro.config.mjs')
	);

	const starlightInstalled = fs.existsSync(path.join(FRESH_SITE_DIR, 'node_modules/@astrojs/starlight/package.json'));
	const forceInstall = process.env.SVC_ROUNDTRIP_FORCE_INSTALL === '1';
	let installed = false;
	if (!starlightInstalled || forceInstall) {
		execFileSync('npm', ['install'], { cwd: FRESH_SITE_DIR, stdio: 'inherit', shell: true, env: freshSiteEnv() });
		installed = true;
	}
	return { scaffolded: !alreadyExisted, installed };
}

/**
 * Restores `astro.config.mjs` from the pristine backup (undoes any theme's `customCss` insertion)
 * and deletes any applied `theme.css`, so the next build is a true, unthemed control.
 */
export function resetToControl() {
	const pristineConfig = path.join(FRESH_SITE_DIR, '_pristine/astro.config.mjs');
	if (!fs.existsSync(pristineConfig)) {
		throw new Error(`Missing ${pristineConfig} - call ensureFreshSite() first.`);
	}
	fs.copyFileSync(pristineConfig, path.join(FRESH_SITE_DIR, 'astro.config.mjs'));
	const themeCssPath = path.join(FRESH_SITE_DIR, 'src/styles/theme.css');
	if (fs.existsSync(themeCssPath)) fs.rmSync(themeCssPath);
}

/**
 * Applies an export directory (as produced by `writeExports` in `roundtrip.mjs`) to the fresh
 * site: copies `theme.css` in, adds a `customCss` entry LAST (idempotently) per the fixed
 * `APPLY-THEME.md` gap-3 wording, `npm i`s the theme's font packages, then rebuilds.
 * @param {string} exportDir
 * @param {import('../../src/customizer/core/state.js').ThemeState} state
 * @param {(id: string) => any} getValue
 * @param {{id: string, pkg: string}[]} fonts
 */
export function applyExportToFreshSite(exportDir, state, getValue, fonts) {
	const cssSrc = path.join(exportDir, 'theme.css');
	const cssDest = path.join(FRESH_SITE_DIR, 'src/styles/theme.css');
	fs.mkdirSync(path.dirname(cssDest), { recursive: true });
	fs.copyFileSync(cssSrc, cssDest);

	const configPath = path.join(FRESH_SITE_DIR, 'astro.config.mjs');
	let config = fs.readFileSync(configPath, 'utf8');
	if (!/customCss\s*:/.test(config)) {
		config = config.replace(/starlight\(\{\s*\n/, (m) => `${m}\t\t\tcustomCss: ['./src/styles/theme.css'],\n`);
		fs.writeFileSync(configPath, config, 'utf8');
	}

	const fontPkgs = [...new Set(['type.font.body', 'type.font.heading', 'type.font.mono'].map((id) => getValue(state, id)).filter(Boolean))]
		.map((fontId) => fonts.find((f) => f.id === fontId))
		.filter(Boolean)
		.map((f) => f.pkg);
	if (fontPkgs.length) {
		execFileSync('npm', ['i', ...fontPkgs], { cwd: FRESH_SITE_DIR, stdio: 'inherit', shell: true, env: freshSiteEnv() });
	}

	buildFreshSite();
}

export function buildFreshSite() {
	execFileSync('npx', ['astro', 'build'], { cwd: FRESH_SITE_DIR, stdio: 'inherit', shell: true, env: freshSiteEnv() });
}

/** Starts the fresh site's own production preview on :4431 in the background (see README.md - this port is reserved for this suite). */
export function startFreshPreview() {
	execFileSync('npx', ['astro', 'preview', '--background', '--port', '4431'], {
		cwd: FRESH_SITE_DIR,
		stdio: 'inherit',
		shell: true,
		env: freshSiteEnv(),
	});
}

/** Best-effort; never throws (the caller's `finally` shouldn't fail just because the server was already down). */
export function stopFreshPreview() {
	try {
		execFileSync('npx', ['astro', 'preview', 'stop'], { cwd: FRESH_SITE_DIR, stdio: 'inherit', shell: true, env: freshSiteEnv() });
	} catch {
		// already stopped, or never started - fine.
	}
}

/**
 * Polls `http://localhost:4431/` until it answers (instead of a fixed sleep - the app may take a
 * moment to bind after `--background` returns).
 * @param {number} [timeoutMs]
 */
export async function waitForFreshPreview(timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	let lastErr;
	while (Date.now() < deadline) {
		try {
			const res = await fetch('http://localhost:4431/');
			if (res.ok || res.status === 404) return;
		} catch (err) {
			lastErr = err;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`Fresh site preview on :4431 never became ready: ${lastErr}`);
}
