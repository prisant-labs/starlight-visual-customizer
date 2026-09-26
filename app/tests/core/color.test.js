import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getPalettes, oklchToHex, contrastRatio, CONTRAST_AA, CONTRAST_AAA } from '../../src/customizer/core/color.js';

describe('oklchToHex', () => {
	test('produces a 6-digit lowercase hex color', () => {
		const hex = oklchToHex(52.28, 0.266, 268.7);
		assert.match(hex, /^#[0-9a-f]{6}$/);
	});
});

describe('getPalettes', () => {
	const config = { accent: { hue: 269, chroma: 0.27 }, gray: { hue: 270, chroma: 0.016 }, minimumContrast: CONTRAST_AA };

	test('returns dark and light palettes with the documented keys', () => {
		const { dark, light } = getPalettes(config);
		for (const key of ['accent-low', 'accent', 'accent-high', 'white', 'gray-1', 'gray-2', 'gray-3', 'gray-4', 'gray-5', 'gray-6', 'black']) {
			assert.match(dark[key], /^#[0-9a-f]{6}$/, `dark.${key}`);
			assert.match(light[key], /^#[0-9a-f]{6}$/, `light.${key}`);
		}
		// gray-7 is light-mode only, per the reference algorithm.
		assert.equal('gray-7' in dark, false);
		assert.match(light['gray-7'], /^#[0-9a-f]{6}$/);
	});

	test('is a pure function: identical input produces identical output', () => {
		const a = getPalettes(config);
		const b = getPalettes(config);
		assert.deepEqual(a, b);
	});

	test('the contrast floor is respected: dark gray-2 vs gray-5 meets the requested minimum', () => {
		const { dark } = getPalettes({ ...config, minimumContrast: CONTRAST_AA });
		assert.ok(contrastRatio(dark['gray-2'], dark['gray-5']) >= CONTRAST_AA - 0.05);
	});

	test('a stricter (AAA) contrast floor never produces lower contrast than AA for the same hue/chroma', () => {
		const aa = getPalettes({ ...config, minimumContrast: CONTRAST_AA });
		const aaa = getPalettes({ ...config, minimumContrast: CONTRAST_AAA });
		assert.ok(contrastRatio(aaa.dark['gray-2'], aaa.dark['gray-5']) >= contrastRatio(aa.dark['gray-2'], aa.dark['gray-5']) - 0.05);
	});

	test('changing hue changes the generated accent hex', () => {
		const a = getPalettes(config);
		const b = getPalettes({ ...config, accent: { hue: 120, chroma: 0.27 } });
		assert.notEqual(a.dark.accent, b.dark.accent);
	});

	test('zero chroma produces an achromatic (grayscale) accent', () => {
		const { dark } = getPalettes({ accent: { hue: 269, chroma: 0 }, gray: { hue: 270, chroma: 0 }, minimumContrast: CONTRAST_AA });
		const hex = dark.accent;
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1, `expected grayscale, got ${hex}`);
	});
});
