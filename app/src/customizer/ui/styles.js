/**
 * @file Shadow-DOM stylesheet for `<sl-customizer>`. Own neutral palette (fixed dark surface,
 * high-contrast text) that does NOT react to `document.documentElement.dataset.theme` - the panel
 * must stay readable regardless of which theme it is currently editing. `:host { all: initial }`
 * wipes every inherited/default property on the host element itself (including `display`,
 * `position`, custom properties inherited from the page), so every property the drawer needs is
 * re-declared explicitly here rather than assumed.
 */

export const panelStyles = `
:host {
	all: initial;
	display: block;
	position: fixed;
	inset-block-start: 0;
	inset-inline-end: 0;
	height: 100vh;
	z-index: 2147483000; /* Starlight's own z-indexes top out at 20 (--sl-z-index-skiplink) */
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
	font-size: 14px;
	line-height: 1.4;
	color: #e8eaed;
	pointer-events: none;
}

* {
	box-sizing: border-box;
}

/* Author-stylesheet [hidden] rules elsewhere in this file (e.g. \`display: flex\` on
   .svc-ia-details, .svc-control) sit at the same specificity as the UA default \`[hidden] {
   display: none }\` rule, and author styles always win ties over UA styles - so without this,
   toggling the \`hidden\` IDL property silently does nothing wherever another rule here also sets
   \`display\`. This one rule must stay ahead of (or just needs !important over) every such rule. */
[hidden] {
	display: none !important;
}

button, input, select, textarea {
	font: inherit;
	color: inherit;
}

.svc-drawer {
	pointer-events: auto;
	height: 100%;
	display: flex;
	justify-content: flex-end;
	position: relative; /* stacks above .svc-target-overlay (position:fixed, z-index:0) below */
	z-index: 1;
}

.svc-fab {
	position: fixed;
	inset-block-end: 1.25rem;
	inset-inline-end: 1.25rem;
	width: 3rem;
	height: 3rem;
	border-radius: 999px;
	border: 1px solid #3a3f4b;
	background: #23262e;
	color: #e8eaed;
	font-size: 1.25rem;
	cursor: pointer;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	pointer-events: auto;
}
.svc-fab:hover { background: #2c303a; }
.svc-fab:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
	outline: 2px solid #6d8dfa;
	outline-offset: 2px;
}

.svc-panel {
	width: min(400px, 100vw);
	height: 100%;
	display: flex;
	flex-direction: column;
	background: #1a1c22;
	border-inline-start: 1px solid #33363f;
	box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
}

:host([data-collapsed='true']) .svc-panel { display: none; }
:host(:not([data-collapsed='true'])) .svc-fab { display: none; }

/* ---- Docked layout (studio.astro's design doc, item A) ----
   Plain overlay mode leaves :host's own position:fixed/inset/z-index (above, near the top of this
   file) untouched - that's what makes the panel float over the page. In the studio the host document
   is itself display:flex with the preview column and this element as its two direct children (see
   studio.astro) - :host([data-docked]) drops out of fixed positioning to become an ordinary flex
   item instead, so the panel occupies real layout space and the frame beside it gets the rest, with
   no overlap and no double scrollbar. Collapsing still works exactly as above (.svc-panel itself goes
   display:none) - the rule below additionally collapses the HOST's own box to 0 width so the frame
   reclaims that space too ("when collapsed, the frame takes the full width"). The floating FAB button
   stays position:fixed regardless of dock state, so it's still reachable to re-expand. */
:host([data-docked='true']) {
	position: static;
	inset-block-start: auto;
	inset-inline-end: auto;
	height: 100%;
	/* The host contains BOTH the 72px rail and the 340px panel column -
	   there is no separate "collapsed to 0" state for the rail itself; only the panel column becomes
	   a drawer below 900px (data-drawer-open, see the studio-only block near the end of this file). */
	width: 412px;
	flex: 0 0 412px;
	z-index: auto;
	display: flex;
	flex-direction: row;
	/* P1 fix: :host's base rule (top of this file) sets pointer-events:none because in OVERLAY mode
	   the host is position:fixed and covers the whole viewport - only .svc-drawer/.svc-fab opt back
	   in. The rail and panel column are direct shadow-root children (not inside .svc-drawer), so
	   without this override every click on them fell through to whatever real-viewport element sits
	   underneath (confirmed via elementsFromPoint - a real page.mouse.click() left the rail
	   unresponsive even though script-dispatched clicks "worked"). Safe here because docked mode's
	   host occupies real, sized layout space (412px wide, a normal flex child) rather than a
	   viewport-covering fixed overlay, so there is no "underneath" content to protect. */
	pointer-events: auto;
}

.svc-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
	border-bottom: 1px solid #2c2f38;
	flex-shrink: 0;
}
.svc-header h2 { margin: 0; font-size: 1rem; font-weight: 600; }
/* Item 1: the "Follow on page" checkbox label used to sit tight against the icon buttons next to
   it - a wider gap plus white-space: nowrap on both the row and the label (below) keeps the
   checkbox text from crowding or wrapping against the buttons at the panel's ~400px width. */
.svc-header-actions { display: flex; align-items: center; gap: 0.75rem; white-space: nowrap; }

.svc-icon-btn {
	width: 2rem;
	height: 2rem;
	border-radius: 6px;
	border: 1px solid #3a3f4b;
	background: #23262e;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 0.95rem;
}
.svc-icon-btn:hover { background: #2c303a; }

.svc-toolbar {
	display: flex;
	gap: 0.5rem;
	padding: 0.625rem 1rem;
	border-bottom: 1px solid #2c2f38;
	flex-shrink: 0;
	flex-wrap: wrap;
}

.svc-filter {
	flex: 1 1 auto;
	min-width: 0;
	padding: 0.375rem 0.5rem;
	border-radius: 6px;
	border: 1px solid #3a3f4b;
	background: #101217;
	color: inherit;
}

.svc-btn {
	padding: 0.375rem 0.625rem;
	border-radius: 6px;
	border: 1px solid #3a3f4b;
	background: #23262e;
	cursor: pointer;
	white-space: nowrap;
}
.svc-btn:hover { background: #2c303a; }
.svc-btn.svc-btn-primary { background: #3552d6; border-color: #3552d6; color: #fff; }
.svc-btn.svc-btn-primary:hover { background: #4460e6; }
.svc-btn.svc-btn-danger { border-color: #6b2a2a; }
.svc-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.svc-body {
	flex: 1 1 auto;
	overflow-y: auto;
	padding-bottom: 1rem;
}

.svc-footer {
	padding: 0.625rem 1rem;
	border-top: 1px solid #2c2f38;
	flex-shrink: 0;
	display: flex;
	gap: 0.5rem;
}

/* ---- Presets ---- */
/* P1 (point 2): one column, not two - two-up made each mini-doc preview cramped at panel width. */
.svc-presets-grid {
	display: grid;
	grid-template-columns: 1fr;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
}
/* P1: one-column cards go wide, so the mini-doc becomes a fixed-size thumbnail on the start side
   (previously a full-width banner atop a 2-up card) with the name beside it, rather than a full-
   width strip 4x wider than tall. */
.svc-preset-card {
	display: flex;
	align-items: center;
	gap: 0.65rem;
	border: 1px solid #33363f;
	border-radius: 8px;
	background: #101217;
	padding: 0.5rem 0.75rem;
	cursor: pointer;
	text-align: start;
	color: inherit;
	overflow: hidden;
	position: relative;
	transition: border-color 0.15s, box-shadow 0.15s;
}
.svc-preset-card:hover { border-color: #6d8dfa; }
.svc-preset-card.svc-preset-active { border-color: #6d8dfa; border-width: 2px; box-shadow: 0 0 0 1px #6d8dfa33; }
.svc-preset-meta { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.svc-preset-name { font-size: 0.8125rem; font-weight: 600; display: block; }
.svc-swatch-strip { display: flex; height: 0.9rem; border-radius: 4px; overflow: hidden; }
.svc-swatch-strip span { flex: 1 1 0; }

/* "Add back" a palette swatch strip: 7 small bordered squares (accent-low/accent/accent-high, then
   4 grays light to dark) under the preset name - a thin border on each one so a very light gray
   still reads as a distinct square, both on the dark overlay card and (P4's actual concern) the
   docked studio's WHITE card, where the border color is overridden below. */
.svc-preset-swatches { display: flex; gap: 3px; flex-wrap: wrap; }
.svc-preset-swatch { width: 0.85rem; height: 0.85rem; flex-shrink: 0; border-radius: 3px; border: 1px solid #3a3f4b; }

/* The preset card's self-drawn mini page preview - see buildPresetMiniDoc in
   controls.js for why every line but the "Aa" sample is a plain colored bar, never real text.
   A fixed-size (not full-width) thumbnail now that the card lays out horizontally. */
.svc-preset-mini-doc { display: flex; flex-direction: column; width: 4.6rem; height: 3.4rem; flex-shrink: 0; border-radius: 5px; overflow: hidden; }
.svc-preset-mini-header { height: 0.4rem; flex-shrink: 0; }
.svc-preset-mini-body { display: grid; grid-template-columns: 26% 1fr; flex: 1 1 auto; min-height: 0; }
.svc-preset-mini-nav { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.2rem 0.18rem; }
.svc-preset-mini-navitem { display: block; height: 0.16rem; border-radius: 2px; width: 100%; }
.svc-preset-mini-content { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.2rem 0.3rem; min-width: 0; }
.svc-preset-mini-heading { font-size: 0.7rem; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
.svc-preset-mini-line { display: block; height: 0.12rem; border-radius: 2px; }
.svc-preset-mini-callout { display: block; height: 0.3rem; border-radius: 1px; margin-top: 0.1rem; }

.svc-preset-check {
	position: absolute;
	top: 0.4rem;
	inset-inline-end: 0.4rem;
	width: 0.9rem;
	height: 0.9rem;
	border-radius: 999px;
	background: #6d8dfa;
	color: #0b0d12;
	display: grid;
	place-items: center;
}

/* ---- Groups ----
   Each group is a distinct filled band (own surface tone) with a small icon and a colored accent
   edge, so groups read as separate regions instead of blending into one long list. Accent hues are
   set per data-group below; --group-accent falls back to the panel's default blue. */
.svc-group {
	border-bottom: 1px solid #24262d;
	--group-accent: #6d8dfa;
}
.svc-group[data-group='Presets'] { --group-accent: #6d8dfa; }
.svc-group[data-group='Colors'] { --group-accent: #e0796d; }
.svc-group[data-group='Typography'] { --group-accent: #d6b35c; }
.svc-group[data-group='Layout'] { --group-accent: #63c2cf; }
.svc-group[data-group='Header'] { --group-accent: #a288e3; }
.svc-group[data-group='Sidebar'] { --group-accent: #6bcf8a; }
.svc-group[data-group='TOC'] { --group-accent: #e07cb0; }
.svc-group[data-group='Content'] { --group-accent: #7ea2ea; }
.svc-group[data-group='Components'] { --group-accent: #e0a262; }
.svc-group[data-group='Code'] { --group-accent: #8fd15c; }
.svc-group[data-group='Footer'] { --group-accent: #c084e0; }
.svc-group[data-group='Page options'] { --group-accent: #9aa5b8; }
.svc-group[data-group='Navigation'] { --group-accent: #6b7180; }

.svc-group-toggle {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.7rem 1rem;
	background: linear-gradient(180deg, #22252d 0%, #1e2027 100%);
	border: 0;
	border-inline-start: 3px solid var(--group-accent);
	cursor: pointer;
	font-weight: 600;
	font-size: 0.8125rem;
	text-transform: uppercase;
	letter-spacing: 0.045em;
	color: #d3d7e0;
	text-align: start;
}
.svc-group-toggle:hover { color: #fff; background: linear-gradient(180deg, #262a33 0%, #21232b 100%); }
.svc-group-icon {
	flex-shrink: 0;
	display: inline-flex;
	color: var(--group-accent);
}
.svc-group-icon svg { display: block; width: 15px; height: 15px; }
.svc-group-toggle-label { flex: 1 1 auto; }
.svc-group-caret { transition: transform 0.15s ease; color: #7a8090; flex-shrink: 0; }
.svc-group[data-open='false'] .svc-group-caret { transform: rotate(-90deg); }
.svc-group[data-open='false'] .svc-group-body { display: none; }
/* Inset surface: sits visibly "below" the filled header band. */
.svc-group-body {
	padding: 0.75rem 1rem 0.875rem;
	display: flex;
	flex-direction: column;
	gap: 0.625rem;
	background: #15171c;
	border-inline-start: 3px solid transparent; /* keeps body aligned under the toggle's accent edge */
}
.svc-group[hidden] { display: none; }

/* Item 3: each Control.section becomes a disclosure - a bordered card whose header is a button
   (caret + label + a dirty-dot), collapsed by default except the first section of each group.
   Only appears once a control row supplies a section; groups with no sections (Presets,
   Navigation) render as a flat list (graceful degrade). */
.svc-section {
	border: 1px solid #23262d;
	border-radius: 8px;
	background: #12141a;
	overflow: hidden;
}
.svc-section[hidden] { display: none; }
.svc-section-toggle {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.45rem 0.6rem;
	background: transparent;
	border: 0;
	cursor: pointer;
	font-size: 0.6875rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: #8a90a0; /* ~5.2:1 on #12141a; don't go darker */
	text-align: start;
}
.svc-section-toggle:hover { color: #d3d7e0; }
.svc-section-toggle-label { flex: 1 1 auto; }
/* Dirty-dot: any control inside this (possibly collapsed) section differs from its default. */
.svc-section-dot { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #6d8dfa; flex-shrink: 0; }
.svc-section-dot[hidden] { display: none; }
.svc-section-caret { transition: transform 0.15s ease; flex-shrink: 0; color: #7a8090; }
.svc-section[data-open='false'] .svc-section-caret { transform: rotate(-90deg); }
.svc-section[data-open='false'] .svc-section-body { display: none; }
.svc-section-body {
	display: flex;
	flex-direction: column;
	gap: 0.625rem;
	padding: 0 0.55rem 0.55rem;
}

/* ---- Controls (every card is individually collapsible) ----
   Each control is its own card-like, collapsible disclosure so controls don't visually run
   together. .svc-control-head holds the toggle BUTTON (label, build-tag, collapsed-state summary,
   caret) plus the reset button as a SEPARATE sibling - never nested inside the toggle button, since
   a click to collapse must never also fire a reset (or, before this round, flip a checkbox / focus
   a range through a label-for wrapping the whole row - see controls.js's own note on why the
   toggle is a plain button with no for association). */
.svc-control {
	display: flex;
	flex-direction: column;
	background: #1b1e25;
	border: 1px solid #262932;
	border-radius: 8px;
	overflow: hidden;
}
/* Label + reset share one line above the inputs; min-height stops a jump when reset appears. */
.svc-control-head {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	padding: 0.5rem 0.625rem;
	min-height: 1.5rem;
}
.svc-control-toggle {
	flex: 1 1 auto;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 0.375rem;
	background: none;
	border: 0;
	padding: 0;
	margin: 0;
	color: inherit;
	font: inherit;
	text-align: start;
	cursor: pointer;
}
.svc-control-toggle:focus-visible { outline: 2px solid #6d8dfa; outline-offset: -2px; border-radius: 4px; }
.svc-control-label {
	flex: 0 1 auto;
	min-width: 0;
	font-size: 0.8125rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
/* Collapsed-card value summary ("720 px", "Filled pill", a color chip + hex, "On") - hidden while
   the card is open, so the header never shows the same value twice. */
.svc-control-summary {
	display: none;
	flex: 1 1 auto;
	min-width: 0;
	align-items: center;
	justify-content: flex-end;
	gap: 0.3rem;
	font-size: 0.75rem;
	color: #8a90a0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.svc-control[data-open='false'] .svc-control-summary { display: flex; }
.svc-control-summary-chip {
	display: inline-block;
	width: 0.85rem;
	height: 0.85rem;
	border-radius: 3px;
	border: 1px solid #33363f;
	flex-shrink: 0;
}
.svc-control-caret { flex-shrink: 0; transition: transform 0.15s ease; color: #7a8090; }
.svc-control[data-open='false'] .svc-control-caret { transform: rotate(-90deg); }
.svc-control-body { display: flex; flex-direction: column; gap: 0.5rem; padding: 0 0.625rem 0.625rem; }
.svc-control[data-open='false'] .svc-control-body { display: none; }
.svc-control-help { font-size: 0.75rem; color: #8a90a0; margin: 0; }
.svc-control-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}
.svc-control-row > input[type='range'] { flex: 1 1 auto; min-width: 0; }
/* Tile grids and font lists take the row's full width and own their own nested shadow root -
   .svc-tiles is the light-DOM host element tile-grid.js attaches a shadow root to. */
.svc-control-row > .svc-tiles { display: block; width: 100%; }
.svc-control-row > .svc-tiles > * { display: block; }

/* ---- Font list (a vertical list, each name rendered in that font) ---- */
.svc-font-list { display: flex; flex-direction: column; gap: 0.3rem; width: 100%; }
.svc-font-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	border: 1px solid #262932;
	border-radius: 6px;
	background: #101217;
	padding: 0.375rem 0.5rem;
	cursor: pointer;
}
.svc-font-row:hover { border-color: #6d8dfa; }
.svc-font-row:has(.svc-font-radio:checked) { border-color: #6d8dfa; background: #171a29; box-shadow: 0 0 0 1px #6d8dfa inset; }
.svc-font-row:has(.svc-font-radio:focus-visible) { outline: 2px solid #6d8dfa; outline-offset: 1px; }
.svc-font-radio { accent-color: #6d8dfa; flex-shrink: 0; margin: 0; }
.svc-font-row-name { font-size: 0.9375rem; color: #e8eaed; }
.svc-number {
	flex: 0 0 5.75rem; /* fixed so every slider track has the same length, unit or not */
	justify-content: flex-end;
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0 0.4rem 0 0;
	border-radius: 6px;
	border: 1px solid #3a3f4b;
	background: #101217;
}
.svc-number:focus-within { outline: 2px solid #6d8dfa; outline-offset: 1px; }
.svc-number input[type='number'] {
	width: 100%;
	min-width: 0;
	padding: 0.25rem 0 0.25rem 0.45rem;
	border: 0;
	background: transparent;
	color: inherit;
	font-variant-numeric: tabular-nums;
	font-size: 0.8125rem;
	text-align: end;
	outline: none;
}
.svc-unit { font-size: 0.75rem; color: #8a90a0; flex: 0 0 auto; }
/* P6 fix: with no fixed width, a bare <span> flex item sizes to its own text ("45rem" vs
   "18.75rem"), so the slider before it (flex: 1 1 auto, fills whatever's left) ended up a different
   length on every row. A fixed column, like .svc-number's own 5.75rem, keeps every row's slider the
   same length regardless of what the readout says; text-align:end keeps the figures lined up under
   each other the way the number field's own digits already are. */
.svc-unit-secondary {
	flex: 0 0 4.5rem;
	font-size: 0.75rem;
	color: #8a90a0;
	text-align: end;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-variant-numeric: tabular-nums;
}
.svc-reset {
	width: 1.5rem;
	height: 1.5rem;
	border-radius: 4px;
	border: 1px solid #3a3f4b;
	background: #23262e;
	cursor: pointer;
	font-size: 0.7rem;
	line-height: 1;
	flex-shrink: 0;
}
.svc-reset[hidden] { display: none; }
.svc-build-tag {
	font-size: 0.625rem;
	text-transform: uppercase;
	letter-spacing: 0.02em;
	color: #c9a84c;
	border: 1px solid #4a4225;
	border-radius: 4px;
	padding: 0.0625rem 0.25rem;
	flex-shrink: 0;
}

/* P2 fix (point 3): the thumb was NOT actually centered on its track - the native (accent-color
   tinted) thumb Chromium/Firefox draw is taller than this file's own 6px track, and without
   appearance:none on the input there is no way to control the thumb's own vertical offset, so it
   rendered pinned to the top of the input's box instead of straddling the track. appearance:none
   is required on BOTH the input (Chromium keeps its default look otherwise) and the thumb pseudo-
   element (::-webkit-slider-thumb needs its own -webkit-appearance:none even when the input
   already has it); it also drops accent-color's automatic tinting, so the thumb's fill color is
   now painted explicitly here (and, for the docked/studio chrome, in the --ui-accent block below)
   instead. Track height 6px, thumb 16px: margin-top -5px = (6 - 16) / 2, centers it exactly - the
   SAME box model Firefox's ::-moz-range-thumb centers on its own track with no extra math needed. */
input[type='range'] {
	width: 100%;
	height: 16px;
	margin: 0;
	appearance: none;
	-webkit-appearance: none;
	background: transparent;
	cursor: pointer;
}
/* Item 4: gradient tracks (hue-spectrum / gray-to-intensity) for the 9 Colors/Palette + Semantic
   hue sliders. --svc-track-bg is set per-input by controls.js's applyColorTrack; every OTHER
   range input never sets it, so the #3a3f4b fallback (this file's usual control-chrome color)
   keeps their plain track exactly as before. */
input[type='range']::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: var(--svc-track-bg, #3a3f4b); }
input[type='range']::-moz-range-track { height: 6px; border-radius: 3px; background: var(--svc-track-bg, #3a3f4b); }
input[type='range']::-webkit-slider-thumb {
	-webkit-appearance: none;
	appearance: none;
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: var(--svc-thumb-bg, #6d8dfa);
	border: 0;
	margin-top: -5px; /* (6px track - 16px thumb) / 2 - centers the thumb on the track */
	cursor: pointer;
}
input[type='range']::-moz-range-thumb {
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: var(--svc-thumb-bg, #6d8dfa);
	border: 0;
	cursor: pointer;
}
input[type='range']:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--svc-thumb-bg, #6d8dfa); outline-offset: 2px; }
input[type='range']:focus-visible::-moz-range-thumb { outline: 2px solid var(--svc-thumb-bg, #6d8dfa); outline-offset: 2px; }
/* One consistent layout for every color-assist control (accent, gray, the
   five semantic hues) - the slider row (above, in the caller), THEN this block stacked vertically:
   the hex+picker row, THEN the swatch strip, THEN the note/help. Previously the swatch strip and hex
   row shared one wrapping flex row with flex-wrap, so accent (3 swatches) and gray (8 swatches)
   wrapped differently and the picker sometimes landed on its own line under the note. */
.svc-color-assist-row { display: flex; flex-direction: column; gap: 0.4rem; }
.svc-color-hexrow { display: flex; align-items: center; gap: 0.5rem; }
.svc-swatch-group { display: flex; gap: 2px; border-radius: 4px; overflow: hidden; border: 1px solid #33363f; flex-shrink: 0; align-self: flex-start; }
.svc-color-swatch { display: block; width: 1.1rem; height: 1.1rem; }
/* Hex text field - the PRIMARY color editor (Chrome's native picker can't be forced
   into hex mode); the native picker sits beside it in the same row as a secondary swatch button. */
.svc-color-hex {
	width: 6.5rem;
	min-width: 0;
	font: 0.75rem ui-monospace, SFMono-Regular, Menlo, monospace;
	text-transform: lowercase;
	padding: 0.3rem 0.4rem;
}
.svc-color-hex-msg { font-size: 0.75rem; line-height: 1.4; }
.svc-color-hex-msg[hidden] { display: none; }
.svc-color-hex-msg[data-kind='error'] { color: #e08080; }
.svc-color-hex-msg[data-kind='note'] { color: #8a90a0; }
/* The popover swatch button (replaces the native <input type=color>, which Chrome can't
   force into hex mode) - a small square swatch button; its own background is painted live by
   controls.js/color-picker.js's setSwatch(). */
.svc-color-picker {
	width: 2.25rem;
	height: 1.75rem;
	padding: 0;
	border-radius: 4px;
	border: 1px solid #3a3f4b;
	cursor: pointer;
	flex-shrink: 0;
}
/* The popover itself: position:fixed, sized/placed in JS (color-picker.js's positionPopover) -
   see that file's header for why this can live anywhere in the DOM (including deep inside a
   scrolling .svc-panel-sections) without being clipped. vanilla-colorful's own \`<hex-color-picker>\`
   supplies the saturation area + hue bar (shadow parts \`saturation\`/\`hue\`, resized below); our own
   hex field/eyedropper sit beneath it, matching the row's own hex-first layout. */
.svc-color-popover {
	position: fixed;
	z-index: 2147483005;
	width: 220px;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	padding: 0.6rem;
	background: #1a1c22;
	border: 1px solid #33363f;
	border-radius: 10px;
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.svc-color-popover[hidden] { display: none; }
.svc-color-popover hex-color-picker { width: 100%; height: 160px; }
.svc-color-popover hex-color-picker::part(saturation) { border-radius: 6px 6px 0 0; }
.svc-color-popover hex-color-picker::part(hue) { height: 18px; margin-top: 6px; border-radius: 6px; }
.svc-color-popover-hexrow { display: flex; align-items: center; gap: 0.4rem; }
.svc-color-popover-hex { flex: 1 1 auto; min-width: 0; }
.svc-eyedropper-btn {
	width: 1.75rem;
	height: 1.75rem;
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border-radius: 6px;
	border: 1px solid #3a3f4b;
	background: #23262e;
	cursor: pointer;
	color: inherit;
}
.svc-eyedropper-btn:hover { background: #2c303a; }
/* A role override's "follows the palette" state - a small muted tag next
   to the hex field (which still shows the resolved color), shown/hidden opposite the clear button so
   the row never carries two "back to default" affordances at once (see controls.js's resetBtn guard
   for the third one, the generic reset arrow, which stays hidden for every role-override control). */
.svc-color-auto-tag {
	font-size: 0.6875rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.03em;
	color: #8a90a0;
	border: 1px solid #33363f;
	border-radius: 3px;
	padding: 0.05rem 0.35rem;
	flex-shrink: 0;
}
.svc-color-auto-tag[hidden] { display: none; }
input[type='text'], input[type='search'], input[type='url'], textarea, select {
	padding: 0.3rem 0.45rem;
	border-radius: 6px;
	border: 1px solid #3a3f4b;
	background: #101217;
	color: inherit;
	width: 100%;
}
textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; resize: vertical; }
select { cursor: pointer; }
input[type='checkbox'] { accent-color: #6d8dfa; width: 1rem; height: 1rem; }
input[type='color'] {
	width: 2.25rem;
	height: 1.75rem;
	padding: 0;
	border-radius: 4px;
	border: 1px solid #3a3f4b;
	background: transparent;
	cursor: pointer;
}
label.svc-inline { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; white-space: nowrap; }

/* ---- Contrast readout ---- */
.svc-contrast { border: 1px solid #2c2f38; border-radius: 8px; padding: 0.5rem 0.625rem; font-size: 0.75rem; }
.svc-contrast h4 { margin: 0 0 0.375rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; color: #b7bcc7; }
.svc-contrast-row { display: flex; align-items: center; justify-content: space-between; padding: 0.2rem 0; gap: 0.5rem; }
.svc-contrast-badges { display: flex; gap: 0.25rem; }
.svc-pass, .svc-fail {
	display: inline-block;
	border-radius: 3px;
	padding: 0.05rem 0.3rem;
	font-size: 0.65rem;
	font-weight: 700;
}
.svc-pass { background: #1e3a24; color: #7fd68b; }
.svc-fail { background: #3a1e1e; color: #e08080; }

/* ---- Navigation / IA editor (demoted: "advanced", collapsed by default - see panel.js) ---- */
.svc-ia-note { font-size: 0.75rem; color: #8a90a0; margin: 0 0 0.5rem; }
.svc-ia-tree { display: flex; flex-direction: column; gap: 0.25rem; }
.svc-ia-children { margin-inline-start: 1rem; border-inline-start: 1px dashed #33363f; padding-inline-start: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
.svc-ia-row { border: 1px solid #2c2f38; border-radius: 6px; padding: 0.35rem 0.4rem; background: #101217; }
/* Row 1: disclosure + type tag + label input, label gets the full remaining width. */
.svc-ia-row-main { display: flex; align-items: center; gap: 0.35rem; }
.svc-ia-type { font-size: 0.65rem; text-transform: uppercase; color: #8a90a0; border: 1px solid #33363f; border-radius: 3px; padding: 0.05rem 0.25rem; flex-shrink: 0; }
.svc-ia-label-input { flex: 1 1 auto; min-width: 0; width: 100%; }
/* Row 2: move/indent/delete - a separate compact line so it never squeezes the label input. */
.svc-ia-row-actions { display: flex; align-items: center; gap: 0.3rem; margin-top: 0.3rem; }
.svc-ia-btn { width: 1.4rem; height: 1.4rem; font-size: 0.7rem; padding: 0; border-radius: 4px; border: 1px solid #3a3f4b; background: #23262e; cursor: pointer; flex-shrink: 0; }
.svc-ia-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.svc-ia-details { margin-top: 0.35rem; padding-top: 0.35rem; border-top: 1px dashed #2c2f38; display: flex; flex-direction: column; gap: 0.3rem; }
.svc-ia-details-row { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
/* :not(.svc-inline) - a bare field() label (badge text / directory / slug) stacks its text above
   its input; label.svc-inline (checkboxes: hidden / starts collapsed) must stay a single row -
   this selector used to hit both, stacking checkboxes vertically. */
.svc-ia-details-row label:not(.svc-inline) { font-size: 0.7rem; color: #b7bcc7; display: flex; flex-direction: column; gap: 0.15rem; flex: 1 1 8rem; }
.svc-ia-error { color: #e08080; font-size: 0.75rem; white-space: pre-wrap; }
.svc-ia-import { border: 1px solid #2c2f38; border-radius: 8px; padding: 0.5rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
.svc-ia-import-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.svc-ia-add-row { display: flex; gap: 0.4rem; }

/* ---- The studio's restyled "Structure (advanced)" tree - a note, an
   add-item row, a draggable/selectable tree with folder/page icons and indent guide lines, a
   move/delete toolbar, and a "Selected item" form below (built by createStudioTreeEditor in
   ia-editor.js). Overlay mode's tree above (.svc-ia-*) is untouched. ---- */
.svc-structure-note { font-size: 0.75rem; line-height: 1.5; color: #8a90a0; margin: 0 0 0.5rem; }
.svc-structure-add-row { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
.svc-structure-tree { display: flex; flex-direction: column; gap: 0.15rem; margin-bottom: 0.5rem; position: relative; }
.svc-structure-children { margin-inline-start: 1.1rem; border-inline-start: 1px dashed #33363f; padding-inline-start: 0.5rem; display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.15rem; }
.svc-structure-row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.35rem 0.45rem;
	border: 1px solid transparent;
	border-radius: 6px;
	cursor: pointer;
	background: #101217;
}
.svc-structure-row:hover { border-color: #33363f; }
.svc-structure-row:focus-visible { outline: 2px solid #6d8dfa; outline-offset: 1px; }
.svc-structure-row-selected { border-color: #6d8dfa; background: #171a29; }
.svc-structure-row-dragging { opacity: 0.5; }
/* Sa (drag feedback): a clear insertion marker. 'before'/'after' get a real line BETWEEN rows
   (.svc-structure-drop-line, positioned by ia-editor.js's showDropLine at the target row's own
   top/bottom edge, spanning its width) rather than a mark on the row's own inner edge (too easy to
   miss against its 1px border + the ~2px gap already there); 'inside' keeps its outline+tint
   highlight, just called out explicitly here as the group-drop case. Feedback only - the drop LOGIC
   (which position data-drop gets, what a drop is allowed to do) is unchanged. */
.svc-structure-drop-line { position: absolute; height: 3px; border-radius: 2px; background: #6d8dfa; pointer-events: none; z-index: 1; }
.svc-structure-row[data-drop='inside'] { outline: 2px solid #6d8dfa; outline-offset: -2px; background: #1c2140; }
.svc-structure-grip { flex-shrink: 0; color: #565c6b; cursor: grab; }
.svc-structure-icon { flex-shrink: 0; color: #8a90a0; }
.svc-structure-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8125rem; }
.svc-structure-badge { font-size: 0.625rem; padding: 0.05rem 0.3rem; border-radius: 3px; background: #23262e; color: #b7bcc7; flex-shrink: 0; }
.svc-structure-hidden-tag { font-size: 0.625rem; color: #8a90a0; flex-shrink: 0; font-style: italic; }
/* The move/outdent/indent/delete buttons were 1.4rem (22.4px, under a
   comfortable tap/click target) and relied on opacity alone for their disabled state, which read as
   nearly invisible rather than "visibly disabled". Scoped to THIS toolbar only (not the base
   .svc-ia-btn rule, shared with the untouched overlay tree's own per-row action buttons). */
.svc-structure-toolbar { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }
.svc-structure-toolbar .svc-ia-btn {
	width: 1.75rem;
	height: 1.75rem;
	font-size: 0.9rem;
	line-height: 1;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: #e8eaed;
}
.svc-structure-toolbar .svc-ia-btn:disabled {
	/* Muted, not faded to near-nothing: reads as disabled while staying legible - matches the A4
	   contrast walk's own muted-text exception (4.5:1 floor), never full opacity fade-out. */
	opacity: 1;
	color: #565c6b;
	background: #1a1c22;
}
.svc-structure-form { border-top: 1px solid #2c2f38; padding-top: 0.6rem; margin-top: 0.2rem; display: flex; flex-direction: column; gap: 0.4rem; }
.svc-structure-form-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #b7bcc7; display: flex; align-items: center; gap: 0.4rem; }
.svc-structure-form-title span { font-size: 0.625rem; font-weight: 600; text-transform: none; letter-spacing: 0; padding: 0.05rem 0.35rem; border-radius: 3px; background: #23262e; color: #8a90a0; }
.svc-structure-empty { font-size: 0.75rem; color: #8a90a0; }

/* ---- Target highlight overlay (fixed-position box drawn from a control's target rect) ---- */
.svc-target-overlay {
	position: fixed;
	top: 0;
	left: 0;
	z-index: 0; /* below .svc-drawer (z-index:1) - "under the drawer" is acceptable here */
	pointer-events: none;
	box-sizing: border-box;
	border: 2px solid #6d8dfa;
	border-radius: 4px;
	background: rgba(109, 141, 250, 0.12);
	box-shadow: 0 0 0 3px rgba(109, 141, 250, 0.25);
	opacity: 1;
	transition: opacity 0.4s ease;
	will-change: transform, width, height;
}
.svc-target-overlay.svc-target-fade { opacity: 0; }

/* ---- Follow-on-page toggle (header) ---- */
.svc-follow-toggle { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; color: #b7bcc7; white-space: nowrap; }

/* ---- Export dialog ---- */
.svc-dialog-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.55);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 2147483001;
	pointer-events: auto;
}
.svc-dialog-backdrop[hidden] { display: none; }
.svc-dialog {
	width: min(640px, calc(100vw - 2rem));
	max-height: min(80vh, 720px);
	display: flex;
	flex-direction: column;
	background: #1a1c22;
	border: 1px solid #33363f;
	border-radius: 10px;
	overflow: hidden;
}
.svc-dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid #2c2f38; }
.svc-dialog-header h3 { margin: 0; font-size: 1rem; }
.svc-tabs { display: flex; gap: 0.25rem; padding: 0.5rem 1rem 0; }
.svc-tab {
	padding: 0.35rem 0.7rem;
	border-radius: 6px 6px 0 0;
	border: 1px solid #33363f;
	border-bottom: none;
	background: #101217;
	cursor: pointer;
	font-size: 0.8125rem;
}
.svc-tab[aria-selected='true'] { background: #1a1c22; color: #fff; }
.svc-tab-panels { flex: 1 1 auto; overflow: hidden; padding: 0 1rem 1rem; display: flex; flex-direction: column; }
.svc-tab-panel { flex: 1 1 auto; display: none; flex-direction: column; gap: 0.5rem; min-height: 0; }
.svc-tab-panel[data-active='true'] { display: flex; }
.svc-export-textarea { flex: 1 1 auto; min-height: 240px; }
.svc-dialog-footer { display: flex; gap: 0.5rem; padding: 0.75rem 1rem; border-top: 1px solid #2c2f38; flex-wrap: wrap; }

/* Items 2/3: "Download all (.zip)" + "Screenshot (PNG)", between the file view and the footer. */
.svc-export-extra { flex: 0 0 auto; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem 1rem; border-top: 1px solid #2c2f38; }
.svc-export-extra-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.svc-export-extra-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #b7bcc7; flex: 0 0 auto; }
.svc-export-extra-buttons { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.svc-export-hint { margin: 0; font-size: 0.75rem; color: #8a90a0; line-height: 1.4; }

.svc-sr-only {
	position: absolute;
	width: 1px; height: 1px;
	padding: 0; margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}

@media (max-width: 420px) {
	.svc-panel { width: 100vw; }
}

/* =================================================================================================
   Studio (docked) light chrome. Every selector below is either scoped under
   :host([data-docked='true']) or is a class name that panel.js only ever creates in studio mode
   (.svc-rail*, .svc-panel-col*, .svc-group-studio*) - a direct page visit (overlay mode) is
   untouched: it never gets data-docked, so none of this ever applies there, and none of it changes
   any selector the overlay path itself uses.

   Readability: --ui-ink ~16:1, --ui-text ~11:1 and --ui-accent-fg (white on --ui-accent) ~6.3:1
   on white/--ui-bg were verified against the WCAG relative-luminance formula before committing to
   this starting palette (verified, not just assumed) - the accent's ~6.3:1 clears the
   4.5:1 floor explicitly set for white-on-accent text (buttons, the selected rail item);
   --ui-muted's ~6.3:1 clears the 4.5:1 floor for help/eyebrow/caption text but is never used for a
   label, a rail label, a group title or button text (those need >=7:1 - see shell.mjs's contrast
   walk, which encodes this same accent exception and the help/eyebrow/caption exception).
   ================================================================================================= */
:host([data-docked='true']) {
	--ui-ink: #1b2130;
	--ui-text: #343b4a;
	--ui-muted: #566072;
	--ui-line: #dde1e8;
	--ui-bg: #f5f6f8;
	--ui-panel: #ffffff;
	--ui-accent: #4453c9;
	--ui-accent-fg: #ffffff;
	--ui-accent-tint: rgba(68, 83, 201, 0.08);
	/* --ui-accent itself only reaches ~6.3:1 as TEXT on a light background (white-on-accent-FILL
	   is the one case explicitly held to 4.5:1 - buttons, the selected rail item; everything
	   else needs 7:1, including "selected" accent-colored text like a page tab or file-list item on
	   its light accent tint). --ui-accent-ink is that same hue, darkened until it clears 7:1 on white
	   (measured ~7.8:1) - verified by shell.mjs's contrast walk. */
	--ui-accent-ink: #3a46b0;
	--ui-pass: #0b5c26;
	/* Darkened from #a3251c once the section body's own background moved from --ui-panel
	   (white) to --ui-bg (a light tint) - the lighter background left this red just under the 7:1
	   floor for the Colors group's own pass/fail contrast readout (measured 6.84:1); this shade
	   (shared with the docked hex-field error message color) clears 7:1 against BOTH backgrounds. */
	--ui-fail: #8f1d17;
	/* Tile card chrome (tile-grid.js's CHROME_CSS reads these through its own nested shadow root -
	   custom properties inherit across shadow boundaries even though selectors don't). */
	--svc-tile-border: var(--ui-line);
	--svc-tile-bg: var(--ui-bg);
	--svc-tile-bg-selected: var(--ui-accent-tint);
	--svc-tile-accent: var(--ui-accent);
	--svc-tile-caption: var(--ui-ink);
	--svc-tile-hover-shadow: rgba(27, 33, 48, 0.14);
	/* P2: the range thumb's paint color (see the plain, dark-chrome rule above) - accent-color's
	   automatic tinting no longer applies once appearance:none takes over the thumb's box model. */
	--svc-thumb-bg: var(--ui-accent);
	/* P4: cards read as white above a light-tinted section body; the border needs to be a step darker
	   than --ui-line (used for the section's OWN border against --ui-panel/--ui-bg) to still read as
	   a border - verified against BOTH --ui-panel and --ui-bg by shell.mjs's own >=1.5:1 check. */
	--ui-card-border: #aab2c0;
	color: var(--ui-text);
	/* Starlight's props.css sets color-scheme:dark on :root (imported into the studio host document
	   for token resolution - see studio.astro) - without this override, native scrollbars/selects/
	   number-input spinners inside the chrome would render dark whenever the PREVIEW is dark, even
	   though every chrome color here stays light regardless of preview mode (S2). */
	color-scheme: light;
}
:host([data-docked='true']) *,
:host([data-docked='true']) *::selection {
	color-scheme: light;
}

/* ---- Rail (S4): one 72px icon column, one group visible at a time via the panel column beside it. ---- */
.svc-rail {
	width: 72px;
	flex: 0 0 72px;
	height: 100%;
	overflow-y: auto;
	overflow-x: hidden;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	padding: 0.5rem 0;
	background: var(--ui-panel);
	border-inline-end: 1px solid var(--ui-line);
}
.svc-rail-sep { height: 1px; margin: 0.4rem 0.75rem; background: var(--ui-line); flex-shrink: 0; }
.svc-rail-item {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.25rem;
	padding: 0.5rem 0.2rem;
	margin: 0.0625rem 0.375rem;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--ui-text);
	cursor: pointer;
	font: inherit;
}
.svc-rail-item:hover { background: var(--ui-accent-tint); }
.svc-rail-item-icon { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
.svc-rail-item-icon svg { width: 100%; height: 100%; display: block; }
/* >=7:1 on both the plain rail background (--ui-panel white) and, when selected, --ui-accent (its
   own explicit 4.5:1 exception - see the file-header note above). */
.svc-rail-item-label { font-size: 0.625rem; line-height: 1.15; text-align: center; font-weight: 700; color: var(--ui-ink); }
.svc-rail-item-dot {
	position: absolute;
	top: 0.3rem;
	right: 0.6rem;
	width: 0.375rem;
	height: 0.375rem;
	border-radius: 50%;
	background: var(--ui-accent);
}
/* S4: solid accent fill, white icon+label, plus a 3px accent bar on the rail's inner edge. The fill
   (--ui-accent on --ui-panel/--ui-bg) measures ~5.8:1, clearing S4's 3:1 "reads at a glance" floor. */
.svc-rail-item[aria-selected='true'] { background: var(--ui-accent); color: var(--ui-accent-fg); }
.svc-rail-item[aria-selected='true'] .svc-rail-item-label { color: var(--ui-accent-fg); }
.svc-rail-item[aria-selected='true']::before {
	content: '';
	position: absolute;
	inset-inline-end: -0.375rem;
	top: 0.3rem;
	bottom: 0.3rem;
	width: 3px;
	border-radius: 2px;
	background: var(--ui-accent);
}
.svc-rail-item[aria-selected='true'] .svc-rail-item-dot { background: var(--ui-accent-fg); }
.svc-rail-item:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }

/* ---- Panel column (S5) ---- */
.svc-panel-col {
	width: 340px;
	flex: 0 0 340px;
	height: 100%;
	display: flex;
	flex-direction: column;
	background: var(--ui-panel);
	overflow: hidden;
}
.svc-panel-filter-row { flex: 0 0 auto; padding: 0.75rem 0.875rem; border-bottom: 1px solid var(--ui-line); }
.svc-panel-filter-row .svc-filter { width: 100%; background: var(--ui-bg); border-color: var(--ui-line); color: var(--ui-ink); }
.svc-group-header { flex: 0 0 auto; padding: 0.875rem 0.875rem 0.75rem; border-bottom: 1px solid var(--ui-line); }
.svc-group-header[hidden] { display: none; }
.svc-group-eyebrow { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ui-muted); margin: 0 0 0.2rem; }
.svc-group-title { font-size: 1.125rem; font-weight: 700; color: var(--ui-ink); margin: 0 0 0.3rem; }
.svc-group-desc { font-size: 0.8125rem; color: var(--ui-muted); margin: 0 0 0.6rem; line-height: 1.4; }
/* SPEC-C P4: Expand all / Collapse all sit beside the existing reset-group button, all three sharing
   one small-pill look (.svc-reset-group's own styling below, reused rather than duplicated). */
.svc-group-header-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
/* Reset on the left; Expand all / Collapse all grouped on the right (the reset button is the first child). */
.svc-group-header-actions > .svc-reset-group:nth-child(2) { margin-inline-start: auto; }
.svc-reset-group {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.75rem;
	font-weight: 700;
	color: var(--ui-text);
	background: var(--ui-panel);
	border: 1px solid var(--ui-line);
	border-radius: 6px;
	padding: 0.3rem 0.6rem;
	cursor: pointer;
}
.svc-reset-group:hover:not(:disabled) { border-color: var(--ui-accent); color: var(--ui-accent-ink); }
.svc-reset-group:disabled { opacity: 0.5; cursor: not-allowed; }
.svc-panel-sections { flex: 1 1 auto; overflow-y: auto; padding: 0.5rem 0.875rem 1.25rem; }
.svc-group-studio-heading {
	display: none;
	align-items: center;
	gap: 0.4rem;
	padding: 0.6rem 0 0.35rem;
	font-size: 0.6875rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--ui-muted);
}
.svc-group-studio-heading .svc-group-icon { color: var(--ui-muted); }
.svc-panel-sections[data-filtering='true'] .svc-group-studio-heading { display: flex; }
.svc-panel-sections[data-filtering='true'] .svc-group-studio {
	margin-bottom: 0.75rem;
	padding-bottom: 0.6rem;
	border-bottom: 1px solid var(--ui-line);
}
.svc-group-studio[hidden] { display: none; }
/* P4 fix: the base .svc-group rule (overlay's accordion list, above) gives every group a dark
   border-bottom for its own list-separator purpose - .svc-group-studio carries the .svc-group class
   too (for shared control-row CSS) but studio's single-group view has nothing to separate FROM, so
   that dark line was showing up as a stray rule under the last content in the panel (the preset
   grid, or a group's last section). Only the FILTERING state (above) wants its own light divider
   between multiple results. */
.svc-group-studio { border-bottom: 0; }

/* ---- Shared control chrome, restyled light for the docked column ----
   P4 ("more contrast between levels"): the section HEADER reads as its own white band above a
   light-tinted section BODY, and control CARDS are white again (with a visible, darker-than-
   --ui-line border) inside that tinted body - three legible layers instead of the section and its
   cards previously sharing indistinguishable near-white tones. */
:host([data-docked='true']) .svc-group-body { background: transparent; padding: 0.2rem 0; gap: 0.6rem; border-inline-start: 0; }
:host([data-docked='true']) .svc-section { background: var(--ui-bg); border: 1px solid var(--ui-line); }
/* Item 4 (maintainer fix): .svc-section-body's base rule (above) has ZERO top padding, so the
   section header band's bottom border sat flush against the first card's top border - no breathing
   room between the band and its content, unlike the (already-consistent) gap BETWEEN cards. Give it
   the same 0.625rem the body already uses as its inter-card spacing, so the header-to-first-card
   space reads the same as card-to-card space, in every group, docked (light chrome) only - overlay's
   dark accordion (S16) stays byte-identical. */
:host([data-docked='true']) .svc-section-body { padding-block-start: 0.625rem; }
:host([data-docked='true']) .svc-section-toggle { background: var(--ui-panel); border-bottom: 1px solid var(--ui-line); color: var(--ui-text); }
:host([data-docked='true']) .svc-section[data-open='false'] .svc-section-toggle { border-bottom-color: transparent; }
:host([data-docked='true']) .svc-section-toggle:hover { color: var(--ui-ink); }
:host([data-docked='true']) .svc-section-caret { color: var(--ui-muted); }
:host([data-docked='true']) .svc-section-dot { background: var(--ui-accent); }
:host([data-docked='true']) .svc-control { background: var(--ui-panel); border: 1px solid var(--ui-card-border); }
:host([data-docked='true']) .svc-control-toggle:focus-visible { outline-color: var(--ui-accent); }
:host([data-docked='true']) .svc-control-label { color: var(--ui-ink); font-weight: 600; }
:host([data-docked='true']) .svc-control-summary { color: var(--ui-muted); }
:host([data-docked='true']) .svc-control-summary-chip { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-control-caret { color: var(--ui-muted); }
:host([data-docked='true']) .svc-control-help { color: var(--ui-muted); }
:host([data-docked='true']) .svc-unit, :host([data-docked='true']) .svc-unit-secondary { color: var(--ui-muted); }
:host([data-docked='true']) .svc-unit-secondary { font-variant-numeric: tabular-nums; }
:host([data-docked='true']) .svc-build-tag { color: #6b4d0a; border-color: #e3d3a0; background: #fbf3df; }
:host([data-docked='true']) .svc-reset { background: var(--ui-panel); border-color: var(--ui-line); color: var(--ui-text); }
:host([data-docked='true']) .svc-reset:hover { border-color: var(--ui-accent); color: var(--ui-accent-ink); }
:host([data-docked='true']) .svc-number { background: var(--ui-panel); border-color: var(--ui-line); }
:host([data-docked='true']) .svc-number input[type='number'] { color: var(--ui-ink); }
:host([data-docked='true']) .svc-swatch-group { border-color: var(--ui-line); }
/* P2 (incidental fix, found while re-verifying the thumb-centering fix in the studio's own light
   chrome): a PLAIN range control (no color-assist gradient track - most sliders outside Colors)
   never sets --svc-track-bg, so it fell through to the dark-chrome fallback (#3a3f4b) even inside
   the light studio - a dark track floating on white. A color-assist track's own inline
   --svc-track-bg (set by controls.js's applyColorTrack) still wins over this fallback. */
:host([data-docked='true']) input[type='range']::-webkit-slider-runnable-track { background: var(--svc-track-bg, var(--ui-line)); }
:host([data-docked='true']) input[type='range']::-moz-range-track { background: var(--svc-track-bg, var(--ui-line)); }
:host([data-docked='true']) input[type='text'],
:host([data-docked='true']) input[type='search'],
:host([data-docked='true']) input[type='url'],
:host([data-docked='true']) textarea,
:host([data-docked='true']) select {
	background: var(--ui-panel);
	border-color: var(--ui-line);
	color: var(--ui-ink);
}
:host([data-docked='true']) input[type='color'] { border-color: var(--ui-line); }
/* SPEC-C P3: the popover picker, restyled light. */
:host([data-docked='true']) .svc-color-picker { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-color-popover { background: var(--ui-panel); border-color: var(--ui-line); box-shadow: 0 12px 32px rgba(27, 33, 48, 0.25); }
:host([data-docked='true']) .svc-eyedropper-btn { background: var(--ui-panel); border-color: var(--ui-line); color: var(--ui-text); }
:host([data-docked='true']) .svc-eyedropper-btn:hover { background: var(--ui-bg); }
/* SPEC-C E1: hex field messages. The "note" reuses --ui-muted exactly (the A4 walk's own 4.5:1
   exception for muted text); the "error" is a dedicated red verified at >=7:1 on both --ui-panel and
   --ui-bg (the walk's default floor for anything that ISN'T muted/on-accent). */
:host([data-docked='true']) .svc-color-hex-msg[data-kind='note'] { color: var(--ui-muted); }
:host([data-docked='true']) .svc-color-hex-msg[data-kind='error'] { color: #8f1d17; }
:host([data-docked='true']) .svc-color-auto-tag { color: var(--ui-muted); border-color: var(--ui-line); background: var(--ui-bg); }
:host([data-docked='true']) label.svc-inline { color: var(--ui-text); }
:host([data-docked='true']) .svc-fab,
:host([data-docked='true']) .svc-icon-btn,
:host([data-docked='true']) .svc-btn {
	background: var(--ui-panel);
	border-color: var(--ui-line);
	color: var(--ui-text);
}
:host([data-docked='true']) .svc-btn:hover,
:host([data-docked='true']) .svc-icon-btn:hover { background: var(--ui-bg); }
:host([data-docked='true']) .svc-btn.svc-btn-primary { background: var(--ui-accent); border-color: var(--ui-accent); color: var(--ui-accent-fg); }
:host([data-docked='true']) .svc-btn.svc-btn-primary:hover { background: #38439e; border-color: #38439e; }
:host([data-docked='true']) .svc-fab:focus-visible,
:host([data-docked='true']) button:focus-visible,
:host([data-docked='true']) input:focus-visible,
:host([data-docked='true']) select:focus-visible,
:host([data-docked='true']) a:focus-visible { outline-color: var(--ui-accent); }

/* ---- Presets, restyled light ---- */
:host([data-docked='true']) .svc-preset-card { background: var(--ui-panel); border-color: var(--ui-line); color: var(--ui-ink); }
:host([data-docked='true']) .svc-preset-card:hover { border-color: var(--ui-accent); }
:host([data-docked='true']) .svc-preset-card.svc-preset-active { border-color: var(--ui-accent); background: var(--ui-accent-tint); }
:host([data-docked='true']) .svc-preset-mini-doc { border-bottom-color: var(--ui-line); }
:host([data-docked='true']) .svc-preset-check { background: var(--ui-accent); color: var(--ui-accent-fg); }
:host([data-docked='true']) .svc-preset-swatch { border-color: var(--ui-line); }

/* ---- Font list, restyled light ---- */
:host([data-docked='true']) .svc-font-row { background: var(--ui-panel); border-color: var(--ui-line); }
:host([data-docked='true']) .svc-font-row:hover { border-color: var(--ui-accent); }
:host([data-docked='true']) .svc-font-row:has(.svc-font-radio:checked) { border-color: var(--ui-accent); background: var(--ui-accent-tint); box-shadow: 0 0 0 1px var(--ui-accent) inset; }
:host([data-docked='true']) .svc-font-radio { accent-color: var(--ui-accent); }
:host([data-docked='true']) .svc-font-row-name { color: var(--ui-ink); }

/* ---- Contrast readout + status bar's contrast dialog, restyled light ---- */
:host([data-docked='true']) .svc-contrast { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-contrast h4 { color: var(--ui-muted); }
:host([data-docked='true']) .svc-pass { background: transparent; color: var(--ui-pass); padding: 0; font-weight: 700; }
:host([data-docked='true']) .svc-fail { background: transparent; color: var(--ui-fail); padding: 0; font-weight: 700; }

/* ---- Navigation / Structure (advanced), restyled light ---- */
:host([data-docked='true']) .svc-ia-note { color: var(--ui-muted); }
:host([data-docked='true']) .svc-ia-row { background: var(--ui-panel); border-color: var(--ui-line); }
:host([data-docked='true']) .svc-ia-type { color: var(--ui-muted); border-color: var(--ui-line); }
:host([data-docked='true']) .svc-ia-btn { background: var(--ui-panel); border-color: var(--ui-line); color: var(--ui-text); }
:host([data-docked='true']) .svc-ia-details { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-ia-details-row label:not(.svc-inline) { color: var(--ui-muted); }
:host([data-docked='true']) .svc-ia-import { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-ia-children { border-color: var(--ui-line); }

/* ---- SPEC-C E3: the studio's restyled structure tree, light ---- */
:host([data-docked='true']) .svc-structure-note { color: var(--ui-muted); }
:host([data-docked='true']) .svc-structure-row { background: var(--ui-panel); border-color: var(--ui-line); }
:host([data-docked='true']) .svc-structure-row:hover { border-color: var(--ui-accent); }
:host([data-docked='true']) .svc-structure-row-selected { border-color: var(--ui-accent); background: var(--ui-accent-tint); }
:host([data-docked='true']) .svc-structure-drop-line { background: var(--ui-accent); }
:host([data-docked='true']) .svc-structure-row[data-drop='inside'] { outline-color: var(--ui-accent); background: var(--ui-accent-tint); }
:host([data-docked='true']) .svc-structure-grip,
:host([data-docked='true']) .svc-structure-icon { color: var(--ui-muted); }
:host([data-docked='true']) .svc-structure-label { color: var(--ui-ink); }
:host([data-docked='true']) .svc-structure-badge { background: var(--ui-bg); color: var(--ui-text); }
:host([data-docked='true']) .svc-structure-hidden-tag { color: var(--ui-muted); }
:host([data-docked='true']) .svc-structure-children { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-structure-form { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-structure-form-title { color: var(--ui-muted); }
:host([data-docked='true']) .svc-structure-form-title span { background: var(--ui-bg); color: var(--ui-muted); }
:host([data-docked='true']) .svc-structure-empty { color: var(--ui-muted); }
/* Higher specificity than the generic .svc-ia-btn docked rule above (needed since it also sets
   color/background) - enabled buttons read at >=7:1 (--ui-ink), disabled ones stay visible but
   muted (--ui-muted, the walk's own exemption) rather than fading toward invisible. */
:host([data-docked='true']) .svc-structure-toolbar .svc-ia-btn { color: var(--ui-ink); }
:host([data-docked='true']) .svc-structure-toolbar .svc-ia-btn:disabled { color: var(--ui-muted); background: var(--ui-bg); border-color: var(--ui-line); opacity: 1; }

/* ---- Contrast warnings dialog (status bar, S12) ---- */
.svc-contrast-dialog-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.svc-contrast-dialog-table th, .svc-contrast-dialog-table td { text-align: start; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--ui-line); vertical-align: middle; }
.svc-contrast-dialog-swatch { display: inline-block; width: 0.9rem; height: 0.9rem; border-radius: 3px; border: 1px solid var(--ui-line); vertical-align: middle; margin-inline-end: 0.25rem; }
/* P2: a clear pass/fail pill, >=12px, vertically centered in its cell (see controls.js's dialog
   markup - a <span> inside a plain <td>, not the class on the <td> itself, which broke the cell's
   native table-cell display and put the text above the row's baseline). Text/bg pairs measured
   >=8.8:1 - this is a VALUE per S3, held to the 7:1 floor like any other, not the 4.5:1 help/caption one. */
.svc-result-pill {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 3.25rem;
	padding: 0.2rem 0.55rem;
	border-radius: 999px;
	font-size: 0.75rem;
	font-weight: 700;
	line-height: 1.3;
}
.svc-result-pass { background: #e3f5e8; color: #074a1e; }
.svc-result-fail { background: #fbe4e1; color: #7a170f; }

/* ---- Export dialog, restyled light + Codex's two-pane shape (S14): a file list on the left, the
   selected file's content (with Copy/Download) on the right, instead of B's top tab strip. ---- */
:host([data-docked='true']) .svc-dialog-backdrop { background: rgba(27, 33, 48, 0.45); }
:host([data-docked='true']) .svc-dialog { background: var(--ui-panel); border-color: var(--ui-line); color: var(--ui-text); }
:host([data-docked='true']) .svc-dialog-header { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-dialog-header h3 { color: var(--ui-ink); }
:host([data-docked='true']) .svc-dialog-footer { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-export-extra { border-color: var(--ui-line); }
:host([data-docked='true']) .svc-export-extra-label { color: var(--ui-muted); }
:host([data-docked='true']) .svc-export-hint { color: var(--ui-muted); }
.svc-dialog[data-shape='files'] { height: min(80vh, 640px); }
.svc-files-row { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: row; }
.svc-file-list {
	flex: 0 0 180px;
	border-inline-end: 1px solid var(--ui-line);
	overflow-y: auto;
	padding: 0.5rem;
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}
.svc-file-item {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 0.05rem;
	width: 100%;
	text-align: start;
	background: transparent;
	border: 0;
	border-radius: 6px;
	padding: 0.45rem 0.55rem;
	cursor: pointer;
	color: var(--ui-text);
	font: inherit;
}
.svc-file-item:hover { background: var(--ui-bg); }
.svc-file-item[aria-selected='true'] { background: var(--ui-accent-tint); color: var(--ui-accent-ink); }
.svc-file-item-name { font-size: 0.8125rem; font-weight: 700; }
.svc-file-item-size { font-size: 0.6875rem; color: var(--ui-muted); }
.svc-file-item[aria-selected='true'] .svc-file-item-size { color: var(--ui-accent-ink); }
.svc-file-pane { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 0.75rem; gap: 0.5rem; }
.svc-file-pane .svc-tab-panels { padding: 0; min-height: 0; }
.svc-file-pane-actions { display: flex; gap: 0.5rem; }

/* Below 900px (S1): the panel column becomes a drawer over the workarea instead of an in-flow
   sibling, toggled from the top bar - the rail stays visible (it's the entry point to reopen it). */
:host([data-docked='true'][data-drawer-open='false']) .svc-panel-col { display: none; }
@media (max-width: 899px) {
	/* The column becomes a fixed-position drawer over the workarea (S1) - the host itself shrinks to
	   just the rail's 72px so the workarea reclaims the column's normal in-flow space. */
	:host([data-docked='true']) { width: 72px; flex: 0 0 72px; }
	:host([data-docked='true']) .svc-panel-col {
		position: fixed;
		inset-block: 0;
		inset-inline-start: 72px;
		width: min(340px, calc(100vw - 72px));
		z-index: 2147483000;
		box-shadow: 4px 0 24px rgba(27, 33, 48, 0.25);
	}
}
`;
