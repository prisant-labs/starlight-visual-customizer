/**
 * @file Pure CSS emitter. Given a `ThemeState` (see `state.js`), produces the exact `theme.css`
 * text a real `@astrojs/starlight@0.42.6` site would load via `customCss`. DOM-free, deterministic
 * (same state -> byte-identical output), unlayered (never wrapped in `@layer`, so it always wins
 * over Starlight's own `@layer starlight.*` rules whenever a selector matches),
 * and emits `!important` nowhere.
 *
 * General rule: every control is emitted only when its effective value differs from the
 * manifest default (`getValue(state, id) !== control.default`). The one deliberate exception is
 * the accent/gray palette (`PALETTE_IDS`): those five inputs are jointly interdependent (the
 * official color-lib algorithm generates the whole dark+light token set from them together), so
 * they're gated as a single all-or-nothing group rather than diffed token-by-token. Semantic
 * hues and role overrides are each independent single-token diffs and are NOT part of that gate -
 * changing only `color.hue.orange` does not pull the whole accent/gray palette out of Starlight's
 * own HSL defaults. This keeps the literal fidelity rule intact ("starlight-default" state emits
 * no color tokens at all) while avoiding a surprising blast radius for the independent controls.
 *
 * `forPreview`-only build-time approximations (TOC level filtering, pagination/headingLinks/
 * credits hiding) are EXPLICIT-based, not default-based: each one fires only when the user has
 * actually set that control away from its manifest default (i.e. the id is present in
 * `state.values` - see `isExplicit` below), never merely because the *effective* value happens to
 * equal an "off" default. This matters because whatever real `astro.config.mjs` the previewed
 * page is actually built from is free to differ from the manifest default (e.g. a project that
 * already sets `credits: true`, or a wider `tableOfContents` range, before ever touching this
 * tool) - an untouched control must leave that page exactly as its own config renders it, not
 * silently force it toward the manifest's notion of "default". Only a control the user genuinely
 * changed should ever add an approximation on top of the page's real build. (Previously this was
 * value-based - `getValue(...) === false` - which broke exactly for `page.credits`, whose default
 * is itself "off": every untouched theme hid a credits link the target page's own config showed.)
 */
import { controls } from './manifest.js';
import { FONTS } from './manifest.js';
import { getValue, isHexColor } from './state.js';
import { getPalettes } from './color.js';
import { treatments, globalRadiusHooks } from './treatments.js';
import { STARLIGHT_VERSION } from './version.js';
import { TOOL_URL } from './project.js';

/** @type {Map<string, import('./manifest.js').Control>} */
const controlsById = new Map(controls.map((c) => [c.id, c]));

/** @param {string} id @returns {any} */
function def(id) {
	const c = controlsById.get(id);
	if (!c) throw new Error(`emit-css: unknown control id "${id}"`);
	return c.default;
}

/** @param {import('./state.js').ThemeState} state @param {string} id @returns {boolean} */
function isDefault(state, id) {
	return getValue(state, id) === def(id);
}

/**
 * @param {import('./state.js').ThemeState} state @param {string} id
 * @returns {boolean} Whether the user explicitly set `id` (present as its own key in
 *   `state.values`), as opposed to it merely reading its manifest default. `state.js`'s
 *   `setValue`/`applyPreset` never store a value equal to the control's default (they delete the
 *   key instead), so in practice this is "changed from default" for any state built through the
 *   UI - but a hand-authored/imported `state.json` could set a key explicitly to its default
 *   value, and this still honors that as explicit intent (see `buildPreviewApprox`'s header note).
 */
function isExplicit(state, id) {
	return !!(state && state.values && Object.prototype.hasOwnProperty.call(state.values, id));
}

// ---------------------------------------------------------------------------------------------
// Id groups. Each group is both (a) the literal list this file's logic dispatches on, and (b) a
// contribution to HANDLED_IDS below - the two cannot drift apart because HANDLED_IDS is built
// from these same arrays, not hand-duplicated.
// ---------------------------------------------------------------------------------------------

export const PALETTE_IDS = [
	'color.accent.hue',
	'color.accent.chroma',
	'color.gray.hue',
	'color.gray.chroma',
	'color.contrastFloor',
];

/**
 * The exact palette `buildRootTokens`/`buildLightTokens` emit into `theme.css`, or `null` when
 * none of `PALETTE_IDS` differs from its manifest default (nothing to generate - Starlight's own
 * HSL defaults apply). Exported as the SINGLE source of truth for this computation - `emit-apply.js`
 * calls this too (round 2 fix: APPLY-THEME.md's Verification checks against these same hex values,
 * computed the same way, so they can never silently disagree with what `theme.css` actually sets).
 * @param {import('./state.js').ThemeState} state
 * @returns {{dark: Record<string,string>, light: Record<string,string>} | null}
 */
