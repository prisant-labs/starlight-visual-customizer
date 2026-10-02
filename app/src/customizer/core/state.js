/**
 * @file Immutable theme state helpers. DOM-free; works in Node and the browser (`encodeState`/
 * `decodeState` use `btoa`/`atob`, both available in Node 22 globals and every browser).
 */
import { controls } from './manifest.js';
import { presets } from './presets.js';
import { STARLIGHT_VERSION } from './version.js';

/**
 * @typedef {{type:'link', id:string, label:string, slug?:string, href?:string,
 *   badge?:{text:string, variant:'note'|'tip'|'caution'|'danger'|'success'|'default'}, hidden?:boolean}
 *   | {type:'group', id:string, label:string, collapsed?:boolean, badge?:object, items: any[]}
 *   | {type:'autogenerate', id:string, label?:string, directory:string, collapsed?:boolean}
 * } SidebarItem
 */

/**
 * @typedef {{
 *  v: 1,
 *  starlight: '0.42.4',
 *  preset: string,
 *  values: Record<string, any>,
 *  ia: SidebarItem[] | null,
 *  meta: {name: string},
 * }} ThemeState
 */

const DEFAULT_THEME_NAME = 'Untitled theme';

/** @type {Map<string, import('./manifest.js').Control>} */
const controlsById = new Map(controls.map((c) => [c.id, c]));

/**
 * @returns {ThemeState} A fresh state at the 'starlight-default' preset: empty `values` (every
 *   control reads its manifest default), no sidebar override.
 */
export function defaultState() {
	return {
		v: 1,
		starlight: STARLIGHT_VERSION,
		preset: 'starlight-default',
		values: {},
		ia: null,
		meta: { name: DEFAULT_THEME_NAME },
	};
}

/**
 * The theme name lives in `state.meta.name`, editable in the top bar. Emitted CSS
 * never reads `meta` (emit-css.js is untouched by this - its golden files stay byte-identical), so
 * this only affects the export dialog's `state.json` tab and the top bar's own input.
 * @param {ThemeState} state
 * @param {string} name
 * @returns {ThemeState}
 */
export function setName(state, name) {
	return { ...state, meta: { ...state.meta, name: typeof name === 'string' && name.trim() ? name : DEFAULT_THEME_NAME } };
}

/** @param {ThemeState} state @returns {string} */
export function getName(state) {
	return (state && state.meta && typeof state.meta.name === 'string' && state.meta.name) || DEFAULT_THEME_NAME;
}

/**
 * @param {ThemeState} state
 * @param {string} id Control id.
 * @returns {any} The explicit value in `state.values`, or the control's manifest default.
 *   `undefined` if `id` names no known control and has no explicit value.
 */
export function getValue(state, id) {
	if (state && state.values && Object.prototype.hasOwnProperty.call(state.values, id)) {
		return state.values[id];
	}
	const control = controlsById.get(id);
	return control ? control.default : undefined;
}

/**
 * @param {ThemeState} state
 * @param {string} id Control id.
 * @param {any} value
 * @returns {ThemeState} A new state object (input is not mutated). Setting a value equal to the
 *   control's manifest default removes the key instead of storing it, so `state.values` only
 *   ever holds genuine non-default overrides (keeps `encodeState` minimal and canonical).
 */
export function setValue(state, id, value) {
	const nextValues = { ...state.values };
	const control = controlsById.get(id);
	const isDefault = control ? deepEqual(value, control.default) : false;
	if (isDefault) {
		delete nextValues[id];
	} else {
		nextValues[id] = value;
	}
	return { ...state, values: nextValues };
}

/**
 * Snaps a computed value onto a range control's own step grid, the values its slider can produce.
 * A back-solve (a typed hex or an eyedropper pick turned into hue and chroma) yields raw floats
 * such as 276.50971; storing those would show the float in the number box, the exported CSS and the
 * share link. The result is rounded to the step's decimal count too, so a 0.005 step gives 0.015,
 * never 0.015000000000000001.
 * @param {number} value
 * @param {number} [step] The control's `step`; a missing or non-positive step returns `value`.
 * @param {number} [min] The grid's origin (the control's `min`), so a grid that starts at, say, 2
 *   snaps to 2, 2.5, 3 rather than to multiples of the step from zero.
 * @returns {number}
 */
