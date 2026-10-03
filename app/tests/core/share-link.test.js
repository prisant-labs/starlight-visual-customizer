import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveInitialTheme, buildShareUrl, SHARE_HASH_PREFIX } from '../../src/customizer/core/share-link.js';
import { defaultState, applyPreset, setName, encodeState, sameTheme } from '../../src/customizer/core/state.js';

const shared = setName(applyPreset(defaultState(), 'ocean'), 'Ocean draft');
const mine = setName(applyPreset(defaultState(), 'oxide'), 'My saved theme');
const link = (state) => `${SHARE_HASH_PREFIX}${encodeState(state)}`;

describe('resolveInitialTheme', () => {
	test('no share link: the saved theme, or the defaults when nothing is saved', () => {
		const withSaved = resolveInitialTheme('', encodeState(mine));
		assert.equal(sameTheme(withSaved.state, mine), true);
		assert.equal(withSaved.pendingShared, null);
		assert.equal(withSaved.damaged, false);

		const empty = resolveInitialTheme('', null);
		assert.equal(sameTheme(empty.state, defaultState()), true);
		assert.equal(empty.pendingShared, null);
	});

	test('a hash that is not a share link is ignored', () => {
		const r = resolveInitialTheme('#overview', encodeState(mine));
		assert.equal(sameTheme(r.state, mine), true);
		assert.equal(r.pendingShared, null);
		assert.equal(r.damaged, false);
	});

	test('a share link opens directly when nothing is saved', () => {
		const r = resolveInitialTheme(link(shared), null);
		assert.equal(sameTheme(r.state, shared), true);
		assert.equal(r.pendingShared, null);
	});

	test('a share link opens directly over saved defaults, which every first studio visit writes', () => {
		const r = resolveInitialTheme(link(shared), encodeState(defaultState()));
		assert.equal(sameTheme(r.state, shared), true);
		assert.equal(r.pendingShared, null);
	});

	test('a share link for the theme already saved opens directly', () => {
		const r = resolveInitialTheme(link(mine), encodeState(mine));
		assert.equal(sameTheme(r.state, mine), true);
		assert.equal(r.pendingShared, null);
	});

	test('a share link that differs from real saved work keeps the saved theme and asks', () => {
		const r = resolveInitialTheme(link(shared), encodeState(mine));
		assert.equal(sameTheme(r.state, mine), true);
		assert.equal(sameTheme(r.pendingShared, shared), true);
		assert.equal(r.damaged, false);
	});

	test('a damaged share link keeps the saved theme and reports the damage', () => {
		const encoded = encodeState(shared);
		const truncated = `${SHARE_HASH_PREFIX}${encoded.slice(0, Math.floor(encoded.length / 2))}`;
		for (const hash of [truncated, SHARE_HASH_PREFIX, `${SHARE_HASH_PREFIX}not-base64-!!!`]) {
			const r = resolveInitialTheme(hash, encodeState(mine));
			assert.equal(sameTheme(r.state, mine), true, hash);
			assert.equal(r.pendingShared, null, hash);
			assert.equal(r.damaged, true, hash);
		}
	});

	test('a damaged share link with nothing saved opens the defaults and reports the damage', () => {
		const r = resolveInitialTheme(`${SHARE_HASH_PREFIX}not-base64-!!!`, null);
		assert.equal(sameTheme(r.state, defaultState()), true);
		assert.equal(r.damaged, true);
	});
});

describe('buildShareUrl', () => {
	const loc = (search) => ({ origin: 'https://example.com', pathname: '/svc/studio/', search });

	test("keeps the studio's ?page= and the theme", () => {
		assert.equal(buildShareUrl(loc('?page=/demo/specimen/'), 'abc'), 'https://example.com/svc/studio/?page=/demo/specimen/#svc=abc');
	});

	test('drops every other query parameter, including test flags and tracking parameters', () => {
		const url = buildShareUrl(loc('?svc-overlay&utm_source=x&page=/demo/landing/&session=1'), 'abc');
		assert.equal(url, 'https://example.com/svc/studio/?page=/demo/landing/#svc=abc');
	});

	test('no page, no query string', () => {
		assert.equal(buildShareUrl(loc(''), 'abc'), 'https://example.com/svc/studio/#svc=abc');
		assert.equal(buildShareUrl(loc('?svc-overlay'), 'abc'), 'https://example.com/svc/studio/#svc=abc');
	});

	test('a page value cannot add parameters or a fragment of its own', () => {
		const url = buildShareUrl(loc('?page=' + encodeURIComponent('/demo/x/&evil=1#svc=other')), 'abc');
		assert.equal(new URL(url).searchParams.get('page'), '/demo/x/&evil=1#svc=other');
		assert.equal(new URL(url).searchParams.get('evil'), null);
		assert.equal(new URL(url).hash, '#svc=abc');
	});
});
