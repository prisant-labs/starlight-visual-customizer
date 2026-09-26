/**
 * @file The one indirection every PAGE-facing operation routes through (studio.astro's design
 * doc, item C). Two runtime shapes:
 *  - **Overlay mode** (today's behavior, any ordinary Starlight page): no `<iframe
 *    data-svc-preview>` exists in this document, so `getPageDoc()`/`getPageWin()` return the
 *    document/window this script is already running in - byte-identical to pre-studio behavior.
 *  - **Studio mode** (`src/pages/studio.astro`): `setFrameEl` is called once with the preview
 *    `<iframe>`, and `getPageDoc()`/`getPageWin()` from then on return that frame's *live*
 *    `contentDocument`/`contentWindow` - re-read on every call, never cached. `contentDocument`
 *    gets a fresh identity on every real frame navigation (panel.js's attach logic relies on
 *    exactly that to tell documents apart); `contentWindow` does NOT - an `<iframe>`'s
 *    `contentWindow` is a WindowProxy that keeps the SAME object identity across same-frame
 *    navigations, transparently reflecting whatever the CURRENT realm is (confirmed empirically -
 *    see the fix in `target-highlight.js`'s `bindFrameWindow` for a bug this caused when code
 *    assumed otherwise). Property access through it (`getPageWin().StarlightThemeProvider`, `new
 *    getPageWin().CSSStyleSheet()`) is always correctly live/current either way; only an IDENTITY
 *    comparison (`===`) on the window object across navigations is unsafe.
 *
 * A same-origin iframe can still throw reading `contentDocument`/`contentWindow` if the reader
 * navigates it somewhere that (however briefly) isn't same-origin-accessible (e.g. mid-navigation
 * to an external link, or a page that itself redirects off-origin before landing back) - both
 * getters swallow that and return `null`, and every call site is written to tolerate `null`
 * (mirrors the existing "an invalid selector must never throw into a control's event handler"
 * discipline already used elsewhere in this codebase, e.g. target-highlight.js).
 */

/** @type {HTMLIFrameElement | null} The PRIMARY lane - `getPageDoc()`/`getPageWin()` always resolve
 * against this one, single-lane or Split (SPEC-C S9: "getPageDoc() stays the primary lane"). */
let frameEl = null;
/** @type {HTMLIFrameElement[]} Every lane currently mounted (length 1 outside Split). Always
 * includes `frameEl` at index 0 when non-empty. */
let frameEls = [];

/** @param {HTMLIFrameElement} el */
export function setFrameEl(el) {
	setFrameEls(el ? [el] : []);
}

/**
 * SPEC-C S9: Split shows two lanes of the same page (left forced light, right forced dark) - every
 * PAGE-facing operation that must reach both (theming, the page switcher) uses `getPageDocs()`;
 * everything else (swatches/contrast resolution, tile samples, target highlighting) keeps using
 * `getPageDoc()`/`getPageWin()`/`getFrameEl()`, which stay pinned to `frames[0]`, the primary lane.
 * @param {HTMLIFrameElement[]} els
 */
export function setFrameEls(els) {
	frameEls = Array.isArray(els) ? els.filter(Boolean) : [];
	frameEl = frameEls[0] || null;
}

/** @returns {boolean} True once `setFrameEl(s)` has run with at least one frame (studio/docked mode), false in plain overlay mode. */
export function isStudio() {
	return frameEl != null;
}

/** @returns {HTMLIFrameElement | null} The primary lane's `<iframe>` element. */
export function getFrameEl() {
	return frameEl;
}

/** @returns {HTMLIFrameElement[]} Every mounted lane, primary first. Empty in overlay mode. */
export function getFrameEls() {
	return frameEls;
}

/** @returns {Document | null} The frame's current document in studio mode, `document` otherwise. */
export function getPageDoc() {
	if (!frameEl) return document;
	try {
		return frameEl.contentDocument;
	} catch {
		return null;
	}
}

/** @returns {(Window & typeof globalThis) | null} The frame's current window in studio mode, `window` otherwise. */
export function getPageWin() {
	if (!frameEl) return window;
	try {
		return frameEl.contentWindow;
	} catch {
		return null;
	}
}

/** @returns {Document[]} Every lane's current document (studio mode), or `[document]` in overlay
 * mode - S9's `getPageDocs()`. Skips a lane whose document isn't accessible right now (mid-navigation). */
export function getPageDocs() {
	if (!frameEls.length) return [document];
	const docs = [];
	for (const el of frameEls) {
		try {
			if (el.contentDocument) docs.push(el.contentDocument);
		} catch {
			/* skip - mid-navigation or momentarily inaccessible */
		}
	}
	return docs;
}
