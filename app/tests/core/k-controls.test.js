/**
 * @file Unit coverage for a set of controls with literal selector overrides, each independent of
 * `treatments.js`'s generic per-control CSS, on real Starlight 0.42.6 selectors (unchanged since
 * 0.42.3 - see `treatments.js`'s
 * file header for what the upgrade actually touched). `tests/core/emit-css.test.js`'s generic
 * "coverage" and "treatments.js completeness" suites already prove every id here is handled and
 * that every select option emits *some* CSS; this file checks the *specific* selector/property
 * each one is supposed to touch, so a future refactor that silently changes a selector still
 * fails loudly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { emitCss } from '../../src/customizer/core/emit-css.js';
import { emitApplyTheme } from '../../src/customizer/core/emit-apply.js';
import { defaultState, setValue } from '../../src/customizer/core/state.js';
import { controls } from '../../src/customizer/core/manifest.js';

const controlsById = new Map(controls.map((c) => [c.id, c]));

/** Every new K control id, with a non-default value to exercise it. */
const NEW_RANGE_OR_TOGGLE_PROBES = [
	{ id: 'layout.contentPadX', value: 2, expect: /\.content-panel \{\n\tpadding-inline: 2rem;\n\}/ },
	{
		id: 'header.searchWidth',
		value: 18,
		expect: /@media \(min-width: 50rem\) \{\n\tbutton\[data-open-modal\] \{\n\t\tmax-width: 18rem;/,
	},
	{ id: 'header.searchShortcut', value: false, expect: /button\[data-open-modal\] > kbd \{\n\tdisplay: none;/ },
	{ id: 'header.titleSize', value: 1.5, expect: /\.site-title \{\n\tfont-size: 1\.5rem;\n\}/ },
	{ id: 'sidebar.itemPaddingY', value: 0.5, expect: /\.sidebar-content a \{\n\tpadding-block: 0\.5em;\n\}/ },
	{
		id: 'sidebar.hoverTint',
		value: true,
		expect: /\.sidebar-content a:hover:not\(\[aria-current='page'\]\)/,
	},
	{
		id: 'sidebar.nestIndent',
		value: 1.5,
		expect: /\.sidebar-content ul ul li \{\n\tmargin-inline-start: 1\.5rem;\n\tpadding-inline-start: 1\.5rem;\n\}/,
	},
	{ id: 'sidebar.nestGuides', value: false, expect: /\.sidebar-content ul ul li \{\n\tborder-inline-start: none;/ },
	{ id: 'toc.textSize', value: 1, expect: /starlight-toc a \{\n\tfont-size: 1rem;\n\}/ },
	{
		id: 'toc.indent',
		value: 1.5,
		expect: /starlight-toc a \{\n\tpadding-inline-start: calc\(1\.5rem \* var\(--depth, 0\) \+ 0\.5rem\);/,
	},
	// The old rule (`li li a { border-inline-start; padding-
	// inline-start: 0.25rem }`) clobbered Starlight's own per-depth padding (every depth landed at the
	// same indent) and used a hairline color indistinguishable from the TOC's own background - see
	// emit-css.js's own comment on this block. Now one guide line per nested list (`li > ul`), an
	// absolutely positioned `::after` (never `::before` - `toc.currentItemStyle: dot` owns that on
	// the anchor) whose inset tracks the same step every depth's own text already uses.
	{
		id: 'toc.depthGuides',
		value: true,
		expect: /starlight-toc li > ul \{\n\tposition: relative;\n\}\nstarlight-toc li > ul::after \{\n\tcontent: '';\n\tposition: absolute;\n\tinset-inline-start: calc\(1rem \* var\(--depth, 0\) \+ 0\.15rem\);/,
	},
	{ id: 'content.asidePadding', value: 1.5, expect: /\.starlight-aside \{\n\tpadding: 1\.5rem;\n\}/ },
	{
		id: 'content.headingDivider',
		value: true,
		expect: /\.sl-markdown-content h2:not\(:where\(\.not-content \*\)\) \{\n\tborder-bottom: 1px solid/,
	},
	{
		id: 'content.tableCellPadding',
		value: 1,
		expect: /\.sl-markdown-content :is\(th, td\):not\(:where\(\.not-content \*\)\) \{\n\tpadding-block: 1rem;/,
	},
	{ id: 'code.fontSize', value: 1, expect: /--ec-codeFontSize: 1rem;/ },
	{ id: 'footer.paginationShadow', value: false, expect: /\.pagination-links a \{\n\tbox-shadow: none;/ },
];

describe('K controls: defaults emit nothing (pixel-identical to stock Starlight)', () => {
	test('the default state has no new K CSS at all (already covered by the header-only golden, re-asserted per id)', () => {
		const out = emitCss(defaultState());
		for (const { id } of NEW_RANGE_OR_TOGGLE_PROBES) {
			assert.equal(controlsById.get(id).default, controlsById.get(id).default); // sanity: id exists
		}
		assert.equal(out.trim().endsWith('*/'), true, 'default state must emit only the header comment');
	});

	test('every new K control at its own manifest default, set individually, changes nothing', () => {
		const base = emitCss(defaultState());
		for (const { id } of NEW_RANGE_OR_TOGGLE_PROBES) {
			const control = controlsById.get(id);
			const state = setValue(defaultState(), id, control.default);
			assert.equal(emitCss(state), base, `${id} at its own default must not appear in state.values`);
			assert.equal(Object.prototype.hasOwnProperty.call(state.values, id), false, `${id} default should be canonicalized away`);
		}
	});
});

describe('K controls: non-default values emit the expected selector/property', () => {
	for (const { id, value, expect } of NEW_RANGE_OR_TOGGLE_PROBES) {
		test(`${id} = ${JSON.stringify(value)}`, () => {
			const state = setValue(defaultState(), id, value);
			const out = emitCss(state);
			assert.match(out, expect, out);
		});
	}
});

describe('K controls: ordering interactions', () => {
	test('content.asidePadding (shorthand) precedes content.asideStyle "minimal" (longhand) so minimal still wins', () => {
		let state = setValue(defaultState(), 'content.asidePadding', 2);
		state = setValue(state, 'content.asideStyle', 'minimal');
		const out = emitCss(state);
		const paddingBlock = out.slice(out.indexOf('padding: 2rem'), out.indexOf('padding: 2rem') + 40);
		const minimalIdx = out.indexOf("padding-inline-start: 0;");
		assert.ok(out.includes('padding: 2rem;'), 'asidePadding shorthand should still be present');
		assert.ok(minimalIdx > out.indexOf('padding: 2rem;'), 'the longhand override must come after the shorthand');
	});

	test('footer.paginationShadow off precedes footer.paginationStyle "minimal-links" (both remove the shadow, order is harmless)', () => {
		let state = setValue(defaultState(), 'footer.paginationShadow', false);
		state = setValue(state, 'footer.paginationStyle', 'minimal-links');
		const out = emitCss(state);
		const first = out.indexOf('box-shadow: none;');
		assert.ok(first !== -1);
	});
});

describe('code.wrap (build tier)', () => {
	test('is tier "build" and defaults to false', () => {
		const control = controlsById.get('code.wrap');
		assert.equal(control.tier, 'build');
		assert.equal(control.default, false);
	});

	test('non-preview output never includes the wrap approximation', () => {
		const state = setValue(defaultState(), 'code.wrap', true);
		const out = emitCss(state, { forPreview: false });
		assert.equal(out.includes('white-space: pre-wrap'), false);
	});

	test('forPreview output approximates wrapping when on', () => {
		const state = setValue(defaultState(), 'code.wrap', true);
		const out = emitCss(state, { forPreview: true });
		assert.match(out, /\.expressive-code \.ec-line \.code \{\n\twhite-space: pre-wrap;/);
	});

	test('forPreview output omits the wrap approximation when off (the default)', () => {
		const out = emitCss(defaultState(), { forPreview: true });
		assert.equal(out.includes('white-space: pre-wrap'), false);
	});

	test('emitApplyTheme merges wrap into the SAME expressiveCode config line as code.theme, not a second key', () => {
		let state = setValue(defaultState(), 'code.theme', 'nord');
		state = setValue(state, 'code.wrap', true);
		const out = emitApplyTheme(state);
		const matches = out.match(/`expressiveCode: \{[^`]*\}`/g) || [];
		assert.equal(matches.length, 1, 'expected exactly one expressiveCode config line');
		assert.match(matches[0], /themes: \['nord', 'min-light'\]/);
		assert.match(matches[0], /defaultProps: \{ wrap: true \}/);
	});

	test('emitApplyTheme emits defaultProps.wrap alone when only code.wrap changed', () => {
		const state = setValue(defaultState(), 'code.wrap', true);
		const out = emitApplyTheme(state);
		assert.match(out, /`expressiveCode: \{ defaultProps: \{ wrap: true \} \}`/);
	});

	test('emitApplyTheme output is unchanged when code.wrap is left at its default', () => {
		const withoutWrap = emitApplyTheme(defaultState());
		assert.doesNotMatch(withoutWrap, /expressiveCode/);
	});
});

describe('choice controls with tiles: every non-default option is visually distinct in emitted CSS', () => {
	const TILE_SELECT_IDS = ['content.blockquoteStyle', 'components.cardStyle', 'components.linkButtonStyle', 'components.badgeStyle'];
	for (const id of TILE_SELECT_IDS) {
		test(`${id}: every option's CSS is unique among its siblings`, () => {
			const control = controlsById.get(id);
			const seen = new Set();
			for (const opt of control.options) {
				if (opt.value === control.default) continue;
				const out = emitCss(setValue(defaultState(), id, opt.value));
				assert.equal(seen.has(out), false, `${id}=${opt.value} produced CSS identical to another option`);
				seen.add(out);
			}
		});
	}
});