export function computeGeneratedPalette(state) {
	if (!PALETTE_IDS.some((id) => !isDefault(state, id))) return null;
	const contrastFloor = getValue(state, 'color.contrastFloor');
	return getPalettes({
		accent: { hue: getValue(state, 'color.accent.hue'), chroma: getValue(state, 'color.accent.chroma') },
		gray: { hue: getValue(state, 'color.gray.hue'), chroma: getValue(state, 'color.gray.chroma') },
		minimumContrast: contrastFloor === 'aaa' ? 7 : 4.5,
	});
}
const HUE_IDS = ['color.hue.orange', 'color.hue.green', 'color.hue.blue', 'color.hue.purple', 'color.hue.red'];
const HUE_VAR_NAMES = {
	'color.hue.orange': '--sl-hue-orange',
	'color.hue.green': '--sl-hue-green',
	'color.hue.blue': '--sl-hue-blue',
	'color.hue.purple': '--sl-hue-purple',
	'color.hue.red': '--sl-hue-red',
};
const ROLE_IDS = ['color.role.bg', 'color.role.bgNav', 'color.role.bgSidebar', 'color.role.text', 'color.role.link'];
const ROLE_VAR_NAMES = {
	'color.role.bg': '--sl-color-bg',
	'color.role.bgNav': '--sl-color-bg-nav',
	'color.role.bgSidebar': '--sl-color-bg-sidebar',
	'color.role.text': '--sl-color-text',
	'color.role.link': '--sl-color-text-accent',
};
const FONT_TOKEN_IDS = ['type.font.body', 'type.font.mono'];
const FONT_TOKEN_VAR_NAMES = { 'type.font.body': '--sl-font', 'type.font.mono': '--sl-font-mono' };
const HEADING_RULE_IDS = ['type.font.heading', 'type.headingWeight', 'type.headingLetterSpacing', 'type.headingCase'];
const SIMPLE_TOKEN_IDS = [
	'type.baseSize',
	'type.scaleRatio',
	'type.bodyLineHeight',
	'type.headingLineHeight',
	'layout.contentWidth',
	'layout.sidebarWidth',
	'layout.navHeight',
	'layout.contentGapY',
	'layout.shadowElevation',
];
const RADIUS_IDS = ['layout.radius'];
const CODE_FRAME_IDS = ['code.frameRadius'];
const TREATMENT_IDS = [
	'header.style',
	'header.searchTriggerStyle',
	'header.searchAlign',
	'sidebar.activeStyle',
	'sidebar.groupLabelStyle',
	'toc.currentItemStyle',
	// `toc.position` must precede `layout.contentAlign`: both can write
	// `--sl-content-margin-inline` on `.main-pane` (the former to flip Starlight's own
	// "hug the TOC" default when the rail has moved to the left; the latter as an explicit,
	// user-chosen override) - later source order wins for the same unlayered property, so an
	// explicit `layout.contentAlign` choice correctly wins over the automatic hug-flip.
	'toc.position',
	'layout.contentAlign',
	'content.asideStyle',
	'content.inlineCodeStyle',
	'content.linkStyle',
	'content.tableStyle',
	'content.titleAlign',
	'content.heroAlign',
	'components.tabsIndicatorStyle',
	'footer.paginationStyle',
	'footer.paginationAlign',
	'content.blockquoteStyle',
	'components.cardStyle',
	'components.linkButtonStyle',
	'components.badgeStyle',
];

// ---------------------------------------------------------------------------------------------
// A set of controls with literal selector overrides, on real Starlight
// 0.42.6 selectors (unchanged since 0.42.3 - 0.42.6's only stylesheet change adds `overflow: visible`
// to the icon rules in anchor-links.css and asides.css).
// Each is a literal selector-based override (not a custom property Starlight
// itself declares on :root), so - unlike PALETTE_IDS/HUE_IDS/ROLE_IDS above - there is nothing to
// gate as a group: every id here is diffed independently against its own manifest default.
// ---------------------------------------------------------------------------------------------
const K_RANGE_IDS = [
	'layout.contentPadX',
	'header.searchWidth',
	'header.titleSize',
	'sidebar.itemPaddingY',
	'sidebar.nestIndent',
	'toc.textSize',
	'toc.indent',
	'content.asidePadding',
	'content.tableCellPadding',
	'code.fontSize',
];
const K_TOGGLE_IDS = [
	'header.searchShortcut',
	'sidebar.hoverTint',
	'sidebar.nestGuides',
	'toc.depthGuides',
	'content.headingDivider',
	'footer.paginationShadow',
];

