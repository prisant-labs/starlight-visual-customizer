/**
 * @file Single entry point `controls.js` uses to decide, per `select`-type control, whether it
 * renders as a clickable tile grid and if so which of the two renderers
 * (`tile-grid.js`'s live-sample vs wireframe modes) to use. Two selects stay plain `<select>`
 * dropdowns because their options aren't visual: `color.contrastFloor` (a numeric ratio choice, AA
 * vs AAA) and `code.theme` (build-time only - the preview already shows a note instead of live
 * syntax colors, so a tile would have nothing true to render).
 */
import { WIREFRAME_CONTROL_IDS, WIREFRAME_SIZE } from './wireframes.js';
import { SAMPLE_VIRTUAL_WIDTH, SAMPLE_INTENDED_HEIGHT } from './samples.js';
import { createLiveSampleGrid, createWireframeGrid } from './tile-grid.js';

/** Selects with visual options that are NOT covered by a wireframe - i.e. render as live-sample tiles. */
const LIVE_SAMPLE_CONTROL_IDS = new Set([
	'header.style',
	'header.searchTriggerStyle',
	'sidebar.activeStyle',
	'sidebar.groupLabelStyle',
	'toc.currentItemStyle',
	'content.asideStyle',
	'content.inlineCodeStyle',
	'content.linkStyle',
	'content.tableStyle',
	'components.tabsIndicatorStyle',
	'footer.paginationStyle',
	'layout.shadowElevation',
	'type.headingCase',
	'content.blockquoteStyle',
	'components.cardStyle',
	'components.linkButtonStyle',
	'components.badgeStyle',
]);

/** Every `select`-type control id that renders as a tile grid instead of a `<select>`. */
export const TILE_CONTROL_IDS = new Set([...LIVE_SAMPLE_CONTROL_IDS, ...WIREFRAME_CONTROL_IDS]);

// ---------------------------------------------------------------------------------------------
// Item 5: grid-vs-rows layout rule ("a rule, not taste"). `rows` when (a) the control's encoded
// sample/wireframe aspect ratio is wide (over ~2:1 at its virtual width - samples.js's
// SAMPLE_INTENDED_HEIGHT / wireframes.js's WIREFRAME_SIZE) OR (b) its option labels would wrap to
// 2+ lines in the ~150px grid tile (average label length over a calibrated threshold). Exported so
// the e2e suite computes `data-layout` expectations from this SAME function rather than
// reimplementing the rule.
// ---------------------------------------------------------------------------------------------

/** "aspect ratio above ~2:1", taken literally - every control that needed
 * `rows` cleared this with room to spare (5.9, 3.5, 3.4) and every `grid` control stayed under 1.9. */
const ROWS_ASPECT_THRESHOLD = 2;

/**
 * Calibrated against REAL rendered caption wrapping, not guessed: measured every grid-layout
 * control's actual `.svc-tile-caption` line count on the dev server (Range.getClientRects, which
 * counts wrapped lines directly) at the panel's real ~129px caption width / 0.75rem font. Every
 * control that genuinely wrapped had an average option-label length of 17.5+; every control that
 * genuinely fit on one line had 14.3 or less - 15 is the threshold that separates them exactly. A
 * rougher "~12" example threshold was tried first; at 12, three controls expected to render as
 * `grid` (toc.currentItemStyle 13.3, type.headingCase 13.0, and
 * layout.contentAlign's aspect-driven case aside) would have tipped into `rows` despite never
 * actually wrapping.
 */
const ROWS_LABEL_AVG_THRESHOLD = 15;

/**
 * At the current panel width (about 300 to 360px),
 * every tile control lays out in ONE column (rows); two columns only if the panel is 480px or wider
 * and the samples are narrow". `computeTileLayout`'s `panelWidthPx` parameter defaults to the
 * panel column's real, fixed CSS width (`styles.js`'s `.svc-panel-col`) - there is currently no way
 * for it to actually reach 480px in this build, so every tiled control computes `rows` today; the
 * parameter exists (rather than hardcoding "always rows") so a future wider panel/viewport
 * automatically falls back to the old grid-vs-aspect-vs-label rule below it, unchanged.
 */
const ROWS_MIN_PANEL_WIDTH = 480;
/** Mirrors `.svc-panel-col`'s width in `styles.js` - kept as one named constant instead of a bare
 * literal so the two never silently drift apart. */
const DEFAULT_PANEL_WIDTH = 340;

/** @param {string} controlId @returns {number|null} width/height, or null with no encoded data. */
function intendedAspect(controlId) {
	if (WIREFRAME_CONTROL_IDS.has(controlId)) {
		const size = WIREFRAME_SIZE[controlId];
		return size ? size.w / size.h : null;
	}
	const w = SAMPLE_VIRTUAL_WIDTH[controlId];
	const h = SAMPLE_INTENDED_HEIGHT[controlId];
	return w && h ? w / h : null;
}

/**
 * Explicit, documented escape hatch for a control where the mechanical rule's output should be
 * second-guessed (an explicit override map only where the reason is documented here).
 * Empty: every tiled control's computed layout was kept as-is, including one case
 * that looks surprising at first glance (`content.linkStyle` computes `rows` because
 * 3 of its 4 labels really do wrap at avg 28.8 chars) - overriding it back to
 * `grid` would silently reintroduce the "wide strip in a square tile" problem this rule exists to
 * catch, so it's left as `rows` instead of masked.
 * @type {Record<string, 'grid'|'rows'>}
 */
export const TILE_LAYOUT_OVERRIDES = {};

/**
 * @param {import('../../core/manifest.js').Control} control
 * @param {number} [panelWidthPx] Defaults to the panel's real fixed width.
 * @returns {'grid'|'rows'}
 */
export function computeTileLayout(control, panelWidthPx = DEFAULT_PANEL_WIDTH) {
	if (Object.prototype.hasOwnProperty.call(TILE_LAYOUT_OVERRIDES, control.id)) {
		return TILE_LAYOUT_OVERRIDES[control.id];
	}
	// Below 480px, every tile control is one column, full stop - the old aspect/label rule below
	// only decides grid-vs-rows once there is actually enough width for two columns to make sense.
	if (panelWidthPx < ROWS_MIN_PANEL_WIDTH) return 'rows';
	const aspect = intendedAspect(control.id);
	if (aspect != null && aspect > ROWS_ASPECT_THRESHOLD) return 'rows';
	const options = control.options || [];
	if (options.length) {
		const avgLabelLength = options.reduce((sum, o) => sum + o.label.length, 0) / options.length;
		if (avgLabelLength > ROWS_LABEL_AVG_THRESHOLD) return 'rows';
	}
	return 'grid';
}

/**
 * @param {import('../../core/manifest.js').Control} control
 * @param {import('../../core/state.js').ThemeState} state
 * @param {(value: any) => void} onCommit
 * @param {(scroll: boolean) => void} notifyTarget
 * @returns {{root: HTMLElement, refresh: Function} | null} `null` for a control this module
 *   doesn't render as tiles (caller falls back to a plain `<select>`).
 */
export function createTileControl(control, state, onCommit, notifyTarget) {
	const layout = computeTileLayout(control);
	if (WIREFRAME_CONTROL_IDS.has(control.id)) return createWireframeGrid(control, state, onCommit, notifyTarget, layout);
	if (LIVE_SAMPLE_CONTROL_IDS.has(control.id)) return createLiveSampleGrid(control, state, onCommit, notifyTarget, layout);
	return null;
}

export { createFontList, ensureFontPreviewFacesInjected } from './fonts.js';
