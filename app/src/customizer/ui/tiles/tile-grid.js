/**
 * @file Shared tile-grid widget: a native `<input type=radio>` group rendered as a 2-column grid
 * of clickable option tiles - one rendered example on top, the option
 * label below, a clear ring on the selected tile, arrow-key navigation and visible focus for free
 * from the platform's own radio-group behavior (no custom keyboard handling needed). Two preview
 * strategies share this one grid/selection engine:
 *  - `createLiveSampleGrid` - real Starlight markup + real (cloned, scoped) Starlight CSS, for
 *    component treatments. One nested shadow root per grid (not per tile): cloning the page's
 *    stylesheets once per control, not once per option, keeps this cheap.
 *  - `createWireframeGrid` - inline SVG diagrams (`wireframes.js`), no cloning needed at all;
 *    rendered directly in the panel's own (already open) shadow root since they only reference
 *    `--sl-*` custom properties, which inherit through shadow boundaries regardless (`all: initial`
 *    on `:host` does not reset custom properties - excluded from the `all` shorthand by spec).
 * Both read `control.options` (every option, including the default) so the grid always has exactly
 * one tile per option.
 */
import { getValue } from '../../core/state.js';
import { treatments } from '../../core/treatments.js';
import { SHADOW_ELEVATIONS } from '../../core/emit-css.js';
import { scopeCss } from './scope-css.js';
import { clonePageStyleNodes } from './page-styles.js';
import { SAMPLE_BUILDERS, SAMPLE_CONTAIN_CSS, SAMPLE_VIRTUAL_WIDTH, SAMPLE_VIRTUAL_HEIGHT } from './samples.js';
import { renderWireframe, WIREFRAME_SIZE } from './wireframes.js';

let uidCounter = 0;

// ---------------------------------------------------------------------------------------------
// Fixed-width "virtual canvas", scaled to fit the tile: laying a real
// Starlight fragment out AT the tile's own ~150-180px width made multi-column layouts (pagination
// cards, the header's 3-column grid) collapse/wrap/clip long before they'd naturally do so on a
// real page, and cut off content on the right (search box, site title). Instead each live sample is
// laid out in an ordinary block at a representative desktop-ish pixel width (SAMPLE_VIRTUAL_WIDTH),
// then the whole block is transform:scale()'d down to the tile's ACTUAL rendered width - which
// isn't knowable at CSS-authoring time (panel width, grid gaps, tile borders all contribute), so a
// ResizeObserver computes the exact scale factor once the tile is actually laid out, and again on
// any resize. transform doesn't affect the scaled element's own contribution to its (absolutely
// positioned, so zero anyway) layout, so this can't itself blow out the grid the way the old
// zoom-based approach nearly did.
// ---------------------------------------------------------------------------------------------

/** @type {WeakMap<Element, {canvas: HTMLElement, virtualWidth: number, sizeToContent: boolean}>} */
const previewScaleTargets = new WeakMap();
/** @type {ResizeObserver | null} */
let sharedResizeObserver = null;

function getSharedResizeObserver() {
	if (!sharedResizeObserver) {
		sharedResizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const target = previewScaleTargets.get(entry.target);
				if (!target) continue;
				const width = entry.contentRect.width;
				if (width <= 0) continue;
				// Only ever scale DOWN, never up - now that every tile is a full-width "rows" tile,
				// stretching a sample authored for a narrow
				// 2-column tile up to fill it would enlarge its whitespace right along with its content,
				// working against the point of trimming samples down. Once the tile is
				// at least as wide as the sample's own virtual canvas, the canvas simply RE-LAYS-OUT at
				// the tile's real width (no transform) instead of being stretched.
				const scale = Math.min(1, width / target.virtualWidth);
				if (scale >= 1) {
					target.canvas.style.width = `${width}px`;
					target.canvas.style.transform = 'none';
				} else {
					target.canvas.style.width = `${target.virtualWidth}px`;
					target.canvas.style.transform = `scale(${scale})`;
				}
				if (target.sizeToContent) {
					// "rows" layout: no fixed 4:3 box - the preview's own
					// height tracks the SCALED canvas content height (offsetHeight is the canvas's real,
					// unscaled layout height; transform:scale never changes that, only the paint), so
					// there's no empty band below a short sample and no crop above a tall one. `height`
					// is a border-box property here (CHROME_CSS sets `box-sizing: border-box` globally),
					// so the preview's own top+bottom padding has to be added back on top of the scaled
					// CONTENT height, or the padding would eat into (and clip) the canvas.
					const scaledHeight = target.canvas.offsetHeight * scale;
					const cs = getComputedStyle(entry.target);
					const verticalPadding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
					entry.target.style.height = `${Math.ceil(scaledHeight + verticalPadding)}px`;
				}
			}
		});
	}
	return sharedResizeObserver;
}

