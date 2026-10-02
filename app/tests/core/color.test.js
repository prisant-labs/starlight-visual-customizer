import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
	getPalettes,
	getPresetLightPalette,
	oklchToHex,
	contrastRatio,
	CONTRAST_AA,
	CONTRAST_AAA,
	hexToRgbChannels,
	rgbChannelsToHex,
	hexToHslChannels,
	hslChannelsToHex,
} from '../../src/customizer/core/color.js';

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

describe('getPresetLightPalette', () => {
	test('a preset with no values gets the default light palette', () => {
		const expected = getPalettes({ accent: { hue: 269, chroma: 0.27 }, gray: { hue: 270, chroma: 0.016 }, minimumContrast: CONTRAST_AA }).light;
		assert.deepEqual(getPresetLightPalette({ values: {} }), expected);
		assert.deepEqual(getPresetLightPalette({}), expected);
	});

	test("a preset's own accent hue and chroma change its accent", () => {
		const base = getPresetLightPalette({ values: {} });
		const ocean = getPresetLightPalette({ values: { 'color.accent.hue': 240, 'color.accent.chroma': 0.27 } });
		assert.notEqual(ocean.accent, base.accent);
	});
});

describe('color popover channels (RGB and HSL modes)', () => {
	test('hex and RGB channels round-trip exactly', () => {
		assert.deepEqual(hexToRgbChannels('#08090f'), { r: 8, g: 9, b: 15 });
		assert.equal(rgbChannelsToHex({ r: 8, g: 9, b: 15 }), '#08090f');
		assert.equal(rgbChannelsToHex({ r: 68, g: 83, b: 201 }), '#4453c9');
	});

	test('RGB channels clamp and round', () => {
		assert.equal(rgbChannelsToHex({ r: 300, g: -5, b: 127.6 }), '#ff0080');
	});

	test('hex to HSL gives whole numbers, with hue 0 for grays', () => {
		assert.deepEqual(hexToHslChannels('#ff0000'), { h: 0, s: 100, l: 50 });
		assert.deepEqual(hexToHslChannels('#808080'), { h: 0, s: 0, l: 50 });
	});

	test('HSL channels to hex, wrapping hue and clamping percentages', () => {
		assert.equal(hslChannelsToHex({ h: 0, s: 100, l: 50 }), '#ff0000');
		assert.equal(hslChannelsToHex({ h: 360, s: 100, l: 50 }), '#ff0000');
		assert.equal(hslChannelsToHex({ h: 120, s: 150, l: 50 }), '#00ff00');
	});

	test('non-numeric channels and unparseable hex return null', () => {
		assert.equal(rgbChannelsToHex({ r: NaN, g: 0, b: 0 }), null);
		assert.equal(hslChannelsToHex({ h: 10, s: undefined, l: 50 }), null);
		assert.equal(hexToRgbChannels('not a color'), null);
		assert.equal(hexToHslChannels('not a color'), null);
	});
});
