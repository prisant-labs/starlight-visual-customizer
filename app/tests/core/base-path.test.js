/**
 * @file Tests `src/customizer/core/base-path.js`'s `withBase`/`stripBase`, the one helper every
 * runtime page-URL builder routes through so the app works unchanged at `/` and also under a
 * sub-path (`SVC_SITE_BASE`, e.g. a GitHub Pages project site). Exercises both trailing-slash shapes
 * `import.meta.env.BASE_URL` can take (see that file's header) via the optional explicit `base`
 * argument - this test runs under plain `node --test`, which has no Vite `import.meta.env`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { withBase, stripBase } from '../../src/customizer/core/base-path.js';

describe('withBase', () => {
	test('at the default root base, a root-relative path is unchanged', () => {
		assert.equal(withBase('/specimen/', '/'), '/specimen/');
		assert.equal(withBase('/studio/'), '/studio/'); // no explicit base -> falls back to real BASE_URL, '/' under plain Node
	});

	test('prefixes a sub-path base without a trailing slash', () => {
		assert.equal(withBase('/specimen/', '/astro-starlight-visual-customizer'), '/astro-starlight-visual-customizer/specimen/');
	});

	test('prefixes a sub-path base WITH a trailing slash - never doubles the slash', () => {
		assert.equal(withBase('/specimen/', '/astro-starlight-visual-customizer/'), '/astro-starlight-visual-customizer/specimen/');
	});

	test('the bare root path joins cleanly (no double slash)', () => {
		assert.equal(withBase('/', '/my-repo'), '/my-repo/');
		assert.equal(withBase('/', '/my-repo/'), '/my-repo/');
	});

	test('a non-root-relative value (external URL, fragment, query) passes through unchanged', () => {
		assert.equal(withBase('https://example.com/x', '/my-repo'), 'https://example.com/x');
		assert.equal(withBase('#fragment', '/my-repo'), '#fragment');
		assert.equal(withBase('?page=/specimen/', '/my-repo'), '?page=/specimen/');
	});

	test('null/undefined path is treated as empty, not a throw', () => {
		assert.equal(withBase(undefined, '/my-repo'), '');
		assert.equal(withBase(null, '/my-repo'), '');
	});
});

describe('stripBase', () => {
	test('at the default root base, a pathname is unchanged', () => {
		assert.equal(stripBase('/specimen/', '/'), '/specimen/');
	});

	test('strips a sub-path base without a trailing slash', () => {
		assert.equal(stripBase('/astro-starlight-visual-customizer/specimen/', '/astro-starlight-visual-customizer'), '/specimen/');
	});

	test('strips a sub-path base WITH a trailing slash', () => {
		assert.equal(stripBase('/astro-starlight-visual-customizer/specimen/', '/astro-starlight-visual-customizer/'), '/specimen/');
	});

	test('the base itself (no trailing slash in the pathname) normalizes to "/"', () => {
		assert.equal(stripBase('/astro-starlight-visual-customizer', '/astro-starlight-visual-customizer/'), '/');
	});

	test('a pathname that does not start with the base is returned unchanged (defensive)', () => {
		assert.equal(stripBase('/other/specimen/', '/astro-starlight-visual-customizer'), '/other/specimen/');
	});

	test('round-trips with withBase at both trailing-slash shapes', () => {
		for (const base of ['/my-repo', '/my-repo/', '/', '/a/b', '/a/b/']) {
			for (const p of ['/specimen/', '/studio/', '/guides/kitchen-sink/', '/']) {
				assert.equal(stripBase(withBase(p, base), base), p, `round-trip failed for path=${p} base=${base}`);
			}
		}
	});

	test('null/undefined pathname is treated as empty, not a throw', () => {
		assert.equal(stripBase(undefined, '/my-repo'), '');
		assert.equal(stripBase(null, '/my-repo'), '');
	});
});