/**
 * @param {HTMLElement} previewEl The `.svc-tile-preview` box (fixed 4:3, or height-tracks-content
 *   when `sizeToContent` is true - see `SAMPLE_LAYOUT`'s `'rows'` option).
 * @param {HTMLElement} canvasEl The fixed-pixel-width `.svc-tile-canvas` box inside it.
 * @param {number} virtualWidth
 * @param {boolean} [sizeToContent]
 */
function observePreviewScale(previewEl, canvasEl, virtualWidth, sizeToContent = false) {
	previewScaleTargets.set(previewEl, { canvas: canvasEl, virtualWidth, sizeToContent });
	getSharedResizeObserver().observe(previewEl);
}

/**
 * Starlight's own default `--sl-shadow-md` (`dist/style/props.css`), literal per theme. The
 * `layout.shadowElevation` "default" tile can't just read `var(--sl-shadow-md)` like the other
 * three options read their SHADOW_ELEVATIONS preset: when the control's *current* value is
 * non-default, emit-css.js has already overridden that same token on the real `:root`, which would
 * make the "default" tile wrongly show whichever option is currently selected instead of
 * Starlight's true default.
 */
const DEFAULT_SHADOW_MD = {
	dark: '0px 8px 4px hsla(0, 0%, 0%, 0.08), 0px 5px 2px hsla(0, 0%, 0%, 0.08), 0px 3px 2px hsla(0, 0%, 0%, 0.12), 0px 1px 1px hsla(0, 0%, 0%, 0.15)',
	light:
		'0px 8px 4px hsla(0, 0%, 0%, 0.03), 0px 5px 2px hsla(0, 0%, 0%, 0.03), 0px 3px 2px hsla(0, 0%, 0%, 0.06), 0px 1px 1px hsla(0, 0%, 0%, 0.06)',
};

/** Grid chrome (borders, hover lift, selected ring, radio placement) - the panel's own fixed
 * palette (see styles.js's file header: the panel must stay readable regardless of the page theme
 * it's editing), so this does NOT vary with `--sl-*` tokens even though tile *previews* do. Colors
 * are `var(--svc-tile-*, <dark fallback>)`, not literals: this grid mounts its OWN nested shadow
 * root (a separate stylesheet from styles.js's), but CSS custom properties still inherit down
 * through a shadow boundary from whatever ancestor sets them - the studio (docked) chrome sets
 * `--svc-tile-*` to light values on `:host([data-docked='true'])` in styles.js, so tile cards follow
 * the studio's light chrome automatically; a direct page visit (no `--svc-tile-*` set anywhere)
 * falls back to these same dark values. */