/**
 * Every control id whose emitted CSS is a single named custom property (as opposed to a
 * selector-based rule, a multi-token generated palette, or a treatment with several
 * declarations) - id -> the exact `--custom-property` name `buildRootTokens` writes for it.
 * Exported so `emit-apply.js`'s Verification section (gap 1: an APPLY-THEME.md reader has no
 * studio to read "should now read as X" against) can point at something checkable with
 * `getComputedStyle(document.documentElement).getPropertyValue(...)` instead of only a selector.
 * Deliberately does NOT cover `PALETTE_IDS` (five inputs jointly generate a whole token set - no
 * single property reflects any one of them) or any `TREATMENT_IDS`/`K_*_IDS` id (several
 * declarations, no single custom property).
 * @type {Record<string, string>}
 */
export const TOKEN_VAR_NAMES = { ...HUE_VAR_NAMES, ...ROLE_VAR_NAMES, ...FONT_TOKEN_VAR_NAMES };

/**
 * Every non-build-tier control id this emitter knows how to turn into CSS. Used by
 * `tests/core/coverage.test.js` to assert every manifest control is either here or tier 'build'.
 * @type {Set<string>}
 */
export const HANDLED_IDS = new Set([
	...PALETTE_IDS,
	...HUE_IDS,
	...ROLE_IDS,
	...FONT_TOKEN_IDS,
	...HEADING_RULE_IDS,
	...SIMPLE_TOKEN_IDS,
	...RADIUS_IDS,
	...CODE_FRAME_IDS,
	...TREATMENT_IDS,
	...K_RANGE_IDS,
	...K_TOGGLE_IDS,
]);

// ---------------------------------------------------------------------------------------------
// Numeric formatting - keeps output deterministic and free of float noise / trailing zeros.
// ---------------------------------------------------------------------------------------------

/** @param {number} n @param {number} [precision] @returns {string} */
function fmtNum(n, precision = 4) {
	return String(Number(n.toFixed(precision)));
}

// ---------------------------------------------------------------------------------------------
// Typography scale generator
// ---------------------------------------------------------------------------------------------

/**
 * Raw step name -> [Starlight 0.42.6 default size in px (props.css, byte-identical since 0.42.3), exponent relative to 'base'].
 * Starlight's ladder is not geometric: small steps are nearly flat (12/13/14) and large steps grow
 * ~1.2x, so the scale is anchored to these defaults rather than generated as base * ratio^n.
 */
const SCALE_STEPS = [
	['2xs', 12, -3],
	['xs', 13, -2],
	['sm', 14, -1],
	['base', 16, 0],
	['lg', 18, 1],
	['xl', 20, 2],
	['2xl', 24, 3],
	['3xl', 29, 4],
	['4xl', 35, 5],
	['5xl', 42, 6],
	['6xl', 64, 7],
];

/** Ratio at which the generated ladder reproduces Starlight's defaults (manifest default). */
const DEFAULT_RATIO = 1.2;

/**
 * Every step scales with base size. Steps above base additionally grow by (ratio / 1.2) per
 * half-step, so the ratio control spreads headings apart without shrinking small UI text
 * (sidebar, TOC, badges use the xs/sm steps) and without runaway display sizes at high ratios.
 * At base 16px and ratio 1.2 this returns Starlight's defaults exactly.
 * @param {number} baseSizePx
 * @param {number} ratio
 * @returns {Record<string, string>} step name -> rem value (e.g. `'1.125rem'`).
 */
function generateScale(baseSizePx, ratio) {
	/** @type {Record<string, string>} */
	const scale = {};
	for (const [name, defaultPx, exp] of SCALE_STEPS) {
		const spread = exp > 0 ? Math.pow(ratio / DEFAULT_RATIO, exp / 2) : 1;
		const px = defaultPx * (baseSizePx / 16) * spread;
		scale[name] = `${fmtNum(px / 16)}rem`;
	}
	return scale;
}

// ---------------------------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------------------------

/**
 * @param {import('./state.js').ThemeState} state
 * @returns {string} `@import '<pkg>';` lines for every distinct Fontsource package referenced by
 *   a non-'system' `type.font.*` value, sorted by package name for determinism.
 */
function buildFontImports(state) {
	const pkgs = new Set();
	for (const id of ['type.font.body', 'type.font.heading', 'type.font.mono']) {
		const value = getValue(state, id);
		if (value && value !== 'system') {
			const font = FONTS.find((f) => f.id === value);
			if (font) pkgs.add(font.pkg);
		}
	}
	if (pkgs.size === 0) return '';
	return [...pkgs].sort().map((pkg) => `@import '${pkg}';`).join('\n');
}

/**
 * @param {string} fontId A `FONTS[].id` or `'system'`.
 * @returns {string|null} CSS font-family value (with fallback stack), or `null` for `'system'`.
 */
function fontFamilyValue(fontId) {
	if (!fontId || fontId === 'system') return null;
	const font = FONTS.find((f) => f.id === fontId);
	if (!font) return null;
	const fallback =
		font.category === 'serif'
			? "ui-serif, Georgia, 'Times New Roman', serif"
			: font.category === 'mono'
				? 'var(--sl-font-system-mono)'
				: 'var(--sl-font-system)';
	return `'${font.family} Variable', ${fallback}`;
}

