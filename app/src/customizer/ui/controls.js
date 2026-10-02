/**
 * @file DOM builders for the panel body: preset gallery, collapsible group sections, individual
 * manifest-driven controls (range/select/toggle/color/font), and the live WCAG contrast readout
 * block. Pure DOM construction - no state ownership; callers pass a `handlers` object and this
 * module calls back into it. Kept framework-free (no UI library dependency).
 */
import { controls as manifestControls, FONTS } from '../core/manifest.js';
import { getValue, snapToStep } from '../core/state.js';
import { getPresetLightPalette, contrastRatio, oklchToHex, hexToOklchHueChroma, hexToHslHue } from '../core/color.js';
import { createTileControl, TILE_CONTROL_IDS, createFontList } from './tiles/index.js';
// The hex-first color popover (vanilla-colorful) - see
// color-picker.js's file header for why it is imported ONLY from here.
import { createColorPopover } from './color-picker.js';

const manifestControlById = new Map(manifestControls.map((c) => [c.id, c]));

/** @param {number} v @param {number} min @param {number} max @returns {number} */
function clampNum(v, min, max) {
	return Math.min(max, Math.max(min, v));
}

/**
 * Validates and normalizes a typed hex color (3 or 6 hex digits, `#` optional) to
 * lowercase `#rrggbb`. Deliberately stricter than what `culori`'s `hsl()`/`oklch()` parsers would
 * accept (they also parse `rgb(...)`/named colors) - only "a valid hex (3 or 6 digits, `#`
 * optional)" is accepted, with anything else treated as invalid input that changes nothing.
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeHexInput(raw) {
	const trimmed = String(raw ?? '').trim();
	const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
	if (!m) return null;
	const digits = m[1];
	const six = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
	return `#${six.toLowerCase()}`;
}

/**
 * @typedef {{
 *   onChange: (id: string, value: any) => void,
 *   onChangeMany?: (entries: [string, any][]) => void,
 *   onReset: (id: string) => void,
 *   onApplyPreset: (presetId: string) => void,
 *   getResolvedColor: (id: string) => string,
 *   onTarget?: (targetSelector: string, opts?: {scroll?: boolean}) => void,
 * }} ControlHandlers
 */

/**
 * One small inline-SVG glyph per GROUPS entry, 24x24 viewBox, stroke-based so `currentColor` (set via `.svc-group-icon { color:
 * var(--group-accent) }` in styles.js) tints them per group. Unknown/future group names (e.g. a
 * manifest addition) fall back to a plain dot rather than breaking.
 * @type {Record<string, string>}
 */
export const GROUP_ICON_PATHS = {
	Presets: '<path d="M12 3l2.2 6.3L20.5 11.5l-6.3 2.2L12 20l-2.2-6.3L3.5 11.5l6.3-2.2z"/>',
	Colors:
		'<path d="M12 3.5a8.5 8.5 0 100 17 1.7 1.7 0 001.7-1.7c0-.45-.17-.85-.45-1.17a1.65 1.65 0 01-.45-1.13 1.7 1.7 0 011.7-1.7h1.9a4.8 4.8 0 004.8-4.8c0-3.6-4.13-6.5-9.2-6.5z"/><circle cx="7.2" cy="10.5" r="1.1"/><circle cx="9.8" cy="7" r="1.1"/><circle cx="14.6" cy="7.2" r="1.1"/>',
	Typography: '<path d="M5 6h14M12 6v13M9 19h6"/>',
	Layout: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
	Header: '<rect x="3.5" y="4" width="17" height="4.2" rx="1"/><rect x="3.5" y="10" width="17" height="10" rx="1"/>',
	Sidebar: '<rect x="3.5" y="4" width="17" height="16" rx="1"/><path d="M9.5 4v16"/>',
	TOC: '<circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/><path d="M9 6h11M9 12h11M9 18h7"/>',
	Content: '<path d="M6 3.5h9l4 4V20.5H6z"/><path d="M14.5 3.5V8h4"/><path d="M9 12.5h7M9 16h7"/>',
	Components: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v4a1.5 1.5 0 003 0V4M15 20v-4a1.5 1.5 0 013 0v4"/>',
	Code: '<path d="M9 6L4 12l5 6M15 6l5 6-5 6"/>',
	Footer: '<rect x="3.5" y="4" width="17" height="16" rx="1"/><rect x="3.5" y="15.5" width="17" height="4.5" rx="0" fill="currentColor" stroke="none"/>',
	'Page options': '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
	Navigation: '<circle cx="6" cy="6" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="12" r="1.6"/><path d="M6 7.6V16.4M7.4 6.9l9.2 4.4M7.4 17.1l9.2-4.4"/>',
};

