/**
 * @file Font controls render as a vertical list of rows - one per curated Fontsource entry plus
 * 'system' - each row's own name set in that font (SPEC.md "B" tiles item 1, last sentence), not a
 * `<select>` and not a tile grid (fonts don't have a small illustrative "shape", the name IS the
 * preview). No page-stylesheet cloning or nested shadow root is needed here (nothing depends on
 * Starlight's own CSS) - rows render directly in the panel's existing shadow root, styled by
 * `styles.js`. Font FACES are still real network resources, so they're lazy-loaded document-wide
 * (a shadow-root-scoped `@font-face` does not reliably load in Chromium - confirmed during
 * authoring) only once the Typography group is actually opened.
 */
import { FONTS } from '../../core/manifest.js';
import { getValue } from '../../core/state.js';

const FONT_PREVIEW_STYLE_ID = 'svc-font-previews';
let previewFacesInjected = false;

/** @param {import('../../core/manifest.js').Control} control @returns {{value:string,label:string}[]} */
export function fontOptionsFor(control) {
	const wantMono = control.id === 'type.font.mono';
	const curated = FONTS.filter((f) => (wantMono ? f.category === 'mono' : f.category !== 'mono'));
	return [
		{ value: 'system', label: 'System (no web font)' },
		...curated.map((f) => ({ value: f.id, label: `${f.family} (${f.category})` })),
	];
}

/** @param {string} fontId @returns {string} CSS `font-family` value with a sensible fallback stack. */
function previewFontFamily(fontId) {
	if (!fontId || fontId === 'system') return 'var(--sl-font-system, inherit)';
	const font = FONTS.find((f) => f.id === fontId);
	if (!font) return 'inherit';
	const fallback =
		font.category === 'serif'
			? "ui-serif, Georgia, 'Times New Roman', serif"
			: font.category === 'mono'
				? 'var(--sl-font-system-mono, monospace)'
				: 'var(--sl-font-system, inherit)';
	return `'${font.family} Variable', ${fallback}`;
}

/**
 * Injects `@font-face` rules for EVERY curated font (not just the three currently chosen ones - any
 * row in any font list might be previewed) into a document-level `<style>`, idempotently. Called
 * from `panel.js` when the Typography group is opened (or is already open at load, e.g. restored
 * from `sessionStorage['svc-ui']`).
 */
export function ensureFontPreviewFacesInjected() {
	if (previewFacesInjected) return;
	previewFacesInjected = true;
	const lines = FONTS.map((font) => {
		const url = `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}:vf@latest/latin-wght-normal.woff2`;
		return `@font-face { font-family: '${font.family} Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('${url}') format('woff2-variations'); }`;
	});
	let styleEl = document.getElementById(FONT_PREVIEW_STYLE_ID);
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = FONT_PREVIEW_STYLE_ID;
		document.head.appendChild(styleEl);
	}
	styleEl.textContent = lines.join('\n');
}

/**
 * @param {import('../../core/manifest.js').Control} control
 * @param {import('../../core/state.js').ThemeState} state
 * @param {(value: string) => void} onCommit
 * @param {(scroll: boolean) => void} notifyTarget
 * @returns {{root: HTMLElement, refresh: (state: import('../../core/state.js').ThemeState) => void}}
 */
export function createFontList(control, state, onCommit, notifyTarget) {
	const root = document.createElement('div');
	root.className = 'svc-font-list';
	root.setAttribute('role', 'radiogroup');
	root.setAttribute('aria-label', control.label);

	const name = `svc-font-${control.id.replace(/[^a-z0-9]+/gi, '-')}`;
	const options = fontOptionsFor(control);
	/** @type {Map<string, HTMLInputElement>} */
	const radiosByValue = new Map();

	for (const opt of options) {
		const row = document.createElement('label');
		row.className = 'svc-font-row';

		const radio = document.createElement('input');
		radio.type = 'radio';
		radio.name = name;
		radio.value = opt.value;
		radio.className = 'svc-font-radio';
		radio.checked = String(getValue(state, control.id)) === opt.value;
		radiosByValue.set(opt.value, radio);
		radio.addEventListener('change', () => onCommit(opt.value));
		radio.addEventListener('focus', () => notifyTarget(true));

		const nameEl = document.createElement('span');
		nameEl.className = 'svc-font-row-name';
		nameEl.style.fontFamily = previewFontFamily(opt.value);
		nameEl.textContent = opt.label;

		row.appendChild(radio);
		row.appendChild(nameEl);
		row.addEventListener('pointerenter', () => notifyTarget(false));
		root.appendChild(row);
	}

	function refresh(nextState) {
		const value = String(getValue(nextState, control.id));
		const radio = radiosByValue.get(value);
		if (radio) radio.checked = true;
	}

	return { root, refresh };
}