/**
 * Builds the single unlayered `:root { ... }` token block: generated dark palette (gated),
 * semantic hues, role overrides, font vars, typography scale, layout dims, shadow elevation,
 * and the global radius custom property. Returns `''` when nothing differs from default.
 * @param {import('./state.js').ThemeState} state
 * @returns {{ block: string, palette: {dark: Record<string,string>, light: Record<string,string>} | null }}
 */
function buildRootTokens(state) {
	/** @type {string[]} */
	const lines = [];
	const palette = computeGeneratedPalette(state);
	if (palette) {
		const d = palette.dark;
		lines.push(
			`--sl-color-white: ${d.white};`,
			`--sl-color-gray-1: ${d['gray-1']};`,
			`--sl-color-gray-2: ${d['gray-2']};`,
			`--sl-color-gray-3: ${d['gray-3']};`,
			`--sl-color-gray-4: ${d['gray-4']};`,
			`--sl-color-gray-5: ${d['gray-5']};`,
			`--sl-color-gray-6: ${d['gray-6']};`,
			`--sl-color-black: ${d.black};`,
			`--sl-color-accent-low: ${d['accent-low']};`,
			`--sl-color-accent: ${d.accent};`,
			`--sl-color-accent-high: ${d['accent-high']};`
		);
	}

	for (const id of HUE_IDS) {
		if (!isDefault(state, id)) lines.push(`${HUE_VAR_NAMES[id]}: ${getValue(state, id)};`);
	}
	for (const id of ROLE_IDS) {
		// A role color is the one free-form string this function prints into CSS; only a real hex
		// color gets through, whatever `sanitizeState` already checked.
		if (!isDefault(state, id) && isHexColor(getValue(state, id))) lines.push(`${ROLE_VAR_NAMES[id]}: ${getValue(state, id)};`);
	}
	for (const id of FONT_TOKEN_IDS) {
		if (!isDefault(state, id)) {
			const family = fontFamilyValue(getValue(state, id));
			if (family) lines.push(`${FONT_TOKEN_VAR_NAMES[id]}: ${family};`);
		}
	}

	const baseSize = getValue(state, 'type.baseSize');
	const ratio = getValue(state, 'type.scaleRatio');
	if (baseSize !== def('type.baseSize') || ratio !== def('type.scaleRatio')) {
		const scale = generateScale(baseSize, ratio);
		for (const [name] of SCALE_STEPS) lines.push(`--sl-text-${name}: ${scale[name]};`);
		lines.push(
			`--sl-text-h1: ${scale['4xl']};`,
			`--sl-text-h2: ${scale['3xl']};`,
			`--sl-text-h3: ${scale['2xl']};`,
			`--sl-text-h4: ${scale.xl};`,
			`--sl-text-h5: ${scale.lg};`,
			`--sl-text-h6: ${scale.base};`
		);
	}

	if (!isDefault(state, 'type.bodyLineHeight')) {
		lines.push(`--sl-line-height: ${fmtNum(getValue(state, 'type.bodyLineHeight'), 3)};`);
	}
	if (!isDefault(state, 'type.headingLineHeight')) {
		lines.push(`--sl-line-height-headings: ${fmtNum(getValue(state, 'type.headingLineHeight'), 3)};`);
	}

	if (!isDefault(state, 'layout.contentWidth')) {
		lines.push(`--sl-content-width: ${fmtNum(getValue(state, 'layout.contentWidth'))}rem;`);
	}
	if (!isDefault(state, 'layout.sidebarWidth')) {
		lines.push(`--sl-sidebar-width: ${fmtNum(getValue(state, 'layout.sidebarWidth'))}rem;`);
	}
	if (!isDefault(state, 'layout.navHeight')) {
		lines.push(`--sl-nav-height: ${fmtNum(getValue(state, 'layout.navHeight'))}rem;`);
	}
	if (!isDefault(state, 'layout.contentGapY')) {
		lines.push(`--sl-content-gap-y: ${fmtNum(getValue(state, 'layout.contentGapY'))}rem;`);
	}

	if (!isDefault(state, 'layout.shadowElevation')) {
		const elevation = getValue(state, 'layout.shadowElevation');
		const shadows = SHADOW_ELEVATIONS[elevation];
		if (shadows) {
			lines.push(`--sl-shadow-sm: ${shadows.sm};`, `--sl-shadow-md: ${shadows.md};`, `--sl-shadow-lg: ${shadows.lg};`);
		}
	}

	if (!isDefault(state, 'layout.radius')) {
		lines.push(`--svc-radius: ${fmtNum(getValue(state, 'layout.radius'), 0)}px;`);
	}

	if (lines.length === 0) return { block: '', palette };
	const block = `:root {\n${lines.map((l) => `\t${l}`).join('\n')}\n}`;
	return { block, palette };
}