/** @param {string} groupName @returns {string} Inline-SVG markup (for `innerHTML`), or a plain dot fallback. */
function groupIconSvg(groupName) {
	const inner = GROUP_ICON_PATHS[groupName] ?? '<circle cx="12" cy="12" r="4"/>';
	return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** One accurate, plain-language sentence per group, shown under the panel column's group
 * title. Keyed by the same stable `groupName` GROUP_ICON_PATHS uses (including 'Navigation', whose
 * visible rail label is retitled "Structure (advanced)" elsewhere without changing this key). */
export const GROUP_DESCRIPTIONS = {
	Presets: 'Start from a deliberate combination of color, type and treatments - every value stays editable after.',
	Colors: "Accent and gray hues drive Starlight's whole palette; semantic hues color asides, and role overrides replace individual surfaces.",
	Typography: 'Body, heading and code fonts, the type scale, and heading rhythm.',
	Layout: 'Content width, sidebar width, spacing, corner radius and shadow depth for the page frame.',
	Header: "The site title, search box, and the header bar's own border or shadow.",
	Sidebar: 'Item spacing, nesting indent and hover treatment for the left-hand navigation.',
	TOC: 'The right-hand outline: current-item styling, indent and depth guides.',
	Content: 'Body text, tables, blockquotes, asides and heading rules inside the article itself.',
	Components: 'Cards, buttons and badges used throughout the docs.',
	Code: 'Code block chrome - corner radius, font size and long-line wrapping.',
	Footer: 'Pagination cards and their shadow at the bottom of each page.',
	'Page options': 'Table of contents depth, pagination, last-updated and heading-link visibility - applied at export time.',
	Navigation: "The sidebar's own structure: pages, groups and badges. Most sites won't need this.",
};

// ---------------------------------------------------------------------------------------------
// Units: a `rem`-unit control's number field shows/accepts PX (its slider keeps
// working in the control's own stored unit); a `px`-unit control's number field is unchanged but
// gains a secondary rem readout - except radius/shadow controls, which stay px-only. Driven purely
// by `control.unit` (and an id/label heuristic for the radius/shadow exception) so this works for
// every manifest control, including any added later, with zero per-control UI code.
// ---------------------------------------------------------------------------------------------
const REM_PX = 16;

/** @param {import('../core/manifest.js').Control} control @returns {boolean} */
function isRadiusOrShadowControl(control) {
	return /radius|shadow/i.test(control.id) || /radius|shadow/i.test(control.label);
}

/** @param {import('../core/manifest.js').Control} control @returns {'rem-as-px'|'px-with-rem'|'plain'} */
function unitDisplayMode(control) {
	if (control.unit === 'rem') return 'rem-as-px';
	if (control.unit === 'px' && !isRadiusOrShadowControl(control)) return 'px-with-rem';
	return 'plain';
}

/** @param {number} n @returns {string} Trims float noise (2.8125 stays, 45.000000001 -> "45"). */
function formatUnitNum(n) {
	return Number(n.toFixed(4)).toString();
}

/** A collapsed range card's own value summary ("720 px", "8px", "0.27") - the same
 * `unitDisplayMode`/`formatUnitNum` machinery the live number-box display already uses, so it
 * always agrees with what the expanded card would show.
 * @param {import('../core/manifest.js').Control} control @param {number} value @returns {string} */
function rangeSummaryText(control, value) {
	const mode = unitDisplayMode(control);
	if (mode === 'rem-as-px') return `${formatUnitNum(value * REM_PX)} px`;
	const unit = control.unit ? ` ${control.unit}` : '';
	return `${formatUnitNum(value)}${unit}`;
}

/** @param {string} text @returns {string} */
function escapeHtml(text) {
	return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------------------------
// Item 4: UI-only metadata for the 9 Colors/Palette + Colors/Semantic-hues range controls (kept
// out of manifest.js, same pattern as tiles/samples.js's SAMPLE_LAYOUT - presentation, not a
// control-shape change): which sibling control a hue/chroma slider is paired with (for the
// gradient track and, for accent/gray, the picker's "set both" behavior), which CSS custom
// properties to render as live swatches, and whether the row gets a "pick a color" input at all
// (hue rows only - a picker on a chroma row would just duplicate its paired hue row's picker).
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{
 *   kind: 'accent'|'gray'|'semantic',
 *   axis: 'hue'|'chroma',
 *   pairedId?: string,
 *   semanticName?: string,
 *   swatchTokens?: string[],
 * }} ColorAssist
 */

/** @type {Record<string, ColorAssist>} */
export const COLOR_ASSIST = {
	'color.accent.hue': {
		kind: 'accent',
		axis: 'hue',
		pairedId: 'color.accent.chroma',
		swatchTokens: ['--sl-color-accent-low', '--sl-color-accent', '--sl-color-accent-high'],
	},
	'color.accent.chroma': { kind: 'accent', axis: 'chroma', pairedId: 'color.accent.hue' },
	'color.gray.hue': {
		kind: 'gray',
		axis: 'hue',
		pairedId: 'color.gray.chroma',
		swatchTokens: [
			'--sl-color-black',
			'--sl-color-gray-6',
			'--sl-color-gray-5',
			'--sl-color-gray-4',
			'--sl-color-gray-3',
			'--sl-color-gray-2',
			'--sl-color-gray-1',
			'--sl-color-white',
		],
	},
	'color.gray.chroma': { kind: 'gray', axis: 'chroma', pairedId: 'color.gray.hue' },
	// Semantic hues have no `pairedId` - each is a lone hue-only control (Starlight hardcodes S/L
	// for these; there's no matching chroma control to pair with, unlike accent/gray).
	'color.hue.orange': {
		kind: 'semantic',
		axis: 'hue',
		semanticName: 'orange',
		swatchTokens: ['--sl-color-orange-low', '--sl-color-orange', '--sl-color-orange-high'],
	},
	'color.hue.green': {
		kind: 'semantic',
		axis: 'hue',
		semanticName: 'green',
		swatchTokens: ['--sl-color-green-low', '--sl-color-green', '--sl-color-green-high'],
	},
	'color.hue.blue': {
		kind: 'semantic',
		axis: 'hue',
		semanticName: 'blue',
		swatchTokens: ['--sl-color-blue-low', '--sl-color-blue', '--sl-color-blue-high'],
	},
	'color.hue.purple': {
		kind: 'semantic',
		axis: 'hue',
		semanticName: 'purple',
		swatchTokens: ['--sl-color-purple-low', '--sl-color-purple', '--sl-color-purple-high'],
	},
	'color.hue.red': {
		kind: 'semantic',
		axis: 'hue',
		semanticName: 'red',
		swatchTokens: ['--sl-color-red-low', '--sl-color-red', '--sl-color-red-high'],
	},
};

const HUE_STOPS_DEG = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
/** Fixed lightness the accent/gray hue and chroma tracks are painted at (OKLCH `L`, 0-100) - close
 * to the generated palette's own "accent" role lightness (~52-53 in both modes), vivid enough to
 * read as a spectrum at typical chroma without needing to match any one role exactly (this is an
 * illustrative track, not a live swatch - swatches below use the real `var(--sl-color-...)`). */
const TRACK_LIGHTNESS = 60;

/**
 * Starlight's real per-role HSL saturation/lightness for each semantic hue (dark/light), read
 * verbatim from `node_modules/@astrojs/starlight/dist/style/props.css` - used only for the "base"
 * tone (blue's is genuinely more saturated than the other four: `100%,60%` dark / `90%,60%` light,
 * vs `82%,63%` / `90%,60%` for orange/purple/red, and green's light tone is deliberately darker at
 * `46%` so it doesn't wash out yellow-green - copied exactly, not averaged). Semantic hue tracks
 * are an HSL sweep (item 4: "matching how Starlight uses them"), so no culori conversion is needed
 * here at all - `hsl(deg, S%, L%)` is valid CSS on its own.
 * @type {Record<string, {dark: [number, number], light: [number, number]}>}
 */
const SEMANTIC_HUE_SL = {
	orange: { dark: [82, 63], light: [90, 60] },
	green: { dark: [82, 63], light: [90, 46] },
	blue: { dark: [100, 60], light: [90, 60] },
	purple: { dark: [82, 63], light: [90, 60] },
	red: { dark: [82, 63], light: [90, 60] },
};

/** @returns {boolean} */
function isLightTheme() {
	return document.documentElement.dataset.theme === 'light';
}

/** @param {number} chroma @returns {string} An OKLCH hue-spectrum `linear-gradient` at the given chroma. */
function oklchHueTrackCss(chroma) {
	const stops = HUE_STOPS_DEG.map((h) => oklchToHex(TRACK_LIGHTNESS, chroma, h));
	return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** @param {number} hue @param {number} maxChroma @returns {string} Gray-to-full-intensity `linear-gradient` at the given hue. */
function oklchChromaTrackCss(hue, maxChroma) {
	const STEPS = 6;
	const stops = Array.from({ length: STEPS }, (_, i) => oklchToHex(TRACK_LIGHTNESS, (maxChroma * i) / (STEPS - 1), hue));
	return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** @param {string} semanticName @returns {string} An HSL hue-spectrum `linear-gradient`, matching Starlight's own per-role S/L for that hue. */
function semanticHueTrackCss(semanticName) {
	const [s, l] = SEMANTIC_HUE_SL[semanticName][isLightTheme() ? 'light' : 'dark'];
	const stops = HUE_STOPS_DEG.map((h) => `hsl(${h}, ${s}%, ${l}%)`);
	return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Computes and applies this control's gradient track (item 4) to its `<input type=range>` via the
 * `--svc-track-bg` custom property (styles.js's `input[type=range]::-webkit-slider-runnable-track`
 * / `::-moz-range-track` read it) - confirmed to paint without needing `-webkit-appearance:none`
 * on the input (which would also require rebuilding the thumb). Reads the PAIRED control's live
 * value for accent/gray (hue track depends on chroma and vice versa - "tracks update live as
 * related values change"); semantic tracks are a fixed spectrum, independent of any live value.
 * @param {HTMLInputElement} inputEl
 * @param {import('../core/manifest.js').Control} control
 * @param {ColorAssist} assist
 * @param {import('../core/state.js').ThemeState} state
 */
function applyColorTrack(inputEl, control, assist, state) {
	if (assist.kind === 'semantic') {
		inputEl.style.setProperty('--svc-track-bg', semanticHueTrackCss(assist.semanticName));
		return;
	}
	if (assist.axis === 'hue') {
		inputEl.style.setProperty('--svc-track-bg', oklchHueTrackCss(getValue(state, assist.pairedId)));
	} else {
		inputEl.style.setProperty('--svc-track-bg', oklchChromaTrackCss(getValue(state, assist.pairedId), control.max));
	}
}

/**
 * Builds the swatch strip + optional "pick a color" input beneath a hue slider (item 4). Chroma
 * rows (`assist.axis === 'chroma'`) get a track (via `applyColorTrack` in the range branch below)
 * but no swatches/picker of their own - their paired HUE row already has one, and a second picker
 * that also "sets hue and chroma" would just be a confusing duplicate of the first.
 * @param {import('../core/manifest.js').Control} control
 * @param {ColorAssist} assist
 * @param {ControlHandlers} handlers
 * @param {(value: number) => void} commit Same commit callback the slider itself uses.
 * @param {HTMLInputElement} inputEl
 * @param {HTMLInputElement} numberEl
 * @returns {{root: HTMLElement, picker: {setSwatch: (hex: string) => void}, hexInput: HTMLInputElement, syncHexDisplay: (value: string) => void}}
 */
function buildColorAssistRow(control, assist, handlers, commit, inputEl, numberEl) {
	const wrap = document.createElement('div');
	wrap.className = 'svc-color-assist-row';

	// One consistent layout for every color-assist control - a hex+picker
	// row, THEN the swatch strip, THEN the note/help (previously the swatch strip came first and
	// accent's own extra help paragraph made its row look different from gray's).
	const hexRow = document.createElement('div');
	hexRow.className = 'svc-color-hexrow';

	// Hex text field, PRIMARY editor - hex entry is the primary way colors are set here because
	// Chrome's native `<input type=color>` dialog can't be forced into hex mode. Applies hue (and,
	// for accent/gray, chroma) through the same back-solve the native picker below uses, so both
	// stay in exact sync; the two-id accent/gray case commits through `onChangeMany` (one undo
	// step, not two - see panel.js's `onControlChangeMany`).
	const hexInput = document.createElement('input');
	hexInput.type = 'text';
	hexInput.className = 'svc-color-hex';
	hexInput.spellcheck = false;
	hexInput.autocomplete = 'off';
	hexInput.placeholder = '#rrggbb';
	hexInput.setAttribute('aria-label', `Hex color for ${control.label}`);
	hexInput.value = handlers.getResolvedColor(control.id);
	const hexMsg = document.createElement('span');
	hexMsg.className = 'svc-color-hex-msg';
	hexMsg.hidden = true;

	// `lastKnownValue` is whatever the field currently shows because it was put
	// there (initial paint, a produced-color readback, or an external refresh) - never because the
	// user's own edit is still pending. A commit (Enter or blur) is a no-op whenever the field's text
	// already equals this, so blurring right after Enter (e.g. a real click on the top-bar Undo
	// button) never re-solves hue/chroma from the JUST-DISPLAYED produced color and records a second,
	// spurious history step. `syncHexDisplay` is the ONLY way the field's `.value` should ever be set
	// from outside a genuine user edit - `refresh()` below uses it too, for the same reason.
	let lastKnownValue = hexInput.value;
	function syncHexDisplay(value) {
		hexInput.value = value;
		lastKnownValue = value;
	}

	// Shared back-solve, used by BOTH the row's own primary hex field (Enter/blur, below)
	// and the popover picker (hex-color-picker drag/keyboard + its own hex field/eyedropper) - one
	// path, so the two stay in exact sync. `coalesceKey`, when given, lets many rapid calls (a
	// popover drag fires `color-changed` continuously) merge into ONE undo step, the same way a
	// plain slider drag's many `input` events already coalesce by control id - see panel.js's
	// `coalesceKey` parameter threaded through `onChangeMany`.
	function applyHex(normalized, { coalesceKey } = {}) {
		// Back-solved values are raw floats (276.50971...); `onStep` puts them on each control's own
		// slider grid, so the number box, the exported CSS and the share link show 277, not the float.
		const onStep = (value, c) => clampNum(snapToStep(clampNum(value, c.min, c.max), c.step, c.min), c.min, c.max);
		if (assist.kind === 'semantic') {
			const hue = onStep(hexToHslHue(normalized), control);
			inputEl.value = String(hue);
			numberEl.value = String(hue);
			commit(hue);
		} else {
			const { hue, chroma } = hexToOklchHueChroma(normalized);
			const clampedHue = onStep(hue, control);
			const pairedControl = manifestControlById.get(assist.pairedId);
			const clampedChroma = pairedControl ? onStep(chroma, pairedControl) : chroma;
			inputEl.value = String(clampedHue);
			numberEl.value = String(clampedHue);
			if (handlers.onChangeMany) {
				handlers.onChangeMany(
					[
						[control.id, clampedHue],
						[assist.pairedId, clampedChroma],
					],
					coalesceKey
				);
			} else {
				// Defensive fallback (e.g. a handlers object built without it) - two steps, not one.
				commit(clampedHue);
				handlers.onChange(assist.pairedId, clampedChroma);
			}
		}
		handlers.onTarget?.(control.target, { scroll: true });
	}

	/** Starlight tunes lightness per role, so the color actually produced can differ from what was
	 * typed/picked - re-read it once the apply this commit triggered has actually run (one rAF tick,
	 * same timing panel.js's own scheduleApply uses) and note it if so. `syncHexDisplay` (not a bare
	 * `.value =`) so a later blur-with-no-edit on this SAME produced color stays a no-op too. */
	function refreshProducedNote(justApplied) {
		requestAnimationFrame(() => {
			const produced = handlers.getResolvedColor(control.id);
			syncHexDisplay(produced);
			if (picker) picker.setSwatch(produced);
			if (produced !== justApplied) {
				hexMsg.hidden = false;
				hexMsg.dataset.kind = 'note';
				hexMsg.textContent = 'Starlight adjusts lightness for readable contrast.';
			} else {
				hexMsg.hidden = true;
			}
		});
	}

	function commitHex() {
		if (hexInput.value === lastKnownValue) return; // nothing the user actually changed
		const normalized = normalizeHexInput(hexInput.value);
		if (!normalized) {
			hexMsg.hidden = false;
			hexMsg.dataset.kind = 'error';
			hexMsg.textContent = 'Enter a 3- or 6-digit hex color (e.g. #4453c9).';
			return;
		}
		applyHex(normalized);
		refreshProducedNote(normalized);
	}
	hexInput.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		commitHex();
	});
	hexInput.addEventListener('blur', () => commitHex());
	hexRow.appendChild(hexInput);

	// The popover swatch button replaces the native `<input type=color>` - see
	// color-picker.js's file header for why (Chrome's own picker dialog can't open in hex mode).
	const picker = createColorPopover({
		label: control.label,
		normalizeHex: normalizeHexInput,
		onChange: (hex, { settled }) => {
			applyHex(hex, { coalesceKey: `picker:${control.id}` });
			if (settled) refreshProducedNote(hex);
			else hexMsg.hidden = true;
		},
	});
	picker.setSwatch(handlers.getResolvedColor(control.id));
	hexRow.appendChild(picker.button);
	hexRow.appendChild(picker.popover);
	wrap.appendChild(hexRow);

	if (assist.swatchTokens?.length) {
		const group = document.createElement('div');
		group.className = 'svc-swatch-group';
		for (const token of assist.swatchTokens) {
			const swatch = document.createElement('span');
			swatch.className = 'svc-color-swatch';
			// Live + theme-following "for free" (item 4): a custom property reference inside the
			// panel's shadow DOM resolves against the real document root's cascaded value (`all:
			// initial` on :host does not reset custom properties - excluded from `all` by spec), so
			// this repaints whenever `sheet.replaceSync(...)` changes the token, with no JS here.
			swatch.style.background = `var(${token})`;
			swatch.title = token;
			group.appendChild(swatch);
		}
		wrap.appendChild(group);
	}

	wrap.appendChild(hexMsg);

	return { root: wrap, picker, hexInput, syncHexDisplay };
}

/**
 * Builds one control row. Returns the root element plus refs used for cheap in-place updates
 * (readout text, reset-button visibility) so range drags don't require a full re-render.
 * @param {import('../core/manifest.js').Control} control
 * @param {import('../core/state.js').ThemeState} state
 * @param {ControlHandlers} handlers
 * @param {{isCardOpen?: (controlId: string) => boolean, onCardToggle?: (controlId: string, open: boolean) => void}} [opts]
 *   Per-card open/closed state, same contract as
 *   `createGroupSection`'s `isSectionOpen`/`onSectionToggle` one level up - `onCardToggle` fires
 *   only on a genuine user click (not the filter's auto-open), so panel.js persists just the user's
 *   own choices.
 * @returns {{root: HTMLElement, refresh: (state: import('../core/state.js').ThemeState) => void}}
 */
export function createControlRow(control, state, handlers, opts = {}) {
	const root = document.createElement('div');
	root.className = 'svc-control';
	root.dataset.controlId = control.id;
	root.dataset.label = control.label.toLowerCase();

	// Every card starts OPEN unless a restored sessionStorage choice says otherwise.
	const startOpen = opts.isCardOpen ? opts.isCardOpen(control.id) !== false : true;
	root.dataset.open = startOpen ? 'true' : 'false';

	// `target` is optional and may not exist on every control yet -
	// every use below is guarded, so a manifest without it just never scrolls/highlights (graceful
	// degrade), no per-control UI code needed once it's added.
	const notifyTarget = (scroll) => {
		if (control.target) handlers.onTarget?.(control.target, { scroll });
	};
	if (control.target) {
		root.addEventListener('pointerenter', () => notifyTarget(false));
	}

	// The card header is a collapsible toggle - a real <button> (Enter/Space
	// activation for free) holding the label, an optional build-tag, a value SUMMARY shown only
	// while collapsed ("720 px", "Filled pill", a color chip + hex, "On"), and a chevron; the whole
	// row is the click target. Deliberately NOT a `<label for=...>` around the input: clicking to
	// collapse a TOGGLE card must never also flip its checkbox, and a
	// `<label for>` on a range control would focus (and scroll to) the frame on every collapse click.
	// Every input below gets its own `aria-label` instead (several already had one).
	const head = document.createElement('div');
	head.className = 'svc-control-head';
	root.appendChild(head);

	const toggleBtn = document.createElement('button');
	toggleBtn.type = 'button';
	toggleBtn.className = 'svc-control-toggle';
	toggleBtn.setAttribute('aria-expanded', String(startOpen));
	head.appendChild(toggleBtn);

	const inputId = `svc-input-${control.id.replace(/[^a-z0-9]+/gi, '-')}`;
	const labelText = document.createElement('span');
	labelText.className = 'svc-control-label';
	labelText.textContent = control.label;
	toggleBtn.appendChild(labelText);
	if (control.tier === 'build') {
		const tag = document.createElement('span');
		tag.className = 'svc-build-tag';
		tag.textContent = 'build-time';
		tag.title = 'Exported to config; approximated in preview.';
		toggleBtn.appendChild(tag);
	}
	const summaryEl = document.createElement('span');
	summaryEl.className = 'svc-control-summary';
	toggleBtn.appendChild(summaryEl);
	const caret = document.createElement('span');
	caret.className = 'svc-control-caret';
	caret.setAttribute('aria-hidden', 'true');
	caret.textContent = '▾';
	toggleBtn.appendChild(caret);

	toggleBtn.addEventListener('click', () => {
		const nextOpen = root.dataset.open === 'false';
		root.dataset.open = nextOpen ? 'true' : 'false';
		toggleBtn.setAttribute('aria-expanded', String(nextOpen));
		opts.onCardToggle?.(control.id, nextOpen);
	});

	// The card's collapsible body - everything that isn't the header row above (P4's "the whole
	// header row is the click target", "a collapsed card shows its current value on the same line").
	const body = document.createElement('div');
	body.className = 'svc-control-body';
	root.appendChild(body);

	const row = document.createElement('div');
	row.className = 'svc-control-row';
	body.appendChild(row);

	/** @type {HTMLElement} */
	let inputEl;
	/** @type {HTMLInputElement | null} Editable numeric twin of a range slider. */
	let numberEl = null;
	/** @type {{root: HTMLElement, refresh: Function} | null} Set for tile-grid/font-list controls;
	 * when present it owns its own refresh/selection logic instead of the type-specific branches
	 * below (which assume a single `inputEl`). */
	let tileControl = null;
	// Item 4: set for the 9 Colors/Palette + Colors/Semantic-hues range controls - see COLOR_ASSIST.
	/** @type {ColorAssist | null} */
	let colorAssist = null;
	/** @type {HTMLElement | null} The swatches + picker row appended below the slider. */
	let colorAssistRoot = null;
	/** @type {HTMLElement | null} The one-line "your color sets hue and intensity..." paragraph (color.accent.hue only). */
	let colorAssistHelpEl = null;
	/** @type {HTMLInputElement | null} */
	let colorPickerEl = null;
	/** @type {HTMLInputElement | null} The hex text field beside the picker. */
	let colorHexEl = null;
	/** @type {((value: string) => void) | null} The ONLY way `refresh()` may update `colorHexEl`'s
	 * displayed value - see `buildColorAssistRow`'s `syncHexDisplay` for why a bare `.value =` would
	 * reintroduce the blur-recommits-a-second-step bug on the very next undo/redo/preset/refresh. */
	let colorHexSync = null;
	/** @type {((value: string) => void) | null} Same contract as `colorHexSync`, for a `color`-type
	 * (role override) control's own hex field. */
	let colorRoleHexSync = null;
	/** @type {{setSwatch: (hex: string) => void} | null} A `color`-type (role override)
	 * control's own popover swatch button - `refresh()` re-seeds its swatch color the same way it
	 * already re-seeds `colorHexSync`. */
	let colorRoleSwatchPopover = null;

	const isDefaultNow = () => getValue(state, control.id) === control.default;

	const resetBtn = document.createElement('button');
	resetBtn.type = 'button';
	resetBtn.className = 'svc-reset';
	resetBtn.textContent = '↺';
	resetBtn.title = `Reset ${control.label}`;
	resetBtn.setAttribute('aria-label', `Reset ${control.label} to default`);
	resetBtn.addEventListener('click', () => handlers.onReset(control.id));

	if (control.type === 'font' || (control.type === 'select' && TILE_CONTROL_IDS.has(control.id))) {
		// Visual selects render as clickable tile grids, and every font control renders as a
		// vertical list of font-name rows - both own their full
		// selection UI (native radios), so this row only wires the shared commit/notify plumbing.
		const commit = (value) => {
			resetBtn.hidden = value === control.default;
			handlers.onChange(control.id, value);
		};
		tileControl =
			control.type === 'font'
				? createFontList(control, state, commit, notifyTarget)
				: createTileControl(control, state, commit, notifyTarget);
		row.appendChild(tileControl.root);
	} else if (control.type === 'range') {
		inputEl = document.createElement('input');
		inputEl.type = 'range';
		inputEl.min = String(control.min);
		inputEl.max = String(control.max);
		inputEl.step = String(control.step);
		inputEl.value = String(getValue(state, control.id));
		inputEl.setAttribute('aria-label', control.label);

		// The slider ALWAYS stays in the control's own stored unit -
		// only the adjacent number box's displayed/accepted unit and an optional secondary readout
		// vary, per `unitDisplayMode`. `toDisplay`/`fromDisplay` convert stored <-> shown; the range
		// input itself never goes through them.
		const displayMode = unitDisplayMode(control);
		const toDisplay = (raw) => (displayMode === 'rem-as-px' ? raw * REM_PX : raw);
		const fromDisplay = (shown) => (displayMode === 'rem-as-px' ? shown / REM_PX : shown);
		const displayStep = displayMode === 'rem-as-px' ? control.step * REM_PX : control.step;
		const displayMin = displayMode === 'rem-as-px' ? control.min * REM_PX : control.min;
		const displayMax = displayMode === 'rem-as-px' ? control.max * REM_PX : control.max;
		/** Snaps a raw (stored-unit) value to the nearest multiple of the control's own step, within range. */
		const snapToStep = (raw) => {
			const steps = Math.round((raw - control.min) / control.step);
			return clampNum(control.min + steps * control.step, control.min, control.max);
		};

		// The slider is for quick sizing; the number box accepts an exact value. Typed values are
		// clamped to the control's range but not snapped to its step, so e.g. 1.333 is reachable -
		// except in 'rem-as-px' mode, where a typed px value DOES snap (S15: "input converts back and
		// snaps to the control's step"), since arbitrary px rarely lands on a clean rem value.
		const numberWrap = document.createElement('span');
		numberWrap.className = 'svc-number';
		numberEl = document.createElement('input');
		numberEl.type = 'number';
		numberEl.id = inputId;
		numberEl.min = String(displayMin);
		numberEl.max = String(displayMax);
		numberEl.step = displayMode === 'rem-as-px' ? String(displayStep) : 'any';
		numberEl.value = formatUnitNum(toDisplay(getValue(state, control.id)));
		numberWrap.appendChild(numberEl);
		if (displayMode === 'plain' && control.unit) {
			const unitEl = document.createElement('span');
			unitEl.className = 'svc-unit';
			unitEl.textContent = control.unit;
			numberWrap.appendChild(unitEl);
		} else if (displayMode === 'rem-as-px') {
			const unitEl = document.createElement('span');
			unitEl.className = 'svc-unit';
			unitEl.textContent = 'px';
			numberWrap.appendChild(unitEl);
		}

		/** @type {HTMLElement | null} The secondary unit readout ("45rem" / "0.75rem"), rem-as-px and px-with-rem modes only. */
		let secondaryUnitEl = null;
		if (displayMode !== 'plain') {
			secondaryUnitEl = document.createElement('span');
			secondaryUnitEl.className = 'svc-unit-secondary';
			const rawNow = getValue(state, control.id);
			secondaryUnitEl.textContent = displayMode === 'rem-as-px' ? `${formatUnitNum(rawNow)}rem` : `${formatUnitNum(rawNow / REM_PX)}rem`;
		}

		const commit = (value) => {
			resetBtn.hidden = value === control.default;
			handlers.onChange(control.id, value);
			notifyTarget(true);
			if (secondaryUnitEl) {
				secondaryUnitEl.textContent = displayMode === 'rem-as-px' ? `${formatUnitNum(value)}rem` : `${formatUnitNum(value / REM_PX)}rem`;
			}
		};
		inputEl.addEventListener('focus', () => notifyTarget(true));
		numberEl.addEventListener('focus', () => notifyTarget(true));
		inputEl.addEventListener('input', () => {
			const value = Number(inputEl.value);
			numberEl.value = formatUnitNum(toDisplay(value));
			commit(value);
		});
		const clamp = (v) => Math.min(control.max, Math.max(control.min, v));
		// Live-apply while typing when the value is a complete in-range number; clamp/snap on commit.
		numberEl.addEventListener('input', () => {
			const shown = numberEl.valueAsNumber;
			if (!Number.isFinite(shown) || shown < displayMin || shown > displayMax) return;
			const raw = fromDisplay(shown);
			if (displayMode === 'rem-as-px') return; // snaps only on change (commit), not every keystroke
			inputEl.value = String(raw);
			commit(raw);
		});
		numberEl.addEventListener('change', () => {
			const shown = numberEl.valueAsNumber;
			const rawTyped = Number.isFinite(shown) ? fromDisplay(clampNum(shown, displayMin, displayMax)) : Number(inputEl.value);
			const raw = displayMode === 'rem-as-px' ? snapToStep(rawTyped) : clamp(rawTyped);
			numberEl.value = formatUnitNum(toDisplay(raw));
			inputEl.value = String(raw);
			commit(raw);
		});
		row.appendChild(inputEl);
		row.appendChild(numberWrap);
		if (secondaryUnitEl) row.appendChild(secondaryUnitEl);

		// Item 4: gradient track (+ swatches/picker on the hue row only - see buildColorAssistRow).
		colorAssist = COLOR_ASSIST[control.id] || null;
		if (colorAssist) {
			applyColorTrack(inputEl, control, colorAssist, state);
			if (colorAssist.axis === 'hue') {
				const built = buildColorAssistRow(control, colorAssist, handlers, commit, inputEl, numberEl);
				colorAssistRoot = built.root;
				colorPickerEl = built.picker;
				colorHexEl = built.hexInput;
				colorHexSync = built.syncHexDisplay;
				if (control.id === 'color.accent.hue') {
					colorAssistHelpEl = document.createElement('p');
					colorAssistHelpEl.className = 'svc-control-help';
					colorAssistHelpEl.textContent =
						'Your color sets hue and intensity; lightness is tuned per role so text stays readable.';
				}
			}
		}
	} else if (control.type === 'select') {
		// Non-visual selects only (contrast floor, code theme) - every visual select is a tile grid,
		// handled above.
		inputEl = document.createElement('select');
		inputEl.setAttribute('aria-label', control.label);
		const options = control.options ?? [];
		for (const opt of options) {
			const optionEl = document.createElement('option');
			optionEl.value = opt.value;
			optionEl.textContent = opt.label;
			inputEl.appendChild(optionEl);
		}
		inputEl.value = String(getValue(state, control.id));
		inputEl.addEventListener('focus', () => notifyTarget(true));
		inputEl.addEventListener('change', () => {
			resetBtn.hidden = inputEl.value === String(control.default);
			handlers.onChange(control.id, inputEl.value);
			notifyTarget(true);
		});
		row.appendChild(inputEl);
	} else if (control.type === 'toggle') {
		inputEl = document.createElement('input');
		inputEl.type = 'checkbox';
		inputEl.setAttribute('aria-label', control.label);
		inputEl.checked = !!getValue(state, control.id);
		inputEl.addEventListener('focus', () => notifyTarget(true));
		inputEl.addEventListener('change', () => {
			resetBtn.hidden = inputEl.checked === control.default;
			handlers.onChange(control.id, inputEl.checked);
			notifyTarget(true);
		});
		row.appendChild(inputEl);
	} else if (control.type === 'color') {
		const currentValue = getValue(state, control.id);

		// Three affordances for one idea (a clear button, an "auto"
		// checkbox, and the row's own generic reset ↺) collapsed to two. The hex field is the PRIMARY
		// editor; a small "Auto" tag shows/hides opposite the clear button (never both at once), and
		// the generic resetBtn stays permanently hidden for this control type (below, and again at
		// the end of `refresh()`) since "Follow the palette" already does its job.
		const hexInput = document.createElement('input');
		hexInput.type = 'text';
		hexInput.className = 'svc-color-hex';
		hexInput.spellcheck = false;
		hexInput.autocomplete = 'off';
		hexInput.placeholder = '#rrggbb';
		hexInput.setAttribute('aria-label', `Hex color for ${control.label}`);
		hexInput.value = currentValue === 'auto' ? handlers.getResolvedColor(control.id) : currentValue;
		const hexMsg = document.createElement('span');
		hexMsg.className = 'svc-color-hex-msg';
		hexMsg.hidden = true;
		const autoTag = document.createElement('span');
		autoTag.className = 'svc-color-auto-tag';
		autoTag.textContent = 'Auto';
		autoTag.hidden = currentValue !== 'auto';

		// Same bug fix as the hue/chroma rows above: a commit is a no-op whenever the field's text
		// already equals what WE last put there (paint, produced-color readback, clear, or refresh) -
		// never because of a pending user edit - so blurring the field (e.g. a real click elsewhere)
		// without having typed anything never re-commits a value that's already in effect.
		let lastKnownValue = hexInput.value;
		function syncHexDisplay(value) {
			hexInput.value = value;
			lastKnownValue = value;
		}
		colorRoleHexSync = syncHexDisplay;

		function applyRoleColor(normalized) {
			hexMsg.hidden = true;
			syncHexDisplay(normalized);
			colorRoleSwatchPopover.setSwatch(normalized);
			autoTag.hidden = true;
			clearBtn.hidden = false;
			handlers.onChange(control.id, normalized);
			notifyTarget(true);
		}

		function commitRoleHex() {
			if (hexInput.value === lastKnownValue) return; // nothing the user actually changed
			const normalized = normalizeHexInput(hexInput.value);
			if (!normalized) {
				hexMsg.hidden = false;
				hexMsg.dataset.kind = 'error';
				hexMsg.textContent = 'Enter a 3- or 6-digit hex color (e.g. #4453c9).';
				return;
			}
			applyRoleColor(normalized);
		}
		hexInput.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			commitRoleHex();
		});
		hexInput.addEventListener('blur', () => commitRoleHex());

		const clearBtn = document.createElement('button');
		clearBtn.type = 'button';
		clearBtn.className = 'svc-reset svc-color-clear';
		clearBtn.textContent = '✕';
		clearBtn.title = 'Follow the palette';
		clearBtn.setAttribute('aria-label', `Clear ${control.label} override - follow the palette`);
		clearBtn.hidden = currentValue === 'auto';
		clearBtn.addEventListener('click', () => {
			const resolved = handlers.getResolvedColor(control.id);
			hexMsg.hidden = true;
			colorRoleSwatchPopover.setSwatch(resolved);
			syncHexDisplay(resolved);
			autoTag.hidden = false;
			clearBtn.hidden = true;
			handlers.onChange(control.id, 'auto');
			notifyTarget(true);
		});

		// The popover swatch button replaces the native `<input type=color>` - always
		// clickable (unlike the old native input, which was `disabled` while "auto"): opening the
		// popover and picking a color is now just as valid a way to START an override as typing hex.
		colorRoleSwatchPopover = createColorPopover({
			label: control.label,
			normalizeHex: normalizeHexInput,
			onChange: (hex) => applyRoleColor(hex),
		});
		colorRoleSwatchPopover.setSwatch(currentValue === 'auto' ? handlers.getResolvedColor(control.id) : currentValue);
		inputEl = colorRoleSwatchPopover.button;

		row.appendChild(hexInput);
		row.appendChild(colorRoleSwatchPopover.button);
		row.appendChild(colorRoleSwatchPopover.popover);
		row.appendChild(autoTag);
		row.appendChild(clearBtn);
		body.appendChild(hexMsg);
	} else if (control.type === 'text') {
		// A free-text control (site.title so far). Commits on every keystroke (`input`,
		// not just `change`) so the preview updates live as you type - `panel.js`'s
		// `history.record(state, 'control:' + id, ...)` coalesces same-id/same-tick edits into one
		// undo step (identical mechanism to the range/number-box live-typing path above), so a whole
		// typed sentence still undoes in one step, not one per keystroke.
		inputEl = document.createElement('input');
		inputEl.type = 'text';
		inputEl.setAttribute('aria-label', control.label);
		inputEl.maxLength = control.maxLength ?? 60;
		inputEl.value = String(getValue(state, control.id) ?? '');
		if (control.help) inputEl.placeholder = "Your project's own title";
		inputEl.addEventListener('focus', () => notifyTarget(true));
		inputEl.addEventListener('input', () => {
			resetBtn.hidden = inputEl.value === control.default;
			handlers.onChange(control.id, inputEl.value);
			notifyTarget(true);
		});
		row.appendChild(inputEl);
	} else {
		inputEl = document.createElement('input');
		inputEl.type = 'text';
		inputEl.setAttribute('aria-label', control.label);
		inputEl.value = String(getValue(state, control.id) ?? '');
		inputEl.addEventListener('focus', () => notifyTarget(true));
		inputEl.addEventListener('change', () => {
			resetBtn.hidden = inputEl.value === String(control.default);
			handlers.onChange(control.id, inputEl.value);
			notifyTarget(true);
		});
		row.appendChild(inputEl);
	}

	if (!tileControl && control.type !== 'range') inputEl.id = inputId;
	// A role override's own clear button ("Follow the palette") already
	// does what this generic reset arrow would - showing both is two affordances for one idea.
	resetBtn.hidden = control.type === 'color' ? true : isDefaultNow();
	head.appendChild(resetBtn);

	if (colorAssistRoot) body.appendChild(colorAssistRoot);
	if (colorAssistHelpEl) body.appendChild(colorAssistHelpEl);
	if (control.help) {
		const help = document.createElement('p');
		help.className = 'svc-control-help';
		help.textContent = control.help;
		body.appendChild(help);
	}

	// The collapsed-card value summary ("720 px", "Filled pill", a color chip + hex,
	// "On") - computed by control TYPE so it works for every control, including any added
	// later, with zero per-control UI code (same design principle the unit display above already
	// follows).
	function updateCardSummary(nextState) {
		summaryEl.replaceChildren();
		const value = getValue(nextState, control.id);
		function text(t) {
			const span = document.createElement('span');
			span.textContent = t;
			summaryEl.appendChild(span);
		}
		function chip(hex) {
			const span = document.createElement('span');
			span.className = 'svc-control-summary-chip';
			span.style.background = hex;
			summaryEl.appendChild(span);
		}
		if (control.type === 'range') {
			if (colorAssist && colorAssist.axis === 'hue') {
				const hex = handlers.getResolvedColor(control.id);
				chip(hex);
				text(hex);
			} else {
				text(rangeSummaryText(control, value));
			}
		} else if (control.type === 'toggle') {
			text(value ? 'On' : 'Off');
		} else if (control.type === 'font') {
			const font = value === 'system' || !value ? null : FONTS.find((f) => f.id === value);
			text(font ? font.family : 'System font');
		} else if (control.type === 'select') {
			const opt = (control.options || []).find((o) => o.value === value);
			text(opt ? opt.label : String(value));
		} else if (control.type === 'color') {
			const isAuto = value === 'auto';
			const resolved = isAuto ? handlers.getResolvedColor(control.id) : value;
			if (!isAuto) chip(resolved);
			text(isAuto ? 'Auto' : resolved);
		} else if (control.type === 'text') {
			text(value ? String(value) : 'Default');
		} else {
			text(String(value ?? ''));
		}
	}
	updateCardSummary(state);

	/** Cheap in-place refresh after an external state change (e.g. a preset was applied elsewhere). */
	function refresh(nextState) {
		const value = getValue(nextState, control.id);
		if (tileControl) {
			tileControl.refresh(nextState);
		} else if (control.type === 'range') {
			inputEl.value = String(value);
			// Don't clobber the number box while the user is typing in it.
			if (numberEl && numberEl !== numberEl.getRootNode().activeElement) {
				const mode = unitDisplayMode(control);
				numberEl.value = formatUnitNum(mode === 'rem-as-px' ? value * REM_PX : value);
			}
			const secondaryEl = root.querySelector('.svc-unit-secondary');
			if (secondaryEl) {
				const mode = unitDisplayMode(control);
				secondaryEl.textContent = mode === 'rem-as-px' ? `${formatUnitNum(value)}rem` : `${formatUnitNum(value / REM_PX)}rem`;
			}
			// Item 4: re-paint the gradient track (a sibling control - the paired hue/chroma - may
			// have changed) and re-seed the picker/hex field from the freshly-resolved color.
			if (colorAssist) {
				applyColorTrack(inputEl, control, colorAssist, nextState);
				if (colorPickerEl) colorPickerEl.setSwatch(handlers.getResolvedColor(control.id));
				// Don't clobber the hex field while the user is typing/focused in it. After
				// undo/redo/preset/group-reset/reset-all/import every hex field must
				// show the CURRENT resolved color - `colorHexSync` (never a bare `.value =`) keeps the
				// no-op-on-blur baseline in sync too, so the very next blur doesn't treat this refresh's
				// new value as a user edit and record a spurious extra history step.
				if (colorHexEl && colorHexSync && colorHexEl !== colorHexEl.getRootNode().activeElement) {
					colorHexSync(handlers.getResolvedColor(control.id));
					const msgEl = root.querySelector('.svc-color-hex-msg');
					if (msgEl) msgEl.hidden = true;
				}
			}
		} else if (control.type === 'toggle') {
			inputEl.checked = !!value;
		} else if (control.type === 'color') {
			const isAuto = value === 'auto';
			const resolved = isAuto ? handlers.getResolvedColor(control.id) : value;
			if (colorRoleSwatchPopover) colorRoleSwatchPopover.setSwatch(resolved);
			const autoTagEl = root.querySelector('.svc-color-auto-tag');
			if (autoTagEl) autoTagEl.hidden = !isAuto;
			const clearEl = root.querySelector('.svc-color-clear');
			if (clearEl) clearEl.hidden = isAuto;
			// After undo/redo/preset/group-reset/reset-all/import the hex
			// field must show the CURRENT resolved color - `colorRoleHexSync` (never a bare `.value =`)
			// keeps the no-op-on-blur baseline in sync too (see `commitRoleHex`'s own comment).
			const hexEl = root.querySelector('.svc-color-hex');
			if (hexEl && colorRoleHexSync && hexEl !== hexEl.getRootNode().activeElement) {
				colorRoleHexSync(resolved);
				const msgEl = root.querySelector('.svc-color-hex-msg');
				if (msgEl) msgEl.hidden = true;
			}
		} else {
			inputEl.value = String(value);
		}
		// A role override's clear button already covers "back to default" - see the matching guard
		// right after this control's row is first built.
		if (control.type !== 'color') resetBtn.hidden = value === control.default;
		updateCardSummary(nextState);
	}

	return { root, refresh };
}

/**
 * @param {string} groupName
 * @param {import('../core/manifest.js').Control[]} groupControls
 * @param {import('../core/state.js').ThemeState} state
 * @param {ControlHandlers} handlers
 * @param {{
 *   open?: boolean, title?: string, onToggle?: (groupName: string, open: boolean) => void,
 *   isSectionOpen?: (groupName: string, sectionName: string, isFirstInGroup: boolean) => boolean,
 *   onSectionToggle?: (groupName: string, sectionName: string, open: boolean) => void,
 * }} [opts]
 *   `title` overrides the visible heading text without changing `dataset.group` (filter lookups
 *   and the persisted open-groups set key off the stable `groupName`, not the display title -
 *   used to demote+retitle "Navigation" without touching anything that keys off its group name).
 *   `onToggle` fires only on a genuine user click (not the filter's auto-open), so panel.js can
 *   persist just the user's own choices to `sessionStorage['svc-ui']`. `isSectionOpen`/
 *   `onSectionToggle` are the same contract, one level down, for item 3's per-section disclosures.
 * @returns {{root: HTMLElement, body: HTMLElement, controlRows: Map<string, {root: HTMLElement, refresh: Function}>, refreshSectionDots: (state: import('../core/state.js').ThemeState) => void, firstSectionName: string|undefined}}
 */
export function createGroupSection(groupName, groupControls, state, handlers, opts = {}) {
	const root = document.createElement('section');
	root.className = 'svc-group';
	root.dataset.group = groupName;
	root.dataset.open = opts.open === false ? 'false' : 'true';

	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'svc-group-toggle';
	toggle.setAttribute('aria-expanded', String(root.dataset.open === 'true'));
	toggle.innerHTML = `<span class="svc-group-icon">${groupIconSvg(groupName)}</span><span class="svc-group-toggle-label">${escapeHtml(opts.title ?? groupName)}</span><span class="svc-group-caret" aria-hidden="true">▾</span>`;
	toggle.addEventListener('click', () => {
		const nextOpen = root.dataset.open === 'false';
		root.dataset.open = nextOpen ? 'true' : 'false';
		toggle.setAttribute('aria-expanded', String(nextOpen));
		opts.onToggle?.(groupName, nextOpen);
	});
	root.appendChild(toggle);

	const body = document.createElement('div');
	body.className = 'svc-group-body';
	root.appendChild(body);

	const { controlRows, refreshSectionDots, firstSectionName } = buildGroupSectionsInto(body, groupName, groupControls, state, handlers, opts);

	return { root, body, controlRows, refreshSectionDots, firstSectionName };
}

/**
 * Shared innards of `createGroupSection` (overlay accordion) and `createStudioGroupPanel` (studio's
 * rail-driven column): builds each control's row, grouped into per-`section`
 * disclosures exactly as before - factored out so both callers render byte-identical
 * section/control DOM, and the overlay-mode test suites see no change at all.
 * @param {HTMLElement} body Container the sections/rows are appended into.
 * @param {string} groupName
 * @param {import('../core/manifest.js').Control[]} groupControls
 * @param {import('../core/state.js').ThemeState} state
 * @param {ControlHandlers} handlers
 * @param {{isSectionOpen?: Function, onSectionToggle?: Function, isCardOpen?: Function, onCardToggle?: Function}} [opts]
 *   `isCardOpen`/`onCardToggle` are forwarded straight through to
 *   every `createControlRow` call below - same contract, one level down, as `isSectionOpen`.
 * @returns {{controlRows: Map<string, {root: HTMLElement, refresh: Function}>, refreshSectionDots: (state: import('../core/state.js').ThemeState) => void, firstSectionName: string|undefined}}
 */
function buildGroupSectionsInto(body, groupName, groupControls, state, handlers, opts = {}) {
	const controlRows = new Map();
	const controlById = new Map(groupControls.map((c) => [c.id, c]));
	/** @type {Map<string, {root: HTMLElement, dot: HTMLElement, controlIds: string[]}>} */
	const sections = new Map();
	let lastSection;
	let currentSectionBody = body;
	let isFirstSection = true;
	/** First section name encountered, for callers (panel.js) that need to know it again later -
	 * e.g. to decide a section's default open state when restoring after the filter clears, outside
	 * this loop where `isFirstSection` itself isn't in scope. */
	let firstSectionName;
	for (const control of groupControls) {
		if (control.showIf && getValue(state, control.showIf.id) !== control.showIf.equals) continue;
		// `section` is optional; controls without it render as a
		// flat list with no sub-heading/disclosure (graceful degrade if a control ever ships without
		// one). Each distinct section becomes its own disclosure - default open for the
		// FIRST section of the group, collapsed for the rest, unless `isSectionOpen` (restored
		// sessionStorage state) says otherwise.
		if (control.section && control.section !== lastSection) {
			// Every section starts OPEN by
			// default, unless `isSectionOpen` (restored sessionStorage state) says otherwise -
			// superseding this module's earlier "only the first section starts open" rule.
			const isOpen = opts.isSectionOpen ? opts.isSectionOpen(groupName, control.section, isFirstSection) : true;
			if (isFirstSection) firstSectionName = control.section;
			const sectionEl = document.createElement('div');
			sectionEl.className = 'svc-section';
			sectionEl.dataset.section = control.section;
			sectionEl.dataset.open = isOpen ? 'true' : 'false';

			const sectionToggle = document.createElement('button');
			sectionToggle.type = 'button';
			sectionToggle.className = 'svc-section-toggle';
			sectionToggle.setAttribute('aria-expanded', String(isOpen));
			sectionToggle.innerHTML = `<span class="svc-section-toggle-label">${escapeHtml(control.section)}</span><span class="svc-section-dot" hidden aria-hidden="true"></span><span class="svc-section-caret" aria-hidden="true">▾</span>`;
			sectionToggle.addEventListener('click', () => {
				const nextOpen = sectionEl.dataset.open === 'false';
				sectionEl.dataset.open = nextOpen ? 'true' : 'false';
				sectionToggle.setAttribute('aria-expanded', String(nextOpen));
				opts.onSectionToggle?.(groupName, control.section, nextOpen);
			});
			sectionEl.appendChild(sectionToggle);

			const sectionBody = document.createElement('div');
			sectionBody.className = 'svc-section-body';
			sectionEl.appendChild(sectionBody);

			body.appendChild(sectionEl);
			sections.set(control.section, { root: sectionEl, dot: sectionToggle.querySelector('.svc-section-dot'), controlIds: [] });
			currentSectionBody = sectionBody;
			isFirstSection = false;
		}
		lastSection = control.section;
		const { root: rowRoot, refresh } = createControlRow(control, state, handlers, {
			isCardOpen: opts.isCardOpen,
			onCardToggle: opts.onCardToggle,
		});
		if (control.section) {
			rowRoot.dataset.section = control.section;
			sections.get(control.section).controlIds.push(control.id);
		}
		(control.section ? currentSectionBody : body).appendChild(rowRoot);
		controlRows.set(control.id, { root: rowRoot, refresh });
	}

	/** Item 3: a small dot on a section header when any control inside differs from its default, so
	 * a change is still visible while its section is collapsed. Computed once at build time (so a
	 * restored non-default state shows dots immediately, before any further change) and re-exposed
	 * for panel.js to call again after later changes (see scheduleApply's rAF tick in panel.js). */
	function refreshSectionDots(nextState) {
		for (const info of sections.values()) {
			const dirty = info.controlIds.some((id) => {
				const control = controlById.get(id);
				return control && getValue(nextState, id) !== control.default;
			});
			info.dot.hidden = !dirty;
		}
	}
	refreshSectionDots(state);

	return { controlRows, refreshSectionDots, firstSectionName };
}

/**
 * The studio's panel-column rendering of one group - no accordion (the rail selects
 * which group shows; `svc-panel-sections[data-filtering]` in styles.js controls visibility), just a
 * heading (shown only while the control filter has matching text, so a multi-group search result
 * still says which group each row belongs to) followed by the SAME section/control DOM
 * `createGroupSection` would build (via `buildGroupSectionsInto`).
 * @param {string} groupName
 * @param {import('../core/manifest.js').Control[]} groupControls
 * @param {import('../core/state.js').ThemeState} state
 * @param {ControlHandlers} handlers
 * @param {{title?: string, isSectionOpen?: Function, onSectionToggle?: Function}} [opts]
 * @returns {{root: HTMLElement, body: HTMLElement, controlRows: Map, refreshSectionDots: Function, firstSectionName: string|undefined}}
 */
export function createStudioGroupPanel(groupName, groupControls, state, handlers, opts = {}) {
	const root = document.createElement('section');
	root.className = 'svc-group svc-group-studio';
	root.dataset.group = groupName;
	root.dataset.open = 'true'; // studio groups have no group-level collapse - only sections do

	const heading = document.createElement('div');
	heading.className = 'svc-group-studio-heading';
	heading.innerHTML = `<span class="svc-group-icon">${groupIconSvg(groupName)}</span><span>${escapeHtml(opts.title ?? groupName)}</span>`;
	root.appendChild(heading);

	const body = document.createElement('div');
	body.className = 'svc-group-body';
	root.appendChild(body);

	const { controlRows, refreshSectionDots, firstSectionName } = buildGroupSectionsInto(body, groupName, groupControls, state, handlers, opts);

	return { root, body, controlRows, refreshSectionDots, firstSectionName };
}

/** The swatch strip's fixed token order: accent-low, accent, accent-high, then four grays light to
 * dark (a spread of 4 of `getPalettes`' 7 light-mode gray steps: 7/5/3/1). */
const PRESET_SWATCH_TOKENS = ['accent-low', 'accent', 'accent-high', 'gray-7', 'gray-5', 'gray-3', 'gray-1'];

/**
 * A palette swatch strip under the preset name - seven small bordered squares (accent-low/accent/
 * accent-high, then four grays light to dark), from the preset's light palette. Each
 * swatch gets its own thin border (`.svc-preset-swatch` in styles.js) so a very light gray still
 * reads as a distinct square against the docked studio's white card.
 * @param {import('../core/color.js').HexPalette} palette The preset's light palette.
 * @returns {HTMLElement}
 */
function buildPresetSwatchStrip(palette) {
	const strip = document.createElement('div');
	strip.className = 'svc-preset-swatches';
	for (const token of PRESET_SWATCH_TOKENS) {
		const swatch = document.createElement('span');
		swatch.className = 'svc-preset-swatch';
		swatch.style.background = palette[token];
		swatch.title = `${token}: ${palette[token]}`;
		strip.appendChild(swatch);
	}
	return strip;
}

/**
 * @param {import('../core/presets.js').Preset[]} presetList
 * @param {import('../core/state.js').ThemeState} state
 * @param {ControlHandlers} handlers
 * @returns {HTMLElement}
 */
export function createPresetGallery(presetList, state, handlers) {
	const wrap = document.createElement('div');
	wrap.className = 'svc-presets-grid';
	for (const preset of presetList) {
		const isSelected = state.preset === preset.id;
		const card = document.createElement('button');
		card.type = 'button';
		card.className = 'svc-preset-card' + (isSelected ? ' svc-preset-active' : '');
		card.setAttribute('aria-pressed', String(isSelected));
		card.title = preset.description;
		card.addEventListener('click', () => handlers.onApplyPreset(preset.id));
		const palette = getPresetLightPalette(preset);

		// One anchor color on the card's start side: the preset's accent, the color it is known by.
		const anchor = document.createElement('span');
		anchor.className = 'svc-preset-anchor';
		anchor.style.background = palette.accent;
		anchor.setAttribute('aria-hidden', 'true');
		card.appendChild(anchor);

		// The description moved to the card's own `title` tooltip above - showing it a
		// second time as body text was redundant, so it isn't rendered here.
		const meta = document.createElement('div');
		meta.className = 'svc-preset-meta';
		const name = document.createElement('span');
		name.className = 'svc-preset-name';
		name.textContent = preset.label;
		meta.appendChild(name);
		meta.appendChild(buildPresetSwatchStrip(palette));
		card.appendChild(meta);

		// E2: "the selected card uses the same strong selected treatment as the rail (accent border
		// and check)" - the rail's accent + check without the rail's solid fill, which would bury the
		// card's swatch strip.
		if (isSelected) {
			const check = document.createElement('span');
			check.className = 'svc-preset-check';
			check.innerHTML = '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
			card.appendChild(check);
		}

		wrap.appendChild(card);
	}
	return wrap;
}

/**
 * Builds the live WCAG contrast readout block (Colors group). Ratios/pass-badges are supplied via
 * `refresh()` by the caller (panel.js owns the DOM-probe based color resolution).
 * @returns {{root: HTMLElement, refresh: (rows: {label:string, ratio:number}[]) => void}}
 */
export function createContrastBlock() {
	const root = document.createElement('div');
	root.className = 'svc-contrast';
	const heading = document.createElement('h4');
	heading.textContent = 'Contrast (WCAG)';
	root.appendChild(heading);

	const rowsContainer = document.createElement('div');
	root.appendChild(rowsContainer);

	function badge(pass, label) {
		const span = document.createElement('span');
		span.className = pass ? 'svc-pass' : 'svc-fail';
		span.textContent = label;
		return span;
	}

	/** @param {{label:string, ratio:number}[]} rows */
	function refresh(rows) {
		rowsContainer.replaceChildren();
		for (const { label, ratio } of rows) {
			const row = document.createElement('div');
			row.className = 'svc-contrast-row';
			const labelEl = document.createElement('span');
			labelEl.textContent = `${label}: ${ratio.toFixed(2)}:1`;
			row.appendChild(labelEl);
			const badges = document.createElement('span');
			badges.className = 'svc-contrast-badges';
			badges.appendChild(badge(ratio >= 4.5, 'AA'));
			badges.appendChild(badge(ratio >= 7, 'AAA'));
			row.appendChild(badges);
			rowsContainer.appendChild(row);
		}
	}

	return { root, refresh };
}

/**
 * The contrast-warnings dialog (opened from the context line's contrast check) (a table: mode, pair, swatches, ratio,
 * target, pass/fail). Built in `controls.js` (not `studio.js`, which lives in the studio's light
 * DOM) so it can reuse the SAME `.svc-dialog*` shadow-DOM CSS `export.js`'s dialog already has -
 * appended into `panel.js`'s shadow root, alongside the export dialog.
 * @returns {{root: HTMLElement, open: (report: {rows: Array<{mode:string,label:string,ratio:number,target:number,pass:boolean,textColor:string,bgColor:string}>}) => void, close: () => void}}
 */
export function createContrastDialog() {
	const backdrop = document.createElement('div');
	backdrop.className = 'svc-dialog-backdrop';
	backdrop.hidden = true;
	backdrop.addEventListener('click', (event) => {
		if (event.target === backdrop) close();
	});
	backdrop.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') close();
	});

	const dialog = document.createElement('div');
	dialog.className = 'svc-dialog';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Contrast warnings');
	backdrop.appendChild(dialog);

	const header = document.createElement('div');
	header.className = 'svc-dialog-header';
	const title = document.createElement('h3');
	title.textContent = 'Contrast';
	header.appendChild(title);
	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'svc-icon-btn';
	closeBtn.textContent = '✕';
	closeBtn.setAttribute('aria-label', 'Close contrast dialog');
	closeBtn.addEventListener('click', () => close());
	header.appendChild(closeBtn);
	dialog.appendChild(header);

	const body = document.createElement('div');
	body.style.overflowY = 'auto';
	body.style.padding = '0.75rem 1rem';
	dialog.appendChild(body);

	function close() {
		backdrop.hidden = true;
	}
	function open(report) {
		const table = document.createElement('table');
		table.className = 'svc-contrast-dialog-table';
		const thead = document.createElement('thead');
		thead.innerHTML = '<tr><th>Mode</th><th>Pair</th><th>Colors</th><th>Ratio</th><th>Target</th><th>Result</th></tr>';
		table.appendChild(thead);
		const tbody = document.createElement('tbody');
		for (const row of report.rows) {
			const tr = document.createElement('tr');
			const swatches = `<span class="svc-contrast-dialog-swatch" style="background:${escapeHtml(row.textColor)}"></span><span class="svc-contrast-dialog-swatch" style="background:${escapeHtml(row.bgColor)}"></span>`;
			// P2 fix: the class used to go directly on the <td> - `display:inline-block` (from
			// .svc-pass/.svc-fail, shared with the Colors group's small inline badge) on a table cell
			// overrides its native `display:table-cell`, which is what put the text above the row's
			// baseline. A <span> inside a plain <td> keeps normal cell layout; `.svc-result-pill` gives
			// it its own readable size/shape instead of inheriting the smaller inline-badge style.
			const resultClass = row.pass ? 'svc-result-pill svc-result-pass' : 'svc-result-pill svc-result-fail';
			tr.innerHTML = `<td>${escapeHtml(row.mode)}</td><td>${escapeHtml(row.label)}</td><td>${swatches}</td><td>${row.ratio.toFixed(2)}:1</td><td>${row.target}:1</td><td><span class="${resultClass}">${row.pass ? 'Pass' : 'Fail'}</span></td>`;
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		body.replaceChildren(table);
		backdrop.hidden = false;
		closeBtn.focus();
	}

	return { root: backdrop, open, close };
}

