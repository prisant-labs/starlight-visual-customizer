/**
 * @file Immutable theme state helpers. DOM-free; works in Node and the browser (`encodeState`/
 * `decodeState` use `btoa`/`atob`, both available in Node 22 globals and every browser).
 */
import { controls } from './manifest.js';
import { presets } from './presets.js';
import { STARLIGHT_VERSION } from './version.js';
import { isSafeDocPath, safeLinkAttrs, safeSingleLineHref, toSingleLine } from './ia.js';

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
 * the name reaches only the settings file, the download names that `export-files.js` derives from
 * it, and the top bar's own input.
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
		return sanitizeState(payload);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------------------------
// Sanitizing a theme from outside
// ---------------------------------------------------------------------------------------------

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const BADGE_VARIANTS = new Set(['note', 'tip', 'caution', 'danger', 'success', 'default']);
const MAX_NAME_LENGTH = 100;
const MAX_LABEL_LENGTH = 200;
const MAX_IA_DEPTH = 8;
const MAX_IA_ITEMS = 1000;

/** @param {unknown} value @returns {value is string} True for a `#rrggbb` hex color. */
export function isHexColor(value) {
	return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/**
 * One control value checked against its manifest entry, or `undefined` to drop it. A value of the
 * wrong type, or one no control of that kind can hold, is dropped. A finite number outside its
 * range is clamped, so a theme saved before a range changed still loads. It is not snapped to the
 * step grid: some presets sit between steps on purpose (a 1.333 type scale on a 0.01 grid).
 * @param {import('./manifest.js').Control} control
 * @param {unknown} value
 * @returns {any}
 */
function sanitizeValue(control, value) {
	switch (control.type) {
		case 'range': {
			if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
			return Math.min(control.max ?? Infinity, Math.max(control.min ?? -Infinity, value));
		}
		case 'select':
		case 'font':
			return (control.options ?? []).some((option) => option.value === value) ? value : undefined;
		case 'toggle':
			return typeof value === 'boolean' ? value : undefined;
		case 'color':
			return value === 'auto' || isHexColor(value) ? value : undefined;
		case 'text':
			return typeof value === 'string' ? toSingleLine(value, control.maxLength ?? MAX_LABEL_LENGTH) : undefined;
		default:
			return undefined;
	}
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A sidebar badge rebuilt from its known fields, or `undefined` when it is not a usable badge.
 * @param {unknown} badge
 */
function sanitizeBadge(badge) {
	if (!isPlainObject(badge) || typeof badge.text !== 'string' || !BADGE_VARIANTS.has(badge.variant)) return undefined;
	/** @type {{text: string, variant: string, class?: string}} */
	const out = { text: toSingleLine(badge.text, MAX_LABEL_LENGTH), variant: badge.variant };
	// Printed as an escaped JS string and set as a class attribute, so any one-line text is safe,
	// including utility classes such as `md:hidden`.
	if (typeof badge.class === 'string') out.class = toSingleLine(badge.class, MAX_LABEL_LENGTH);
	return out;
}

/** @param {unknown} translations @returns {Record<string, string> | undefined} */
function sanitizeTranslations(translations) {
	if (!isPlainObject(translations)) return undefined;
	/** @type {Record<string, string>} */
	const out = {};
	for (const [lang, label] of Object.entries(translations)) {
		if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang) && typeof label === 'string') out[lang] = toSingleLine(label, MAX_LABEL_LENGTH);
	}
	return out;
}

/**
 * One sidebar item rebuilt from the fields its type allows, or `null` to drop it. Only keys the
 * input had are written, so a well-formed item comes back deep-equal to itself.
 * @param {unknown} item
 * @param {number} depth
 * @param {{left: number}} budget Items still allowed in the whole tree.
 * @returns {SidebarItem | null}
 */
