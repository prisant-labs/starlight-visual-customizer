/**
 * @file Which theme the customizer opens with when a share link (`#svc=...`) may compete with the
 * theme this browser already saved. Pure decision only; `ui/panel.js` reads the hash and storage,
 * applies the result, and asks the visitor through `ui/share-dialog.js` when the result says so.
 */
import { defaultState, decodeState, tryDecodeState, sameTheme } from './state.js';

/** The hash prefix a share link carries its encoded theme behind. */
export const SHARE_HASH_PREFIX = '#svc=';

/**
 * @typedef {{
 *   state: import('./state.js').ThemeState,
 *   pendingShared: import('./state.js').ThemeState | null,
 *   damaged: boolean,
 * }} InitialTheme
 * `state` is the theme to open with. `pendingShared` is set when a share link carries a theme
 * that differs from real work saved here: the visitor is asked before it replaces `state`.
 * `damaged` is set when the link's theme cannot be read; `state` is then the saved theme.
 */

/**
 * A share link replaces the saved theme without asking only when nothing worth keeping is saved:
 * no saved theme, the defaults (every first studio visit saves those), or the very same theme.
 * @param {string} hash `location.hash`, possibly empty.
 * @param {string | null} stored The saved encoded theme, or `null` when none is saved.
 * @returns {InitialTheme}
 */
export function resolveInitialTheme(hash, stored) {
	const saved = stored ? decodeState(stored) : null;
	const fallback = saved ?? defaultState();
	if (typeof hash !== 'string' || !hash.startsWith(SHARE_HASH_PREFIX)) {
		return { state: fallback, pendingShared: null, damaged: false };
	}
	const shared = tryDecodeState(hash.slice(SHARE_HASH_PREFIX.length));
	if (!shared) return { state: fallback, pendingShared: null, damaged: true };
	if (!saved || sameTheme(saved, defaultState()) || sameTheme(saved, shared)) {
		return { state: shared, pendingShared: null, damaged: false };
	}
	return { state: saved, pendingShared: shared, damaged: false };
}