/**
 * Hand-picked, mode-uniform elevation presets (applied identically to dark and light). Exported
 * (data-only, still JSON-serializable) so `ui/tiles/tile-grid.js` can render a `layout.shadowElevation`
 * live-sample tile using the exact same values, without a second copy drifting out of sync.
 */
export const SHADOW_ELEVATIONS = {
	none: { sm: 'none', md: 'none', lg: 'none' },
	soft: {
		sm: '0px 1px 1px hsla(0, 0%, 0%, 0.06)',
		md: '0px 4px 2px hsla(0, 0%, 0%, 0.05), 0px 2px 1px hsla(0, 0%, 0%, 0.06)',
		lg: '0px 12px 4px hsla(0, 0%, 0%, 0.04), 0px 6px 3px hsla(0, 0%, 0%, 0.06)',
	},
	strong: {
		sm: '0px 2px 2px hsla(0, 0%, 0%, 0.24), 0px 4px 2px hsla(0, 0%, 0%, 0.3)',
		md: '0px 12px 6px hsla(0, 0%, 0%, 0.18), 0px 6px 3px hsla(0, 0%, 0%, 0.24)',
		lg: '0px 32px 10px hsla(0, 0%, 0%, 0.14), 0px 16px 8px hsla(223, 13%, 10%, 0.4), 0px 8px 6px hsla(0, 0%, 0%, 0.5)',
	},
};

/**
 * @param {{dark: Record<string,string>, light: Record<string,string>} | null} palette
 * @returns {string} `:root[data-theme='light'] { ... }`, or `''` when the palette wasn't
 *   regenerated (colors at default).
 */
function buildLightTokens(palette) {
	if (!palette) return '';
	const l = palette.light;
	const lines = [
		`--sl-color-white: ${l.white};`,
		`--sl-color-gray-1: ${l['gray-1']};`,
		`--sl-color-gray-2: ${l['gray-2']};`,
		`--sl-color-gray-3: ${l['gray-3']};`,
		`--sl-color-gray-4: ${l['gray-4']};`,
		`--sl-color-gray-5: ${l['gray-5']};`,
		`--sl-color-gray-6: ${l['gray-6']};`,
		`--sl-color-gray-7: ${l['gray-7']};`,
		`--sl-color-black: ${l.black};`,
		`--sl-color-accent-low: ${l['accent-low']};`,
		`--sl-color-accent: ${l.accent};`,
		`--sl-color-accent-high: ${l['accent-high']};`,
	];
	return `:root[data-theme='light'] {\n${lines.map((x) => `\t${x}`).join('\n')}\n}`;
}

/**
 * @param {import('./state.js').ThemeState} state
 * @returns {string} `@media (min-width: 50em) { :root { ... } }` heading-size bump, matching
 *   Starlight's own responsive breakpoint for `--sl-text-h1..h4`. `''` when the scale is default.
 */
function buildTypographyMediaBlock(state) {
	const baseSize = getValue(state, 'type.baseSize');
	const ratio = getValue(state, 'type.scaleRatio');
	if (baseSize === def('type.baseSize') && ratio === def('type.scaleRatio')) return '';
	const scale = generateScale(baseSize, ratio);
	const lines = [
		`--sl-text-h1: ${scale['5xl']};`,
		`--sl-text-h2: ${scale['4xl']};`,
		`--sl-text-h3: ${scale['3xl']};`,
		`--sl-text-h4: ${scale['2xl']};`,
	];
	return `@media (min-width: 50em) {\n\t:root {\n${lines.map((l) => `\t\t${l}`).join('\n')}\n\t}\n}`;
}

/**
 * @param {import('./state.js').ThemeState} state
 * @returns {string} The composed heading-style rule (font-family/weight/letter-spacing/case),
 *   only including declarations that differ from default. `''` when none differ.
 */
function buildHeadingRule(state) {
	/** @type {string[]} */
	const decls = [];
	if (!isDefault(state, 'type.font.heading')) {
		const family = fontFamilyValue(getValue(state, 'type.font.heading'));
		if (family) decls.push(`font-family: ${family};`);
	}
	if (!isDefault(state, 'type.headingWeight')) {
		decls.push(`font-weight: ${getValue(state, 'type.headingWeight')};`);
	}
	if (!isDefault(state, 'type.headingLetterSpacing')) {
		decls.push(`letter-spacing: ${fmtNum(getValue(state, 'type.headingLetterSpacing'), 4)}em;`);
	}
	if (!isDefault(state, 'type.headingCase')) {
		decls.push(`text-transform: ${getValue(state, 'type.headingCase')};`);
	}
	if (decls.length === 0) return '';
	return `.sl-markdown-content :is(h1, h2, h3, h4, h5, h6), h1#_top, .site-title {\n${decls
		.map((d) => `\t${d}`)
		.join('\n')}\n}`;
}

