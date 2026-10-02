import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SIZING_STEPS, DEFAULT_SIZING, SIZING_NARROW_BELOW, normalizeSizing, nextSizing, effectiveSizing, formatSizing } from '../../src/customizer/core/sizing.js';

describe('normalizeSizing', () => {
	test('keeps every known step, from a number or a stored string', () => {
		for (const step of SIZING_STEPS) {
			assert.equal(normalizeSizing(step), step);
			assert.equal(normalizeSizing(String(step)), step);
		}
	});

	test('falls back to 100% for missing, garbage or unknown values', () => {
		for (const bad of [null, undefined, '', 'big', NaN, 0, 0.85, 2, '1.5']) {
			assert.equal(normalizeSizing(bad), DEFAULT_SIZING, String(bad));
		}
	});
});

describe('nextSizing', () => {
	test('steps up and down one step at a time', () => {
		assert.equal(nextSizing(1, 1), 1.1);
		assert.equal(nextSizing(1, -1), 0.9);
		assert.equal(nextSizing(0.9, -1), 0.8);
	});

	test('clamps at both ends', () => {
		assert.equal(nextSizing(SIZING_STEPS[0], -1), SIZING_STEPS[0]);
		assert.equal(nextSizing(SIZING_STEPS[SIZING_STEPS.length - 1], 1), SIZING_STEPS[SIZING_STEPS.length - 1]);
	});

	test('steps from 100% when the current value is unknown', () => {
		assert.equal(nextSizing('garbage', 1), 1.1);
	});
});

describe('formatSizing', () => {
	test('shows whole percentages', () => {
		assert.deepEqual(SIZING_STEPS.map(formatSizing), ['80%', '90%', '100%', '110%', '120%']);
	});
});

describe('effectiveSizing', () => {
	test('applies the chosen size in a wide window', () => {
		for (const step of SIZING_STEPS) assert.equal(effectiveSizing(step, SIZING_NARROW_BELOW), step);
	});

	test('caps sizes above 100% in a narrow window, and keeps smaller sizes', () => {
		const narrow = SIZING_NARROW_BELOW - 1;
		assert.equal(effectiveSizing(1.2, narrow), 1);
		assert.equal(effectiveSizing(1.1, narrow), 1);
		assert.equal(effectiveSizing(0.9, narrow), 0.9);
		assert.equal(effectiveSizing(0.8, 390), 0.8);
	});
});
