import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
	defaultState,
	getValue,
	setValue,
	applyPreset,
	encodeState,
	decodeState,
	snapToStep,
} from '../../src/customizer/core/state.js';
import { controls } from '../../src/customizer/core/manifest.js';
import { presets } from '../../src/customizer/core/presets.js';
import { STARLIGHT_VERSION } from '../../src/customizer/core/version.js';

describe('defaultState', () => {
	test('shape matches the SPEC ThemeState contract', () => {
		const s = defaultState();
		assert.equal(s.v, 1);
		assert.equal(s.starlight, STARLIGHT_VERSION);
		assert.equal(s.preset, 'starlight-default');
		assert.deepEqual(s.values, {});
		assert.equal(s.ia, null);
	});
});

describe('getValue', () => {
	test('returns the manifest default when unset', () => {
		const s = defaultState();
		assert.equal(getValue(s, 'color.accent.hue'), 269);
		assert.equal(getValue(s, 'page.pagination'), true);
	});

	test('returns the explicit override when set', () => {
		const s = setValue(defaultState(), 'color.accent.hue', 12);
		assert.equal(getValue(s, 'color.accent.hue'), 12);
	});
});

describe('setValue', () => {
	test('is immutable: does not mutate the input state', () => {
		const s = defaultState();
		const s2 = setValue(s, 'layout.radius', 10);
		assert.deepEqual(s.values, {});
		assert.equal(s2.values['layout.radius'], 10);
		assert.notEqual(s, s2);
	});

	test('setting a value equal to the manifest default removes the key rather than storing it', () => {
		let s = setValue(defaultState(), 'layout.radius', 10);
		assert.equal('layout.radius' in s.values, true);
		s = setValue(s, 'layout.radius', 6); // 6 is the manifest default
		assert.equal('layout.radius' in s.values, false);
		assert.equal(getValue(s, 'layout.radius'), 6);
	});

	test('every control id in the manifest round-trips through setValue/getValue for a non-default sample value', () => {
		for (const control of controls) {
			let sample;
			if (control.type === 'range') sample = control.default === control.max ? control.min : control.max;
			else if (control.type === 'toggle') sample = !control.default;
			else if (control.type === 'select' || control.type === 'font') {
				const other = control.options.find((o) => o.value !== control.default);
				sample = other ? other.value : control.default;
			} else sample = control.default === 'auto' ? '#123456' : control.default;

			const s = setValue(defaultState(), control.id, sample);
			assert.equal(getValue(s, control.id), sample, `round-trip failed for ${control.id}`);
		}
	});
});

describe('applyPreset', () => {
	test('resets values to the preset and preserves ia', () => {
		let s = defaultState();
		s = { ...s, ia: [{ type: 'link', id: 'x', label: 'X', href: '/x' }] };
		s = setValue(s, 'layout.radius', 20);
		s = applyPreset(s, 'ocean');
		assert.equal(s.preset, 'ocean');
		assert.equal(getValue(s, 'layout.radius'), 6); // back to default; ocean doesn't set it
		assert.equal(getValue(s, 'color.accent.hue'), 240); // ocean's value
		assert.deepEqual(s.ia, [{ type: 'link', id: 'x', label: 'X', href: '/x' }]);
	});

	test('every preset id in presets.js is applicable', () => {
		for (const preset of presets) {
			const s = applyPreset(defaultState(), preset.id);
			assert.equal(s.preset, preset.id);
		}
	});
});