/**
 * @param {import('./state.js').ThemeState} state
 * @returns {string} The `--svc-radius` application block: sets the property (mirrored into
 *   `--ec-brdRad`) and applies `border-radius: var(--svc-radius)` to the fixed set of stable
 *   Tier-2 radius hooks, independent of which treatment option (if any) is selected for each.
 *   `''` when `layout.radius` is at its default.
 */
function buildGlobalRadiusRules(state) {
	if (isDefault(state, 'layout.radius')) return '';
	/** @type {string[]} */
	const rules = [`:root {\n\t--ec-brdRad: var(--svc-radius);\n}`];
	for (const hook of globalRadiusHooks) {
		const rule = `${hook.selector} {\n\tborder-radius: var(--svc-radius);\n}`;
		rules.push(hook.mediaQuery ? `@media ${hook.mediaQuery} {\n${indent(rule)}\n}` : rule);
	}
	return rules.join('\n\n');
}

/** @param {string} block @returns {string} */
function indent(block) {
	return block
		.split('\n')
		.map((l) => `\t${l}`)
		.join('\n');
}

/**
 * This set's range/toggle controls: literal selector overrides, each independent of the
 * others (no shared custom property to gate as a group - contrast PALETTE_IDS above). Emitted
 * BEFORE `buildTreatmentRules` so two real interactions resolve correctly regardless of which
 * control the caller touched: `content.asidePadding`'s `padding` shorthand must precede
 * `content.asideStyle: minimal`'s `padding-inline-start: 0` longhand (else the shorthand would
 * clobber it back), and `footer.paginationShadow: off`'s `box-shadow: none` must precede
 * `footer.paginationStyle: minimal-links`'s own `box-shadow: none` so the two never fight (same
 * declaration either way, but source order still governs if a future style ever disagrees).
 * @param {import('./state.js').ThemeState} state
 * @returns {string}
 */
