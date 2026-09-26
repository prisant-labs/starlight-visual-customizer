/**
 * @file Guards the single source of truth for the pinned Starlight version
 * (`src/customizer/core/version.js`). Fails `npm test` the moment `npm install` brings in a
 * different `@astrojs/starlight`, before that mismatch can silently ship as a stale version
 * stamp in `theme.css`'s header, `APPLY-THEME.md`'s target line, or the studio's status bar. See
 * "When Starlight is upgraded" in `../../../_initial-discovery/2026-09-23_claude_astro-starlight-engineering-notes.md`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { STARLIGHT_VERSION } from '../../src/customizer/core/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('STARLIGHT_VERSION', () => {
	test('matches the installed node_modules/@astrojs/starlight package.json version', () => {
		const pkgPath = path.join(__dirname, '..', '..', 'node_modules', '@astrojs', 'starlight', 'package.json');
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
		assert.equal(
			STARLIGHT_VERSION,
			pkg.version,
			`src/customizer/core/version.js's STARLIGHT_VERSION ("${STARLIGHT_VERSION}") no longer matches the installed @astrojs/starlight ("${pkg.version}") - bump the constant (and re-verify selectors/goldens per the upgrade checklist) before this will pass.`
		);
	});
});
