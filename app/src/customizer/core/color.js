/**
 * @file Port of Starlight's official theme designer color algorithm
 * (`color-lib.ts` + `store.ts` in `docs/src/components/theme-designer/` of withastro/starlight, MIT,
 * https://github.com/withastro/starlight/tree/main/docs/src/components/theme-designer) to plain
 * DOM-free ESM JS. Produces the same dark/light hex palettes from accent/gray hue+chroma pairs
 * that the official `@astrojs/starlight` docs theme designer produces. Importable from Node
 * (`node --test`) and from the browser via Vite; only depends on `culori/fn`.
 *
 * This is a *port*, not a reinterpretation: the numeric constants (lightness stops, chroma
 * dividers, contrast-nudge increment, contrast-check pairs) are copied verbatim from the
 * reference so generated palettes match the official designer exactly for the same inputs.
 */
import {
	clampChroma,
	formatHex,
	modeHsl,
	modeLrgb,
	modeOklch,
	modeRgb,
	useMode,
	wcagContrast,
} from 'culori/fn';

const rgb = useMode(modeRgb);
export const oklch = useMode(modeOklch);
// Initialise LRGB support, required internally by culori's `wcagContrast()`.
useMode(modeLrgb);
// Item 4 (color picker): registers the hsl color model so `hsl(hexString)` below can parse a
// picked hex into hue/saturation/lightness - Starlight's five semantic hues are literal HSL hue
// angles (`--sl-hue-orange: 41`, used as `hsl(var(--sl-hue-orange), S%, L%)`), so recovering "what
// hue is this hex" needs HSL, not OKLCH.
const hsl = useMode(modeHsl);

/** WCAG AA contrast threshold, as used by the "AA" contrast-floor option. */
export const CONTRAST_AA = 4.5;
/** WCAG AAA contrast threshold, as used by the "AAA" contrast-floor option. */
export const CONTRAST_AAA = 7;

/**
 * Convert a culori OKLCH color object to an RGB hex code.
 * @param {import('culori').Oklch} okLchColor
 * @returns {string}
 */
function oklchColorToHex(okLchColor) {
	const rgbColor = rgb(clampChroma(okLchColor, 'oklch'));
	return formatHex(rgbColor);
}

/**
 * Construct a culori OKLCH color object from LCH parameters.
 * @param {number} l Lightness, 0-100 (percent).
 * @param {number} c Chroma.
 * @param {number} h Hue, degrees.
 * @returns {import('culori').Oklch}
 */
function oklchColorFromParts(l, c, h) {
	return oklch(`oklch(${l}% ${c} ${h})`);
}

/**
 * Convert OKLCH parameters directly to an RGB hex code.
 * @param {number} l Lightness, 0-100 (percent).
 * @param {number} c Chroma.
 * @param {number} h Hue, degrees.
 * @returns {string}
 */
export function oklchToHex(l, c, h) {
	return oklchColorToHex(oklchColorFromParts(l, c, h));
}

/**
 * Ensure a text colour passes a contrast threshold against a specific background colour.
 * If necessary, colours will be darkened/lightened to increase contrast until the threshold is
 * passed. Ported verbatim (including the effectively-non-binding `l < 100 && l > 0` bounds,
 * which are inert here because culori stores OKLCH lightness as a 0-1 fraction, not 0-100 - kept
 * as-is for fidelity with the official designer).
 * @param {import('culori').Oklch} text The text colour to adjust if necessary.
 * @param {import('culori').Oklch} bg The background colour to test contrast against.
 * @param {number} [threshold] The minimum contrast ratio required. Defaults to `4.5` (WCAG AA).
 * @returns {import('culori').Oklch}
 */
function contrastColor(text, bg, threshold = CONTRAST_AA) {
	const fgColor = { ...text };
	// Brighten text in dark mode, darken text in light mode.
	const increment = fgColor.l > bg.l ? 0.005 : -0.005;
	while (wcagContrast(fgColor, bg) < threshold && fgColor.l < 100 && fgColor.l > 0) {
		fgColor.l += increment;
	}
	return fgColor;
}