function buildKDetailRules(state) {
	/** @type {string[]} */
	const blocks = [];

	if (!isDefault(state, 'layout.contentPadX')) {
		blocks.push(`.content-panel {\n\tpadding-inline: ${fmtNum(getValue(state, 'layout.contentPadX'))}rem;\n}`);
	}

	if (!isDefault(state, 'header.searchWidth')) {
		blocks.push(
			`@media (min-width: 50rem) {\n\tbutton[data-open-modal] {\n\t\tmax-width: ${fmtNum(
				getValue(state, 'header.searchWidth')
			)}rem;\n\t}\n}`
		);
	}
	if (!isDefault(state, 'header.searchShortcut') && getValue(state, 'header.searchShortcut') === false) {
		blocks.push(`button[data-open-modal] > kbd {\n\tdisplay: none;\n}`);
	}
	if (!isDefault(state, 'header.titleSize')) {
		blocks.push(`.site-title {\n\tfont-size: ${fmtNum(getValue(state, 'header.titleSize'))}rem;\n}`);
	}

	if (!isDefault(state, 'sidebar.itemPaddingY')) {
		blocks.push(`.sidebar-content a {\n\tpadding-block: ${fmtNum(getValue(state, 'sidebar.itemPaddingY'), 3)}em;\n}`);
	}
	if (!isDefault(state, 'sidebar.hoverTint') && getValue(state, 'sidebar.hoverTint') === true) {
		blocks.push(
			`.sidebar-content a:hover:not([aria-current='page']),\n.sidebar-content a:focus:not([aria-current='page']) {\n\tbackground-color: var(--sl-color-gray-5);\n\tborder-radius: var(--svc-radius, 0.25rem);\n}`
		);
	}
	if (!isDefault(state, 'sidebar.nestIndent')) {
		const value = `${fmtNum(getValue(state, 'sidebar.nestIndent'))}rem`;
		blocks.push(`.sidebar-content ul ul li {\n\tmargin-inline-start: ${value};\n\tpadding-inline-start: ${value};\n}`);
	}
	if (!isDefault(state, 'sidebar.nestGuides') && getValue(state, 'sidebar.nestGuides') === false) {
		blocks.push(`.sidebar-content ul ul li {\n\tborder-inline-start: none;\n}`);
	}

	if (!isDefault(state, 'toc.textSize')) {
		blocks.push(`starlight-toc a {\n\tfont-size: ${fmtNum(getValue(state, 'toc.textSize'), 4)}rem;\n}`);
	}
	if (!isDefault(state, 'toc.indent')) {
		blocks.push(
			`starlight-toc a {\n\tpadding-inline-start: calc(${fmtNum(getValue(state, 'toc.indent'))}rem * var(--depth, 0) + 0.5rem);\n}`
		);
	}
	if (!isDefault(state, 'toc.depthGuides') && getValue(state, 'toc.depthGuides') === true) {
		// Fixes two separate bugs in the old rule (its output showed no lines and
		// "irregular" indentation on a long document):
		//  1. It unconditionally set `padding-inline-start: 0.25rem` on every nested `<a>`, clobbering
		//     Starlight's own per-depth formula (`calc(1rem * var(--depth) + 0.5rem)`,
		//     TableOfContentsList.astro) AND toc.indent's own override below - depth-1 and depth-2
		//     landed at the identical indent instead of stepping further right per level.
		//  2. `--sl-color-hairline-light` resolves to the SAME value as `--sl-color-hairline` in light
		//     mode (both `--sl-color-gray-6`, ~94% lightness - verified against props.css) - a hairline
		//     against the TOC's own near-white background, effectively invisible.
		// Fix: touch no padding at all (each depth keeps whichever indent - stock or toc.indent - is
		// already in effect), and draw one line per NESTED LIST (`li > ul`, not the leaf `<a>`) as an
		// absolutely positioned pseudo-element spanning that list's own height - the conventional
		// tree-view guide: one continuous line per depth level, not one per row. `::before` is
		// deliberately avoided (`toc.currentItemStyle: dot` already owns `a::before` for its current-
		// item marker; using `::after` here on a different element - the enclosing `<ul>`, never the
		// `<a>` - keeps the two controls from ever fighting over the same box even where they overlap).
		// The inset reuses toc.indent's own effective step (default 1rem) via the SAME `--depth`
		// variable, so the line lines up with each depth's own text whether or not toc.indent is
		// customized (verified in treatments.mjs against Long doc's real h3/h4 markup, light+dark).
		const indentStep = isDefault(state, 'toc.indent') ? 1 : getValue(state, 'toc.indent');
		blocks.push(
			`starlight-toc li > ul {\n\tposition: relative;\n}\nstarlight-toc li > ul::after {\n\tcontent: '';\n\tposition: absolute;\n\tinset-inline-start: calc(${fmtNum(
				indentStep
			)}rem * var(--depth, 0) + 0.15rem);\n\ttop: 0;\n\tbottom: 0;\n\twidth: 1px;\n\tbackground: var(--sl-color-gray-4);\n\tpointer-events: none;\n}`
		);
	}

	if (!isDefault(state, 'content.asidePadding')) {
		blocks.push(`.starlight-aside {\n\tpadding: ${fmtNum(getValue(state, 'content.asidePadding'))}rem;\n}`);
	}
	if (!isDefault(state, 'content.headingDivider') && getValue(state, 'content.headingDivider') === true) {
		blocks.push(
			`.sl-markdown-content h2:not(:where(.not-content *)) {\n\tborder-bottom: 1px solid var(--sl-color-hairline);\n\tpadding-bottom: 0.3em;\n}`
		);
	}
	if (!isDefault(state, 'content.tableCellPadding')) {
		blocks.push(
			`.sl-markdown-content :is(th, td):not(:where(.not-content *)) {\n\tpadding-block: ${fmtNum(
				getValue(state, 'content.tableCellPadding')
			)}rem;\n}`
		);
	}

	if (!isDefault(state, 'code.fontSize')) {
		blocks.push(`:root {\n\t--ec-codeFontSize: ${fmtNum(getValue(state, 'code.fontSize'), 4)}rem;\n}`);
	}

	if (!isDefault(state, 'footer.paginationShadow') && getValue(state, 'footer.paginationShadow') === false) {
		blocks.push(`.pagination-links a {\n\tbox-shadow: none;\n}`);
	}

	return blocks.join('\n\n');
}

/**
 * @param {import('./state.js').ThemeState} state
 * @returns {string} One CSS rule block per non-default select-treatment control, in a fixed
 *   (manifest) order, using `treatments.js`. `code.frameRadius`'s own `--ec-brdRad` override is
 *   appended last so an explicit frame-radius choice wins over the global radius hook above.
 */
function buildTreatmentRules(state) {
	/** @type {string[]} */
	const blocks = [];
	for (const id of TREATMENT_IDS) {
		if (isDefault(state, id)) continue;
		const value = getValue(state, id);
		const entry = treatments[id] && treatments[id][value];
		if (entry) blocks.push(entry.css);
	}
	if (!isDefault(state, 'code.frameRadius')) {
		blocks.push(`:root {\n\t--ec-brdRad: ${fmtNum(getValue(state, 'code.frameRadius'), 0)}px;\n}`);
	}
	return blocks.join('\n\n');
}

/**
 * @param {import('./state.js').ThemeState} state
 * @returns {string} `forPreview`-only build-time approximations. Explicit-based (see file
 *   header), not default-based: each check below only fires for a control the user actually
 *   touched (`isExplicit`), so an untouched control leaves the previewed page's own real build
 *   exactly as it renders it.
 */