export function snapToStep(value, step, min = 0) {
	if (!(step > 0) || !Number.isFinite(value)) return value;
	const decimals = (String(step).split('.')[1] ?? '').length;
	const snapped = min + Math.round((value - min) / step) * step;
	return Number(snapped.toFixed(decimals));
}

/**
 * @param {ThemeState} state
 * @param {string} presetId Id of an entry in `presets.js`'s `presets` export.
 * @returns {ThemeState} A new state with `values` replaced by the preset's values (defaults for
 *   anything the preset doesn't mention) and `preset` set to `presetId`. `state.ia` is preserved.
 *   Unknown `presetId` resets to empty values (i.e. all-defaults) under that id. Any preset value
 *   that happens to equal the manifest default for its control is dropped (same canonicalization
 *   `setValue` applies), so `state.values` and `encodeState` only ever carry genuine overrides.
 */
export function applyPreset(state, presetId) {
	const preset = presets.find((p) => p.id === presetId);
	/** @type {Record<string, any>} */
	const values = {};
	if (preset) {
		for (const [id, value] of Object.entries(preset.values)) {
			const control = controlsById.get(id);
			if (!control || !deepEqual(value, control.default)) values[id] = value;
		}
	}
	return { ...state, preset: presetId, values };
}

/**
 * @param {ThemeState} state
 * @returns {string} Compact URL-safe encoding: base64url of the JSON of `{v, preset, values, ia}`
 *   (the `starlight` field is not encoded; decode re-stamps the current constant).
 */
export function encodeState(state) {
	const payload = JSON.stringify({
		v: state.v,
		preset: state.preset,
		values: state.values,
		ia: state.ia,
		// S13: only a non-default name is worth the bytes in a share link/localStorage; a state
		// saved before `meta` existed (or with the default name) decodes back to the same default -
		// see decodeState below - so this is backward AND forward compatible.
		meta: getName(state) !== DEFAULT_THEME_NAME ? { name: getName(state) } : undefined,
	});
	const bytes = new TextEncoder().encode(payload);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const base64 = btoa(binary);
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} str
 * @returns {ThemeState} Tolerant: any parse failure (bad base64, bad JSON, wrong shape) falls
 *   back to `defaultState()` rather than throwing.
 */
export function decodeState(str) {
	return tryDecodeState(str) ?? defaultState();
}

/**
 * Strict sibling of `decodeState`, for callers that must tell a broken encoding apart from a real
 * theme - a share link cut off in transit decodes to `null` here, where `decodeState` would hand
 * back the defaults and the caller would save them over the visitor's own theme.
 * @param {string} str
 * @returns {ThemeState | null} `null` when `str` is not base64url of a JSON object.
 */
export function tryDecodeState(str) {
	try {
		const base64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		const payload = JSON.parse(new TextDecoder().decode(bytes));
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
		return {
			v: 1,
			starlight: STARLIGHT_VERSION,
			preset: typeof payload.preset === 'string' ? payload.preset : 'starlight-default',
			values:
				payload.values && typeof payload.values === 'object' && !Array.isArray(payload.values)
					? payload.values
					: {},
			ia: Array.isArray(payload.ia) ? payload.ia : null,
			meta: { name: (payload.meta && typeof payload.meta.name === 'string' && payload.meta.name) || DEFAULT_THEME_NAME },
		};
	} catch {
		return null;
	}
}

/**
 * True when two states describe the same theme: preset, values, sidebar structure and name.
 * `v` and `starlight` are ignored (decode re-stamps both), and key order inside `values` never
 * matters.
 * @param {ThemeState} a
 * @param {ThemeState} b
 * @returns {boolean}
 */
export function sameTheme(a, b) {
	return a.preset === b.preset && deepEqual(a.values, b.values) && deepEqual(a.ia, b.ia) && getName(a) === getName(b);
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a && b && typeof a === 'object') {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every((k) => deepEqual(a[k], b[k]));
	}
	return false;
}