const CHROME_CSS = `
:host, .svc-tile-grid { all: initial; }
* { box-sizing: border-box; }
.svc-tile-grid {
	display: grid;
	/* minmax(0, 1fr), not a bare 1fr: a grid track's automatic minimum is its items' min-content size
	   unless capped, so a long unbreakable string cloned from the real page (e.g. a site title) would
	   otherwise blow the whole grid out past the panel's width. */
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.5rem;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
}
/* "rows" layout (SAMPLE_LAYOUT): one tile per row, spanning the full
   panel width - for samples that need to stay wide (a real search box, two pagination cards side by
   side) to read as anything other than a scaled-down sliver at a 2-column tile's ~150-180px width. */
.svc-tile-grid[data-layout='rows'] { grid-template-columns: minmax(0, 1fr); }
.svc-tile {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
	min-width: 0;
	border: 1px solid var(--svc-tile-border, #33363f);
	border-radius: 8px;
	background: var(--svc-tile-bg, #101217);
	padding: 0.375rem;
	cursor: pointer;
	transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}
.svc-tile:hover { transform: translateY(-2px); border-color: var(--svc-tile-accent, #6d8dfa); box-shadow: 0 4px 12px var(--svc-tile-hover-shadow, rgba(0, 0, 0, 0.35)); }
.svc-tile:has(.svc-tile-radio:checked) { border-color: var(--svc-tile-accent, #6d8dfa); box-shadow: 0 0 0 2px var(--svc-tile-accent, #6d8dfa) inset; background: var(--svc-tile-bg-selected, #171a29); }
.svc-tile:has(.svc-tile-radio:focus-visible) { outline: 2px solid var(--svc-tile-accent, #6d8dfa); outline-offset: 2px; }
/* Item 2: the caption row (label + selected indicator) sits ABOVE the preview, never on top of it. */
.svc-tile-caption-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.svc-tile-caption { flex: 1 1 auto; font-size: 0.75rem; color: var(--svc-tile-caption, #d3d7e0); text-align: start; line-height: 1.25; }
/* Small check glyph (item 2): the second, non-overlapping selection cue alongside the existing
   ring (.svc-tile:has(:checked) above). Hidden by default; shown only on the checked tile via the
   same :has() trick, so no per-tile JS toggling is needed. */
.svc-tile-indicator { flex-shrink: 0; width: 1rem; height: 1rem; color: var(--svc-tile-accent, #6d8dfa); opacity: 0; }
.svc-tile-indicator svg { display: block; width: 100%; height: 100%; }
.svc-tile:has(.svc-tile-radio:checked) .svc-tile-indicator { opacity: 1; }
/* The native radio stays in the DOM and focusable (arrow-key nav + the existing keyboard tests
   depend on it, and :has(:focus-visible) above needs a real focus target) but is visually hidden -
   selection reads through the ring + check glyph instead of a visible radio dot. Standard
   clip-rect "sr-only" technique, not display:none/visibility:hidden (both of which would drop it
   from focus/tab order and break keyboard navigation). */
.svc-tile-radio {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
.svc-tile-preview {
	position: relative;
	aspect-ratio: 4 / 3;
	width: 100%;
	min-width: 0;
	border-radius: 4px;
	overflow: hidden;
	background: var(--sl-color-bg, #1b1e25);
}
/* "rows"-layout preview: no fixed 4:3 - height is set in JS
   (observePreviewScale's ResizeObserver callback) to exactly match the scaled canvas content plus
   this small uniform padding, so there's no empty band and nothing gets cropped either. Wireframe
   grids instead set an explicit aspect-ratio inline style from their own SVG viewBox -
   see wireframes.js - and never get this class. */
.svc-tile-preview--fit { aspect-ratio: auto; padding: 0.5rem; }
/* Fixed-pixel-width "virtual canvas" (see the file-header comment above): laid out at its own real
   width, then scaled down as one block by a ResizeObserver-computed transform. Positioned absolute
   (top-left) so its untransformed layout footprint never affects .svc-tile-preview's own size. */
.svc-tile-canvas { position: absolute; top: 0; left: 0; transform-origin: top left; }
`;

function slugify(id) {
	return id.replace(/[^a-z0-9]+/gi, '-');
}

/** Small check glyph for the caption row's selected indicator (item 2). Decorative - the radio's
 * own `aria-label` already conveys selection to assistive tech, so this is `aria-hidden`. */
const CHECK_ICON_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.5"></path></svg>`;