/**
 * @typedef {{hue: number, chroma: number}} HueChroma
 * @typedef {{
 *   'accent-low': string, accent: string, 'accent-high': string,
 *   white: string, 'gray-1': string, 'gray-2': string, 'gray-3': string, 'gray-4': string,
 *   'gray-5': string, 'gray-6': string, 'gray-7'?: string, black: string,
 * }} HexPalette
 */

/**
 * Generate dark and light palettes based on user-selected accent/gray hue and chroma values.
 * Exact port of the official Starlight theme designer's `getPalettes()`.
 * @param {{accent: HueChroma, gray: HueChroma, minimumContrast?: number}} config
 * @returns {{dark: HexPalette, light: HexPalette}}
 */
export function getPalettes(config) {
	const {
		accent: { hue: ah, chroma: ac },
		gray: { hue: gh, chroma: gc },
		minimumContrast: mc,
	} = config;

	const palettes = {
		dark: {
			'accent-low': oklchColorFromParts(25.94, ac / 3, ah),
			accent: oklchColorFromParts(52.28, ac, ah),
			'accent-high': oklchColorFromParts(83.38, ac / 3, ah),
			white: oklchColorFromParts(100, 0, 0),
			'gray-1': oklchColorFromParts(94.77, gc / 2.5, gh),
			'gray-2': oklchColorFromParts(81.34, gc / 2, gh),
			'gray-3': oklchColorFromParts(63.78, gc, gh),
			'gray-4': oklchColorFromParts(46.01, gc, gh),
			'gray-5': oklchColorFromParts(34.09, gc, gh),
			'gray-6': oklchColorFromParts(27.14, gc, gh),
			black: oklchColorFromParts(20.94, gc / 2, gh),
		},
		light: {
			'accent-low': oklchColorFromParts(87.81, ac / 4, ah),
			accent: oklchColorFromParts(52.95, ac, ah),
			'accent-high': oklchColorFromParts(31.77, ac / 2, ah),
			white: oklchColorFromParts(20.94, gc / 2, gh),
			'gray-1': oklchColorFromParts(27.14, gc, gh),
			'gray-2': oklchColorFromParts(34.09, gc, gh),
			'gray-3': oklchColorFromParts(46.01, gc, gh),
			'gray-4': oklchColorFromParts(63.78, gc, gh),
			'gray-5': oklchColorFromParts(81.34, gc / 2, gh),
			'gray-6': oklchColorFromParts(94.77, gc / 2.5, gh),
			'gray-7': oklchColorFromParts(97.35, gc / 5, gh),
			black: oklchColorFromParts(100, 0, 0),
		},
	};

	// Ensure text shades have sufficient contrast against common background colours.

	// Dark mode:
	palettes.dark['gray-2'] = contrastColor(palettes.dark['gray-2'], palettes.dark['gray-5'], mc);
	palettes.dark['gray-3'] = contrastColor(palettes.dark['gray-3'], palettes.dark.black, mc);

	// Light mode:
	palettes.light.accent = contrastColor(palettes.light.accent, palettes.light['gray-6'], mc);
	palettes.light['gray-2'] = contrastColor(palettes.light['gray-2'], palettes.light['gray-6'], mc);
	palettes.light['gray-3'] = contrastColor(palettes.light['gray-3'], palettes.light.black, mc);

	return {
		dark: Object.fromEntries(
			Object.entries(palettes.dark).map(([key, color]) => [key, oklchColorToHex(color)])
		),
		light: Object.fromEntries(
			Object.entries(palettes.light).map(([key, color]) => [key, oklchColorToHex(color)])
		),
	};
}

/**
 * A preset's own LIGHT palette (`getPalettes`). The studio's preset cards draw their anchor and
 * swatch strip from it, and the product page (`src/pages/index.astro`) draws its preset chips from
 * it at build time, so both show the same color for each preset.
 * @param {{values?: Record<string, any>}} preset A preset from `presets.js`.
 * @returns {HexPalette}
 */
