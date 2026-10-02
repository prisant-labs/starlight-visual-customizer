/**
 * @file Applies "Studio sizing" (see `core/sizing.js`). studio.astro's CSS zooms the chrome by the
 * custom property `setChromeZoom` sets, and its head script sets it before the first paint. The
 * rail control in panel.js decides what to apply: it stores the CHOSEN size (`saveSizing`) and sets
 * the EFFECTIVE one (`effectiveSizing`, which caps sizes above 100% in a narrow window), so the
 * property always holds the zoom actually on screen.
 *
 * `getChromeZoom()` is for code that places something by measured screen position inside the
 * zoomed chrome. Under CSS `zoom`, `getBoundingClientRect()` reports on-screen pixels, but `top`,
 * `left`, `width`, `height` and `transform` lengths set on an element inside a zoomed ancestor are
 * multiplied by that zoom when drawn. So a position measured on screen must be divided by the zoom
 * before it is assigned (color-picker.js, target-highlight.js, ia-editor.js). Outside the studio
 * nothing sets the property, so the zoom reads as 1 and the division is a no-op.
 */
import { SIZING_STORAGE_KEY, SIZING_CSS_VAR, normalizeSizing } from '../core/sizing.js';

/** @returns {number} The stored size, snapped to a known step (100% when nothing usable is stored). */
export function loadSizing() {
	try {
		return normalizeSizing(localStorage.getItem(SIZING_STORAGE_KEY));
	} catch {
		return normalizeSizing(null);
	}
}

/** Remembers the chosen size. @param {number} sizing */
export function saveSizing(sizing) {
	try {
		localStorage.setItem(SIZING_STORAGE_KEY, String(sizing));
	} catch {
		/* storage blocked: the size still applies for this page view */
	}
}

/** Zooms the chrome by `zoom` - the effective size (`effectiveSizing`), not necessarily the chosen
 * one, because getChromeZoom() and the panel's viewport-unit lengths read this same property.
 * @param {number} zoom */
export function setChromeZoom(zoom) {
	document.documentElement.style.setProperty(SIZING_CSS_VAR, String(zoom));
}

/** @returns {number} The chrome's current zoom factor (1 outside the studio). */
export function getChromeZoom() {
	const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(SIZING_CSS_VAR));
	return value > 0 ? value : 1;
}