/** @param {import('../../core/manifest.js').Control} control @param {any} value @returns {string} */
function optionCssFor(control, value) {
	if (value === control.default) return '';
	if (control.id === 'type.headingCase') {
		return `.sl-markdown-content { text-transform: ${value}; }`;
	}
	if (control.id === 'layout.shadowElevation') {
		const preset = SHADOW_ELEVATIONS[value];
		return preset ? `.svc-shadow-card { box-shadow: ${preset.md}; }` : '';
	}
	const entry = treatments[control.id] && treatments[control.id][value];
	let css = entry ? entry.css : '';
	if (control.id === 'header.style' && value === 'translucent-blur' && css) {
		// The other three header.style options keep page content flush with the bar's bottom edge
		// (see samples.js's SAMPLE_CONTAIN_CSS comment - overlap there just added visual noise around
		// an already-subtle 1px hairline); blur specifically needs something to actually blur, so
		// only this one option pulls content up to genuinely sit behind the (now translucent) bar.
		css += `\n.svc-header-page-content { padding-top: calc(var(--sl-nav-height, 3.5rem) - 0.9rem); }`;
	}
	if (control.id === 'content.linkStyle' && value === 'accent-bg-hover' && css) {
		// P6 (point 10, discovered while trimming this sample down to one line): "accent-bg-hover"'s
		// own CSS only paints on `:hover`, and a tile preview is `inert` (no pointer events ever reach
		// it) - so at rest it rendered PIXEL-IDENTICAL to "no-underline" (both just plain, non-
		// underlined text), which a shorter sample made visible where a longer one had been masking it
		// by accident. Restating the hover declarations on the base selector, in this tile's own SCOPED
		// copy only, shows the option's actual effect statically - also a genuine improvement (the
		// point of "accent background on hover" was otherwise invisible in a gallery nobody hovers).
		css += `\n.sl-markdown-content a:not(:where(.not-content *)) { background-color: var(--sl-color-accent-low); color: var(--sl-color-text-accent); }`;
	}
	return css;
}

/**
 * Shared skeleton: builds the radio-group grid and wires selection/hover/focus into `mount`,
 * delegating only "how does one tile's preview get built" to `buildPreview`.
 * @param {import('../../core/manifest.js').Control} control
 * @param {import('../../core/state.js').ThemeState} state
 * @param {(value: any) => void} onCommit
 * @param {(scroll: boolean) => void} notifyTarget
 * @param {(previewEl: HTMLElement, optionValue: any, index: number) => void} buildPreview
 * @param {Element|ShadowRoot} mount Where the grid's DOM is appended - a nested shadow root for
 *   live samples (so cloned page stylesheets don't leak onto the panel), or the wireframe's own
 *   plain `root` div (rendered straight into the panel's existing shadow root).
 * @param {'grid'|'rows'} [layout] `'grid'` (default): 2 columns. `'rows'`: one tile per row,
 *   spanning the full panel width - see `SAMPLE_LAYOUT` in samples.js.
 * @returns {{refresh: (state: import('../../core/state.js').ThemeState) => void}}
 */
