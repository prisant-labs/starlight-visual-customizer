/**
 * @file Schematic wireframe tiles (SPEC.md "B" tiles item 2, second bullet) for the six
 * layout/alignment controls: tiny inline-SVG page-layout diagrams (header bar / sidebar / content
 * column / TOC rail as blocks) drawn with the live theme's `--sl-color-*` tokens (via `style="fill:
 * var(...)"`, which Chromium resolves the same as any other CSS value) so they recolor with the
 * rest of the panel's live samples, with the region the option moves picked out in the accent
 * color. Pure functions of `(controlId, optionValue)` -> an `<svg>` string; no DOM dependency, no
 * cloning (these controls have no single "real" element worth cloning - the diagram IS the point).
 */

const W = 160;
const H = 112;
/** Item 5: cropped-wide canvas for the alignment diagrams whose rendered aspect ratio needs to
 * clear the grid-vs-rows rule's ~2:1 threshold (`tiles/index.js`'s `computeTileLayout`) - these
 * three show only "the part that matters" (a short, wide strip) rather than a whole-page mockup,
 * per the maintainer's brief. `toc.position` and `content.heroAlign` keep the default `W`x`H`
 * page-chrome canvas: both genuinely need the sidebar/TOC/hero context to read, and
 * `content.heroAlign` already clears the rows threshold on label length alone (see WIREFRAME_SIZE
 * below and the report). */
const WIDE_W = 220;
const WIDE_H = 64;
const BG = 'var(--sl-color-bg)';
const NAV_BG = 'var(--sl-color-bg-nav)';
const SIDEBAR_BG = 'var(--sl-color-bg-sidebar)';
const HAIRLINE = 'var(--sl-color-hairline)';
const GRAY = 'var(--sl-color-gray-5)';
const GRAY_LIGHT = 'var(--sl-color-gray-6)';
const ACCENT = 'var(--sl-color-accent)';
const ACCENT_STROKE = 'var(--sl-color-text-accent)';

/** @param {string} s */
const esc = (s) => String(s);

function rect(x, y, w, h, fill, opts = {}) {
	const stroke = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.strokeWidth ?? 1.5}"` : '';
	const rx = opts.rx ?? 2;
	return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" style="fill:${fill}"${stroke ? esc(stroke) : ''} />`;
}