export function getPresetLightPalette(preset) {
	const v = preset.values ?? {};
	const accentHue = v['color.accent.hue'] ?? 269;
	const accentChroma = v['color.accent.chroma'] ?? 0.27;
	const grayHue = v['color.gray.hue'] ?? 270;
	const grayChroma = v['color.gray.chroma'] ?? 0.016;
	return getPalettes({
		accent: { hue: accentHue, chroma: accentChroma },
		gray: { hue: grayHue, chroma: grayChroma },
		minimumContrast: v['color.contrastFloor'] === 'aaa' ? 7 : 4.5,
	}).light;
}

/**
 * WCAG contrast ratio between two hex colors (for the panel's live contrast readout).
 * @param {string} hexA
 * @param {string} hexB
 * @returns {number}
 */
export function contrastRatio(hexA, hexB) {
	return wcagContrast(hexA, hexB);
}

/**
 * Item 4 (color picker, accent/gray): recovers the OKLCH hue and chroma a picked hex would need to
 * feed back into `getPalettes()` to reproduce (approximately) that color. Lightness is deliberately
 * discarded - the whole point of `getPalettes()` is that lightness is tuned per role (sidebar pill
 * vs body text vs low/high accent) to stay readable, not something the picker should set directly.
 * @param {string} hex
 * @returns {{hue: number, chroma: number}} `hue` is 0 for a fully achromatic pick (culori returns
 *   `undefined` hue for zero chroma - there's no meaningful hue to recover).
 */
export function hexToOklchHueChroma(hex) {
	const c = oklch(hex);
	return { hue: c?.h ?? 0, chroma: c?.c ?? 0 };
}

/**
 * Item 4 (color picker, semantic hues): recovers the HSL hue a picked hex would need to reproduce
 * that color through Starlight's own `hsl(var(--sl-hue-orange), S%, L%)` formula (props.css) - only
 * the hue angle is meaningful here (Starlight hardcodes S/L per role), so saturation/lightness are
 * discarded.
 * @param {string} hex
 * @returns {number} Hue in degrees, 0 for an achromatic pick.
 */
export function hexToHslHue(hex) {
	return hsl(hex)?.h ?? 0;
}

/**
 * The color popover's RGB and HSL modes (the format switch Chrome's native picker had) read and
 * write whole numbers through these four helpers: RGB channels 0-255, HSL hue 0-359 degrees, and
 * saturation and lightness 0-100 percent. Hex stays the hand-off format either way.
 */
/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clampRange(v, lo, hi) {
	return Math.min(hi, Math.max(lo, v));
}

/**
 * @param {string} hex
 * @returns {{r: number, g: number, b: number} | null} `null` if `hex` does not parse.
 */
export function hexToRgbChannels(hex) {
	const c = rgb(hex);
	if (!c) return null;
	return { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
}

/**
 * @param {{r: number, g: number, b: number}} channels Each 0-255; out-of-range values are clamped.
 * @returns {string | null} Lowercase `#rrggbb`, or `null` if any channel is not a finite number.
 */
export function rgbChannelsToHex({ r, g, b }) {
	if (![r, g, b].every(Number.isFinite)) return null;
	const [rr, gg, bb] = [r, g, b].map((v) => clampRange(Math.round(v), 0, 255) / 255);
	return formatHex({ mode: 'rgb', r: rr, g: gg, b: bb });
}

/**
 * @param {string} hex
 * @returns {{h: number, s: number, l: number} | null} `h` is 0 for an achromatic color (culori
 *   leaves its hue undefined); `null` if `hex` does not parse.
 */
export function hexToHslChannels(hex) {
	const c = hsl(hex);
	if (!c) return null;
	return { h: Math.round(c.h ?? 0) % 360, s: Math.round(c.s * 100), l: Math.round(c.l * 100) };
}

/**
 * @param {{h: number, s: number, l: number}} channels Hue in degrees (wrapped into 0-359),
 *   saturation and lightness in percent (clamped to 0-100).
 * @returns {string | null} Lowercase `#rrggbb`, or `null` if any channel is not a finite number.
 */
export function hslChannelsToHex({ h, s, l }) {
	if (![h, s, l].every(Number.isFinite)) return null;
	const hue = ((h % 360) + 360) % 360;
	return formatHex(rgb({ mode: 'hsl', h: hue, s: clampRange(s, 0, 100) / 100, l: clampRange(l, 0, 100) / 100 }));
}