function buildGrid(control, state, onCommit, notifyTarget, buildPreview, mount, layout = 'grid') {
	const grid = document.createElement('div');
	grid.className = 'svc-tile-grid';
	grid.dataset.layout = layout;
	mount.appendChild(grid);

	const name = `svc-tile-${slugify(control.id)}-${uidCounter++}`;
	/** @type {Map<string, HTMLInputElement>} */
	const radiosByValue = new Map();

	control.options.forEach((opt, i) => {
		const label = document.createElement('label');
		label.className = 'svc-tile';

		// Item 2 root-cause fix: an unlabeled `for` used to fall back to "first labelable descendant
		// in tree order", which was the cloned preview's own hidden Starlight controls (mobile theme
		// <select>, search <button>) rather than this radio. An explicit id/`for` pair makes the
		// label's default click action always activate THIS radio, independent of what the preview
		// happens to contain.
		const radioId = `${name}-${i}`;
		const radio = document.createElement('input');
		radio.type = 'radio';
		radio.id = radioId;
		radio.name = name;
		radio.value = String(opt.value);
		radio.className = 'svc-tile-radio';
		radio.checked = getValue(state, control.id) === opt.value;
		radio.setAttribute('aria-label', opt.label);
		radiosByValue.set(String(opt.value), radio);
		label.htmlFor = radioId;

		// Caption row (label left, selected-indicator right) sits ABOVE the preview - top to bottom:
		// caption row, then preview. Never anything drawn on top of the preview itself.
		const captionRow = document.createElement('div');
		captionRow.className = 'svc-tile-caption-row';
		const caption = document.createElement('span');
		caption.className = 'svc-tile-caption';
		caption.textContent = opt.label;
		const indicator = document.createElement('span');
		indicator.className = 'svc-tile-indicator';
		indicator.setAttribute('aria-hidden', 'true');
		indicator.innerHTML = CHECK_ICON_SVG;
		captionRow.appendChild(caption);
		captionRow.appendChild(indicator);

		const preview = document.createElement('div');
		preview.className = layout === 'rows' ? 'svc-tile-preview svc-tile-preview--fit' : 'svc-tile-preview';
		// Belt-and-suspenders for the same root cause: `inert` removes every cloned control inside the
		// preview (mobile theme <select>, search <button>, ...) from focus, tab order, AND hit-testing
		// in one property - a real mouse click physically landing on the preview now always resolves
		// to the label underneath instead of a cloned control, and Tab can never stop inside it either.
		// `pointer-events: none` (previously set here) is redundant once `inert` is set - dropped.
		preview.inert = true;
		buildPreview(preview, opt.value, i);

		label.appendChild(radio);
		label.appendChild(captionRow);
		label.appendChild(preview);
		grid.appendChild(label);

		radio.addEventListener('change', () => onCommit(opt.value));
		radio.addEventListener('focus', () => notifyTarget(true));
		label.addEventListener('pointerenter', () => notifyTarget(false));
	});

	function refresh(nextState) {
		const value = getValue(nextState, control.id);
		const radio = radiosByValue.get(String(value));
		if (radio) radio.checked = true;
	}

	return { refresh };
}

/**
 * @param {import('../../core/manifest.js').Control} control
 * @param {import('../../core/state.js').ThemeState} state
 * @param {(value: any) => void} onCommit
 * @param {(scroll: boolean) => void} notifyTarget
 * @param {'grid'|'rows'} [layout] Item 5: computed once by `tiles/index.js`'s `computeTileLayout`
 *   and passed down, rather than looked up here, so the rule lives in exactly one place (also
 *   avoids a circular import - `index.js` already imports the two `create*Grid` functions this
 *   module exports).
 * @returns {{root: HTMLElement, refresh: Function}}
 */