function svgWrap(inner, w = W, h = H) {
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">
		${rect(0, 0, w, h, BG, { rx: 4, stroke: HAIRLINE, strokeWidth: 1 })}
		${inner}
	</svg>`;
}

/** Header + sidebar + content(+TOC) page chrome shared by several diagrams. */
function pageChrome({ toc = true } = {}) {
	const headerH = 16;
	const sidebarW = 36;
	const tocW = toc ? 28 : 0;
	return {
		headerH,
		sidebarW,
		tocW,
		contentX: sidebarW + 4,
		contentRight: W - tocW - 4,
		parts: [
			rect(0, 0, W, headerH, NAV_BG, { rx: 0 }),
			rect(0, headerH, sidebarW, H - headerH, SIDEBAR_BG, { rx: 0 }),
			toc ? rect(W - tocW, headerH, tocW, H - headerH, BG, { rx: 0, stroke: HAIRLINE, strokeWidth: 1 }) : '',
		].join(''),
	};
}

/**
 * Item 5: cropped to "the header strip with the search box plus a hint of the content column
 * edge" (maintainer's brief), on the wide `WIDE_W`x`WIDE_H` canvas - no sidebar/content-below
 * chrome, since neither is what this control changes. The gray block under the header's left
 * portion is that "hint of the content column edge" peeking out below the bar.
 */
function headerSearchAlign(option) {
	const headerH = 34;
	const cellX = 66;
	const cellW = 120;
	const pillW = option === 'stretch' ? cellW - 6 : 46;
	let pillX;
	if (option === 'center') pillX = cellX + (cellW - pillW) / 2;
	else if (option === 'end') pillX = cellX + cellW - pillW - 3;
	else pillX = cellX + 3; // 'default' | 'stretch'
	const parts =
		rect(0, 0, WIDE_W, headerH, NAV_BG, { rx: 0 }) +
		rect(0, headerH + 4, 48, WIDE_H - headerH - 4, GRAY_LIGHT, { rx: 0 }) +
		rect(cellX, 6, cellW, headerH - 12, 'transparent', { stroke: GRAY, strokeWidth: 1 }) +
		rect(pillX, 8, pillW, headerH - 16, ACCENT);
	return svgWrap(parts, WIDE_W, WIDE_H);
}

/**
 * Item 5: cropped to a short wide band showing just the sidebar edge | content column | TOC edge
 * relationship (what "hugs the TOC / hugs the sidebar / center" actually means), rather than a
 * full page mockup - the header bar isn't part of what this control changes, so it's dropped.
 */
function contentAlign(option) {
	const sidebarW = 40;
	const tocW = 32;
	const contentX = sidebarW + 6;
	const contentRight = WIDE_W - tocW - 6;
	const gapW = contentRight - contentX;
	const colW = Math.round(gapW * 0.62);
	let colX;
	if (option === 'start') colX = contentX;
	else if (option === 'center') colX = contentX + (gapW - colW) / 2;
	else colX = contentRight - colW; // 'default' hugs the TOC
	const bandY = 14;
	const bandH = WIDE_H - 28;
	const parts =
		rect(0, 0, sidebarW, WIDE_H, SIDEBAR_BG, { rx: 0 }) +
		rect(WIDE_W - tocW, 0, tocW, WIDE_H, BG, { rx: 0, stroke: HAIRLINE, strokeWidth: 1 }) +
		rect(colX, bandY, colW, bandH, GRAY_LIGHT, { stroke: ACCENT_STROKE, strokeWidth: 2 });
	return svgWrap(parts, WIDE_W, WIDE_H);
}

function tocPosition(option) {
	const sidebarW = 36;
	const tocW = 28;
	const headerH = 16;
	const base = [
		rect(0, 0, W, headerH, NAV_BG, { rx: 0 }),
		rect(0, headerH, sidebarW, H - headerH, SIDEBAR_BG, { rx: 0 }),
	].join('');
	if (option === 'left') {
		return svgWrap(
			base +
				rect(sidebarW, headerH, tocW, H - headerH, BG, { rx: 0, stroke: ACCENT_STROKE, strokeWidth: 2 }) +
				rect(sidebarW + tocW + 4, headerH + 6, W - sidebarW - tocW - 8, H - headerH - 12, GRAY_LIGHT)
		);
	}
	if (option === 'window-right') {
		// F5: distinct from 'right' (tiles.mjs's "no two option tiles pixel-identical") - the content
		// column stays NARROW (its own alignment rules, unchanged) while the rail sits flush at the
		// canvas's own outer edge, leaving a visible gap between them - unlike 'right', where content
		// hugs the rail directly with no gap.
		const contentW = Math.round((W - sidebarW - tocW) * 0.55);
		return svgWrap(
			base +
				rect(sidebarW + 4, headerH + 6, contentW, H - headerH - 12, GRAY_LIGHT) +
				rect(W - tocW, headerH, tocW, H - headerH, BG, { rx: 0, stroke: ACCENT_STROKE, strokeWidth: 2 })
		);
	}
	return svgWrap(
		base +
			rect(sidebarW + 4, headerH + 6, W - sidebarW - tocW - 8, H - headerH - 12, GRAY_LIGHT) +
			rect(W - tocW, headerH, tocW, H - headerH, BG, { rx: 0, stroke: ACCENT_STROKE, strokeWidth: 2 })
	);
}

/**
 * Item 5: cropped to just the content column's top - title line plus two body lines - no
 * header/sidebar/TOC chrome, on the wide canvas. Only the title bar moves per option; the body
 * lines stay start-aligned regardless (this control only affects the page `<h1>`).
 */
function titleAlign(option) {
	const colX = 14;
	const colW = WIDE_W - 2 * colX;
	const titleW = 60;
	const titleX = option === 'center' ? colX + (colW - titleW) / 2 : colX;
	const parts =
		rect(titleX, 10, titleW, 12, ACCENT_STROKE) +
		rect(colX, 32, colW, 7, GRAY) +
		rect(colX, 44, colW * 0.65, 7, GRAY);
	return svgWrap(parts, WIDE_W, WIDE_H);
}

function heroAlign(option) {
	if (option === 'center') {
		return svgWrap(
			rect(40, 16, 80, 24, GRAY, { rx: 0 }) +
				rect(50, 46, 60, 6, ACCENT_STROKE) +
				rect(55, 56, 50, 6, GRAY) +
				rect(64, 68, 32, 12, ACCENT)
		);
	}
	// 'default' and 'start' share the same side-by-side arrangement in this abstract diagram; the
	// real difference (see treatments.js) is which breakpoint the arrangement is gated behind, not
	// the arrangement itself.
	const strokeOpts = option === 'start' ? { stroke: ACCENT_STROKE, strokeWidth: 2 } : {};
	return svgWrap(
		rect(14, 24, 78, 8, ACCENT_STROKE, strokeOpts) +
			rect(14, 38, 60, 6, GRAY) +
			rect(14, 48, 40, 12, ACCENT) +
			rect(104, 16, 44, 44, GRAY_LIGHT, strokeOpts)
	);
}

/** Item 5: cropped to "just the two cards" (maintainer's brief) - no page chrome at all - on the
 * wide canvas, so the crop has no empty band above/below (the old 160x112 canvas left ~15px of
 * dead space on each side of the cards). */
function paginationAlign(option) {
	const cardH = 34;
	const rowY = (WIDE_H - cardH) / 2;
	let parts;
	if (option === 'center') {
		const cardW = 58;
		const gap = 10;
		const startX = (WIDE_W - (cardW * 2 + gap)) / 2;
		parts =
			rect(startX, rowY, cardW, cardH, GRAY_LIGHT, { stroke: ACCENT_STROKE, strokeWidth: 2 }) +
			rect(startX + cardW + gap, rowY, cardW, cardH, GRAY_LIGHT, { stroke: ACCENT_STROKE, strokeWidth: 2 });
	} else if (option === 'stretch') {
		parts =
			rect(8, rowY, 96, cardH, GRAY_LIGHT) +
			rect(16, rowY + cardH / 2 - 3, 10, 6, ACCENT) +
			rect(70, rowY + cardH / 2 - 3, 22, 6, ACCENT) +
			rect(116, rowY, 96, cardH, GRAY_LIGHT) +
			rect(124, rowY + cardH / 2 - 3, 22, 6, ACCENT) +
			rect(186, rowY + cardH / 2 - 3, 10, 6, ACCENT);
	} else {
		parts = rect(8, rowY, 96, cardH, GRAY_LIGHT) + rect(116, rowY, 96, cardH, GRAY_LIGHT);
	}
	return svgWrap(parts, WIDE_W, WIDE_H);
}

/** @type {Record<string, (option: string) => string>} */
const RENDERERS = {
	'header.searchAlign': headerSearchAlign,
	'layout.contentAlign': contentAlign,
	'toc.position': tocPosition,
	'content.titleAlign': titleAlign,
	'content.heroAlign': heroAlign,
	'footer.paginationAlign': paginationAlign,
};

/**
 * Item 5: each wireframe's intended canvas size - the "encoded aspect" data
 * `tiles/index.js`'s `computeTileLayout` reads to decide grid vs rows. Every wireframe is inline
 * SVG with `width="100%" height="100%"` inside this exact viewBox (see `svgWrap`), so it always
 * fills its box exactly - this size IS the tile's real rendered aspect ratio, not an estimate.
 * @type {Record<string, {w: number, h: number}>}
 */
export const WIREFRAME_SIZE = {
	'header.searchAlign': { w: WIDE_W, h: WIDE_H },
	'layout.contentAlign': { w: WIDE_W, h: WIDE_H },
	'toc.position': { w: W, h: H },
	'content.titleAlign': { w: WIDE_W, h: WIDE_H },
	'content.heroAlign': { w: W, h: H },
	'footer.paginationAlign': { w: WIDE_W, h: WIDE_H },
};

/**
 * @param {string} controlId
 * @param {string} optionValue
 * @returns {string|null} Inline `<svg>` markup, or `null` if this control has no wireframe renderer.
 */
export function renderWireframe(controlId, optionValue) {
	const fn = RENDERERS[controlId];
	return fn ? fn(optionValue) : null;
}

/** @type {Set<string>} */
export const WIREFRAME_CONTROL_IDS = new Set(Object.keys(RENDERERS));
