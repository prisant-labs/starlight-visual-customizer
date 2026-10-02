/**
 * @file "Studio sizing": the zoom factor for the studio's own chrome (top bar, page toolbar,
 * context line, rail and panel), never the preview frames. Pure values and step logic only;
 * `ui/studio-sizing.js` applies them and `src/pages/studio.astro` reads them at build time for its
 * no-flash head script.
 */

/** The available sizes, as zoom factors, smallest first. 100% is today's size. */
export const SIZING_STEPS = [0.8, 0.9, 1, 1.1, 1.2];

export const DEFAULT_SIZING = 1;

/** Where the chosen size is kept. localStorage, not the session store `svc-ui` uses: a display
 * preference should survive a new tab or a new visit, like the theme itself. */
export const SIZING_STORAGE_KEY = 'svc-studio-sizing';

/** The custom property on `<html>` that studio.astro's CSS feeds to `zoom`. */
export const SIZING_CSS_VAR = '--svc-chrome-zoom';

/**
 * A stored or typed value, snapped to a known step; anything else (missing, garbage, a step that
 * no longer exists) falls back to 100%.
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeSizing(value) {
	const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
	return SIZING_STEPS.includes(n) ? n : DEFAULT_SIZING;
}

/**
 * The next size up (`direction` > 0) or down (`direction` < 0), clamped at both ends.
 * @param {unknown} current
 * @param {number} direction
 * @returns {number}
 */
export function nextSizing(current, direction) {
	const i = SIZING_STEPS.indexOf(normalizeSizing(current));
	const j = Math.min(SIZING_STEPS.length - 1, Math.max(0, i + Math.sign(direction)));
	return SIZING_STEPS[j];
}

/** Below this window width the studio uses its narrow layout (the panel becomes a drawer, and the
 * top bar sheds text to fit from 360px up). That layout has no room to spare, so sizes above 100%
 * do not apply there; smaller sizes still do. Matches the 900px breakpoint in studio.astro. */
export const SIZING_NARROW_BELOW = 900;

/**
 * The size actually applied: the chosen size, capped at 100% in a narrow window.
 * @param {unknown} chosen
 * @param {number} viewportWidth
 * @returns {number}
 */
export function effectiveSizing(chosen, viewportWidth) {
	const z = normalizeSizing(chosen);
	return viewportWidth < SIZING_NARROW_BELOW ? Math.min(z, DEFAULT_SIZING) : z;
}

/** @param {number} sizing @returns {string} e.g. "90%" */
export function formatSizing(sizing) {
	return `${Math.round(sizing * 100)}%`;
}