export function createLiveSampleGrid(control, state, onCommit, notifyTarget, layout = 'grid') {
	const host = document.createElement('div');
	host.className = 'svc-tiles';
	const shadow = host.attachShadow({ mode: 'open' });
	const chromeStyle = document.createElement('style');
	chromeStyle.textContent = CHROME_CSS;
	shadow.appendChild(chromeStyle);
	for (const node of clonePageStyleNodes()) shadow.appendChild(node);

	const buildSample = SAMPLE_BUILDERS[control.id];
	const template = buildSample ? buildSample() : null;
	const containCss = SAMPLE_CONTAIN_CSS[control.id] || '';
	const virtualWidth = SAMPLE_VIRTUAL_WIDTH[control.id] || 320;
	const virtualHeight = SAMPLE_VIRTUAL_HEIGHT[control.id];
	const tileStyleTexts = [];
	const gridUid = uidCounter++;

	const { refresh } = buildGrid(
		control,
		state,
		onCommit,
		notifyTarget,
		(preview, value, i) => {
			const scopeClass = `svc-sample-${gridUid}-${i}`;
			const canvas = document.createElement('div');
			canvas.className = `svc-tile-canvas ${scopeClass}`;
			canvas.style.width = `${virtualWidth}px`;
			if (virtualHeight) canvas.style.height = `${virtualHeight}px`;
			if (template) canvas.appendChild(template.cloneNode(true));
			preview.appendChild(canvas);
			observePreviewScale(preview, canvas, virtualWidth, layout === 'rows');
			const scoped = [scopeCss(containCss, `.${scopeClass}`), scopeCss(optionCssFor(control, value), `.${scopeClass}`)]
				.filter(Boolean)
				.join('\n');
			if (scoped) tileStyleTexts.push(scoped);
			if (control.id === 'layout.shadowElevation' && value === control.default) {
				// Hand-written (not run through scopeCss's generic `:root` -> tile-scope rewrite,
				// which would turn `:root[data-theme='light']` into a nonsensical attribute selector
				// on the tile itself): a real `:root[data-theme='light']` ANCESTOR condition,
				// descendant-combined with this one tile's scope class.
				tileStyleTexts.push(
					`.${scopeClass} .svc-shadow-card { box-shadow: ${DEFAULT_SHADOW_MD.dark}; }\n` +
						`:root[data-theme='light'] .${scopeClass} .svc-shadow-card { box-shadow: ${DEFAULT_SHADOW_MD.light}; }`
				);
			}
		},
		shadow,
		layout
	);

	if (tileStyleTexts.length) {
		const tileStyle = document.createElement('style');
		tileStyle.textContent = tileStyleTexts.join('\n');
		shadow.appendChild(tileStyle);
	}

	return { root: host, refresh };
}

/**
 * @param {import('../../core/manifest.js').Control} control
 * @param {import('../../core/state.js').ThemeState} state
 * @param {(value: any) => void} onCommit
 * @param {(scroll: boolean) => void} notifyTarget
 * @param {'grid'|'rows'} [layout] See `createLiveSampleGrid`'s doc for why this is passed in
 *   rather than looked up here.
 * @returns {{root: HTMLElement, refresh: Function}}
 */
export function createWireframeGrid(control, state, onCommit, notifyTarget, layout = 'grid') {
	const root = document.createElement('div');
	root.className = 'svc-tiles';
	const shadow = root.attachShadow({ mode: 'open' });
	const chromeStyle = document.createElement('style');
	chromeStyle.textContent = CHROME_CSS;
	shadow.appendChild(chromeStyle);

	// Item 5, `rows` layout: a wireframe has no `.svc-tile-canvas`/ResizeObserver (it's pure inline
	// SVG with `width="100%" height="100%"` inside its own viewBox - see wireframes.js's `svgWrap`),
	// so unlike a live-sample "rows" tile it needs no JS-measured height at all: an explicit
	// `aspect-ratio` inline style (from this control's own WIREFRAME_SIZE) makes the box exactly fit
	// the SVG's real aspect with no empty band and no cropping, overriding the default 4:3.
	const size = WIREFRAME_SIZE[control.id];
	const { refresh } = buildGrid(
		control,
		state,
		onCommit,
		notifyTarget,
		(preview, value) => {
			const svg = renderWireframe(control.id, value);
			if (svg) preview.innerHTML = svg;
			if (layout === 'rows' && size) {
				preview.style.aspectRatio = `${size.w} / ${size.h}`;
				// P6: a near-square/page-chrome wireframe (e.g. 160x112, aspect ~1.4) forced into a
				// full-width "rows" tile by P5 would otherwise stretch to an unreasonably tall diagram
				// (~210px at a ~300px row) - cap its rendered width so it stays a compact, centered
				// thumbnail. `2` mirrors tiles/index.js's own ROWS_ASPECT_THRESHOLD (not imported here to
				// avoid a circular import - index.js already imports this module); a genuinely WIDE
				// wireframe (already cropped to a short strip, aspect > 2) has no such problem and fills
				// the row as intended.
				if (size.w / size.h <= 2) {
					preview.style.maxWidth = '220px';
					preview.style.marginInline = 'auto';
				}
			}
		},
		shadow,
		layout
	);

	return { root, refresh };
}