/** @param {HTMLElement} group @param {boolean} open */
function setGroupOpen(group, open) {
	group.dataset.open = open ? 'true' : 'false';
	group.querySelector('.svc-group-toggle')?.setAttribute('aria-expanded', String(open));
}

/** @param {HTMLElement} section @param {boolean} open */
function setSectionOpen(section, open) {
	section.dataset.open = open ? 'true' : 'false';
	section.querySelector('.svc-section-toggle')?.setAttribute('aria-expanded', String(open));
}

/** Same contract, one level down, for a control card. @param {HTMLElement} card @param {boolean} open */
function setCardOpen(card, open) {
	card.dataset.open = open ? 'true' : 'false';
	card.querySelector(':scope > .svc-control-head .svc-control-toggle')?.setAttribute('aria-expanded', String(open));
}

/**
 * @param {HTMLElement} bodyRoot The `.svc-body` element (contains `.svc-group` sections).
 * @param {string} filterText
 * @param {(groupName: string) => boolean} [restoreOpen] When the filter is cleared, decides each
 *   group's open/closed state (its last user-chosen state) instead of leaving whatever a previous
 *   filter match forced it open to. Falls back to "leave as-is" when omitted.
 * @param {(groupName: string, sectionName: string) => boolean} [restoreSectionOpen] Item 3: same
 *   contract, one level down, for each section's own open/closed state.
 * @param {(controlId: string) => boolean} [restoreCardOpen] Same contract, one level
 *   further down, for each control card's own open/closed state.
 */