function sanitizeIaItem(item, depth, budget) {
	if (!isPlainObject(item) || typeof item.id !== 'string') return null;
	/** @type {Record<string, any>} */
	const out = { type: item.type, id: toSingleLine(item.id, MAX_LABEL_LENGTH) };
	const copyLabel = () => {
		if (typeof item.label === 'string') out.label = toSingleLine(item.label, MAX_LABEL_LENGTH);
	};
	const copyCommon = () => {
		if ('badge' in item) {
			const badge = sanitizeBadge(item.badge);
			if (badge) out.badge = badge;
		}
		if ('translations' in item) {
			const translations = sanitizeTranslations(item.translations);
			if (translations) out.translations = translations;
		}
	};
	if (item.type === 'link') {
		copyLabel();
		if (typeof out.label !== 'string') return null;
		if ('slug' in item && isSafeDocPath(item.slug)) out.slug = item.slug;
		if ('href' in item && typeof item.href === 'string') out.href = safeSingleLineHref(item.href);
		if (out.slug === undefined && out.href === undefined) return null;
		copyCommon();
		if (typeof item.hidden === 'boolean') out.hidden = item.hidden;
		if ('attrs' in item) out.attrs = safeLinkAttrs(item.attrs);
		return /** @type {SidebarItem} */ (out);
	}
	if (item.type === 'group') {
		copyLabel();
		if (typeof out.label !== 'string') return null;
		if (typeof item.collapsed === 'boolean') out.collapsed = item.collapsed;
		copyCommon();
		out.items = Array.isArray(item.items) && depth < MAX_IA_DEPTH ? sanitizeIaItems(item.items, depth + 1, budget) : [];
		return /** @type {SidebarItem} */ (out);
	}
	if (item.type === 'autogenerate') {
		if (!isSafeDocPath(item.directory)) return null;
		copyLabel();
		out.directory = item.directory;
		if (typeof item.collapsed === 'boolean') out.collapsed = item.collapsed;
		if ('attrs' in item) out.attrs = safeLinkAttrs(item.attrs);
		return /** @type {SidebarItem} */ (out);
	}
	return null;
}

/**
 * @param {unknown[]} items
 * @param {number} depth
 * @param {{left: number}} budget
 * @returns {SidebarItem[]}
 */
function sanitizeIaItems(items, depth, budget) {
	const out = [];
	for (const item of items) {
		if (budget.left <= 0) break;
		budget.left--;
		const clean = sanitizeIaItem(item, depth, budget);
		if (clean) out.push(clean);
	}
	return out;
}

/**
 * A full `ThemeState` built from a theme that came from outside the studio's own controls: a share
 * link, a saved theme in `localStorage`, or an imported settings file. Anyone can craft a share
 * link, and its theme flows into `theme.css`, into the `astro.config.mjs` lines in
 * `APPLY-THEME.md`, and into steps a coding agent follows. So every value is checked against its
 * control (`sanitizeValue`), unknown control ids and an unknown preset are dropped, text becomes
 * one line, and the sidebar is rebuilt from known fields with safe links and paths. A theme the
 * studio itself made comes back unchanged.
 * @param {unknown} raw
 * @returns {ThemeState}
 */
export function sanitizeState(raw) {
	const input = isPlainObject(raw) ? raw : {};
	/** @type {Record<string, any>} */
	const values = {};
	if (isPlainObject(input.values)) {
		for (const [id, value] of Object.entries(input.values)) {
			const control = controlsById.get(id);
			if (!control) continue;
			const clean = sanitizeValue(control, value);
			if (clean !== undefined) values[id] = clean;
		}
	}
	const name = typeof input.meta?.name === 'string' ? toSingleLine(input.meta.name, MAX_NAME_LENGTH) : '';
	return {
		v: 1,
		starlight: STARLIGHT_VERSION,
		preset: presets.some((p) => p.id === input.preset) ? input.preset : 'starlight-default',
		values,
		ia: Array.isArray(input.ia) ? sanitizeIaItems(input.ia, 0, { left: MAX_IA_ITEMS }) : null,
		meta: { name: name.trim() ? name : DEFAULT_THEME_NAME },
	};
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