describe('encodeState / decodeState', () => {
	test('round-trips a non-trivial state', () => {
		let s = defaultState();
		s = setValue(s, 'color.accent.hue', 12);
		s = setValue(s, 'sidebar.activeStyle', 'tinted');
		s = { ...s, ia: [{ type: 'autogenerate', id: 'g', directory: 'guides' }] };

		const encoded = encodeState(s);
		assert.equal(typeof encoded, 'string');
		// URL-safe: no '+', '/', or '=' padding.
		assert.equal(/[+/=]/.test(encoded), false);

		const decoded = decodeState(encoded);
		assert.equal(decoded.v, 1);
		assert.equal(decoded.starlight, STARLIGHT_VERSION);
		assert.equal(decoded.preset, s.preset);
		assert.deepEqual(decoded.values, s.values);
		assert.deepEqual(decoded.ia, s.ia);
	});

	test('decodeState is tolerant of garbage input', () => {
		for (const garbage of ['', 'not-base64-!!!', 'eyJub3QiOiJhIHZhbGlkIHN0YXRlIn0', null, undefined]) {
			const decoded = decodeState(garbage);
			assert.deepEqual(decoded, defaultState());
		}
	});

	test('decodeState tolerates a well-formed but foreign JSON payload', () => {
		const encoded = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8')
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
		const decoded = decodeState(encoded);
		assert.equal(decoded.preset, 'starlight-default');
		assert.deepEqual(decoded.values, {});
		assert.equal(decoded.ia, null);
	});

	test('decodeState tolerates a legacy payload stamped starlight: "0.42.3" (a pre-upgrade saved state or share-link hash) and decodes to the same theme', () => {
		// decodeState never reads `starlight` off the payload at all (encodeState doesn't even emit
		// it - see the round-trip test above); this proves that holds even when an old payload
		// *does* carry a stale version stamp. `panel.js`'s `importStateFromJson` (the separate,
		// DOM-bound path for an imported `state.json` file) has the same discard-and-restamp
		// behavior - it reads `base.starlight`, never `parsed.starlight` - but it isn't a pure
		// function and isn't covered here; that path was verified by reading, not by test. The
		// theme itself - preset, values, ia, name - must survive the upgrade unchanged, and the
		// decoded state must carry the CURRENT constant, not the stale one and not a rejection.
		const legacyPayload = JSON.stringify({
			v: 1,
			starlight: '0.42.3',
			preset: 'ocean',
			values: { 'layout.radius': 20, 'sidebar.activeStyle': 'tinted' },
			ia: [{ type: 'autogenerate', id: 'g', directory: 'guides' }],
			meta: { name: 'Pre-upgrade theme' },
		});
		const encoded = Buffer.from(legacyPayload, 'utf8')
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');

		const decoded = decodeState(encoded);
		assert.equal(decoded.starlight, STARLIGHT_VERSION);
		assert.notEqual(decoded.starlight, '0.42.3');
		assert.equal(decoded.preset, 'ocean');
		assert.deepEqual(decoded.values, { 'layout.radius': 20, 'sidebar.activeStyle': 'tinted' });
		assert.deepEqual(decoded.ia, [{ type: 'autogenerate', id: 'g', directory: 'guides' }]);
		assert.equal(decoded.meta.name, 'Pre-upgrade theme');
	});
});

describe('snapToStep', () => {
	test('snaps a back-solved hue onto a whole-degree step', () => {
		assert.equal(snapToStep(276.50971, 1), 277);
		assert.equal(snapToStep(276.4999, 1), 276);
	});

	test('rounds away float noise on a fractional step', () => {
		assert.equal(snapToStep(0.0149, 0.005), 0.015);
		assert.equal(snapToStep(0.01243, 0.001), 0.012);
		assert.equal(snapToStep(0.1 + 0.2, 0.1), 0.3);
	});

	test('anchors the grid at min', () => {
		assert.equal(snapToStep(2.7, 0.5, 2), 2.5);
		assert.equal(snapToStep(2.8, 0.5, 2), 3);
	});

	test('returns the value unchanged without a usable step', () => {
		assert.equal(snapToStep(1.23456, undefined), 1.23456);
		assert.equal(snapToStep(1.23456, 0), 1.23456);
	});

	test('every range control with a step snaps its own default to itself', () => {
		for (const c of controls.filter((c) => c.type === 'range' && c.step > 0)) {
			assert.equal(snapToStep(c.default, c.step, c.min), c.default, c.id);
		}
	});
});