export function applyControlFilter(bodyRoot, filterText, restoreOpen, restoreSectionOpen, restoreCardOpen) {
	const needle = filterText.trim().toLowerCase();
	const groups = bodyRoot.querySelectorAll('.svc-group[data-group]');
	for (const group of groups) {
		if (group.dataset.group === 'Presets' || group.dataset.group === 'Navigation') continue; // not control rows
		const sections = group.querySelectorAll('.svc-section[data-section]');
		if (!needle) {
			group.hidden = false;
			for (const row of group.querySelectorAll('.svc-control')) {
				row.hidden = false;
				const shouldOpenCard = restoreCardOpen ? restoreCardOpen(row.dataset.controlId) : row.dataset.open === 'true';
				setCardOpen(row, shouldOpenCard);
			}
			for (const section of sections) {
				section.hidden = false;
				const shouldOpen = restoreSectionOpen
					? restoreSectionOpen(group.dataset.group, section.dataset.section)
					: section.dataset.open === 'true';
				setSectionOpen(section, shouldOpen);
			}
			if (restoreOpen) setGroupOpen(group, restoreOpen(group.dataset.group));
			continue;
		}
		let anyVisible = false;
		/** @type {Map<string, boolean>} section name -> whether any of its rows currently match */
		const sectionVisible = new Map();
		for (const row of group.querySelectorAll('.svc-control')) {
			const match = (row.dataset.label || '').includes(needle);
			row.hidden = !match;
			// P4: a filter match must actually be visible, so a matched card can't stay collapsed
			// behind its own header - the user's own choice is restored once the filter clears above.
			if (match) setCardOpen(row, true);
			if (match) anyVisible = true;
			if (row.dataset.section) sectionVisible.set(row.dataset.section, (sectionVisible.get(row.dataset.section) ?? false) || match);
		}
		for (const section of sections) {
			const hasMatch = !!sectionVisible.get(section.dataset.section);
			section.hidden = !hasMatch;
			// Auto-open a section while it contains a live filter match, so the match is actually
			// visible - the user's own open/closed choice is restored once the filter is cleared above.
			if (hasMatch) setSectionOpen(section, true);
		}
		group.hidden = !anyVisible;
		if (anyVisible) setGroupOpen(group, true);
	}
}