function buildPreviewApprox(state) {
	/** @type {string[]} */
	const blocks = [];

	if (isExplicit(state, 'page.pagination') && getValue(state, 'page.pagination') === false) {
		blocks.push(`.pagination-links {\n\tdisplay: none;\n}`);
	}
	if (isExplicit(state, 'page.headingLinks') && getValue(state, 'page.headingLinks') === false) {
		blocks.push(`.sl-anchor-link {\n\tdisplay: none;\n}`);
	}
	if (isExplicit(state, 'page.credits') && getValue(state, 'page.credits') === false) {
		blocks.push(`footer .kudos {\n\tdisplay: none;\n}`);
	}

	// Each bound only constrains levels on ITS OWN side, and only when the user explicitly set
	// it - an untouched bound imposes no constraint at all, leaving that side exactly as the
	// previewed page's own `tableOfContents` config (whatever it is) already renders it. This
	// means an explicit min with an untouched max excludes only levels below min, never levels
	// above the manifest's default max (which may not match the real page's own max at all).
	const minTouched = isExplicit(state, 'page.toc.minLevel');
	const maxTouched = isExplicit(state, 'page.toc.maxLevel');
	const min = getValue(state, 'page.toc.minLevel');
	const max = getValue(state, 'page.toc.maxLevel');
	const excluded = [1, 2, 3, 4, 5, 6].filter((level) => (minTouched && level < min) || (maxTouched && level > max));
	if (excluded.length > 0) {
		const containerSelectors = excluded.flatMap((level) => [
			`starlight-toc li[data-svc-level='${level}']`,
			`mobile-starlight-toc li[data-svc-level='${level}']`,
		]);
		const linkSelectors = excluded.flatMap((level) => [
			`starlight-toc li[data-svc-level='${level}'] > a`,
			`mobile-starlight-toc li[data-svc-level='${level}'] > a`,
		]);
		// `display: contents` on the <li> (not `none`) so a still-visible child <ul> (a deeper,
		// in-range heading nested under an excluded one) survives; only the excluded level's own
		// <a> is hidden.
		blocks.push(`${containerSelectors.join(',\n')} {\n\tdisplay: contents;\n}`);
		blocks.push(`${linkSelectors.join(',\n')} {\n\tdisplay: none;\n}`);
	}

	// `page.lastUpdated`: no CSS action possible (can't fabricate a date in a static preview).
	// `code.theme`: build-time only; UI shows a note rather than live-swapping syntax colors.

	if (getValue(state, 'code.wrap') === true) {
		// Mirrors Expressive Code's own `.wrap` class rule (added server-side from
		// `defaultProps.wrap`, verified in the built `ec.*.css`), applied here regardless of that
		// class so the preview approximates wrapping without needing a real EC rebuild.
		blocks.push(
			`.expressive-code .ec-line .code {\n\twhite-space: pre-wrap;\n\toverflow-wrap: break-word;\n\tmin-width: min(20ch, var(--ecMaxLine, 20ch));\n}`
		);
	}

	return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * @param {import('./state.js').ThemeState} state
 * @param {{forPreview?: boolean}} [options]
 * @returns {string} The full theme.css text. Deterministic: identical `state` (by value) always
 *   produces byte-identical output.
 */
export function emitCss(state, { forPreview = false } = {}) {
	const header = `/*\n * Starlight Visual Customizer\n * Target: Starlight ${STARLIGHT_VERSION} (@astrojs/starlight)\n * Load via the \`customCss\` option in astro.config.mjs.\n * Unlayered, deterministic output - only diffs from Starlight's own defaults are emitted.\n * Made with the Starlight Visual Customizer: ${TOOL_URL}\n */`;

	const { block: rootBlock, palette } = buildRootTokens(state);
	const typographyMedia = buildTypographyMediaBlock(state);
	const lightBlock = buildLightTokens(palette);
	const headingRule = buildHeadingRule(state);
	const globalRadiusRules = buildGlobalRadiusRules(state);
	const kDetailRules = buildKDetailRules(state);
	const treatmentRules = buildTreatmentRules(state);

	/** @type {string[]} */
	const parts = [header];
	if (!forPreview) {
		const imports = buildFontImports(state);
		if (imports) parts.push(imports);
	}
	if (rootBlock) parts.push(rootBlock);
	if (typographyMedia) parts.push(typographyMedia);
	if (lightBlock) parts.push(lightBlock);
	// Component-scoped tokens section: intentionally empty for v1 - every current control either
	// writes a plain :root custom property or a selector-based treatment rule; nothing needs a
	// literal component-scoped token override (e.g. `.starlight-aside--note { --sl-color-... }`).
	const treatmentSection = [headingRule, globalRadiusRules, kDetailRules, treatmentRules].filter(Boolean).join('\n\n');
	if (treatmentSection) parts.push(treatmentSection);
	if (forPreview) {
		const approx = buildPreviewApprox(state);
		if (approx) parts.push(approx);
	}

	return parts.filter(Boolean).join('\n\n') + '\n';
}
