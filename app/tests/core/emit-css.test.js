import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { emitCss, HANDLED_IDS } from '../../src/customizer/core/emit-css.js';
import { controls } from '../../src/customizer/core/manifest.js';
import { treatments } from '../../src/customizer/core/treatments.js';
import { presets } from '../../src/customizer/core/presets.js';
import { defaultState, setValue, applyPreset } from '../../src/customizer/core/state.js';
import { goldenCases } from '../golden/cases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(__dirname, '..', 'golden');

/** Reads a golden fixture, normalizing CRLF -> LF so a Windows checkout/editor can't break a byte-for-byte comparison. */
function readGolden(name) {
	return readFileSync(path.join(goldenDir, name), 'utf8').replace(/\r\n/g, '\n');
}

describe('emitCss determinism', () => {
	test('same state produces byte-identical output across repeated calls', () => {
		const state = applyPreset(defaultState(), 'dense-technical');
		const a = emitCss(state);
		const b = emitCss(state);
		const c = emitCss(structuredClone(state));
		assert.equal(a, b);
		assert.equal(a, c);
	});

	test('default state emits only the header comment', () => {
		const out = emitCss(defaultState());
		assert.match(out, /^\/\*\n \* Starlight Visual Customizer\n/);
		// Nothing else: exactly one comment block, then nothing.
		assert.equal(out.trim().endsWith('*/'), true);
		assert.equal(out.includes(':root {'), false);
	});

	test('default (untouched) state in forPreview mode emits nothing at all, including no credits hide', () => {
		// Preview approximations are explicit-based (see emit-css.js header): page.credits's own
		// manifest default is "off", but an untouched control must never force an approximation -
		// the previewed page's own real astro.config.mjs decides whether credits shows, independent
		// of this control ever being touched. See `buildPreviewApprox`'s "untouched" doc comment.
		const out = emitCss(defaultState(), { forPreview: true });
		assert.equal(out.includes(':root {'), false);
		assert.equal(out.includes('.pagination-links'), false);
		assert.equal(out.includes('.sl-anchor-link'), false);
		assert.equal(out.includes('footer .kudos'), false);
		assert.equal(out.includes('data-svc-level'), false);
		assert.equal(out.trim().endsWith('*/'), true);
	});
});

describe('coverage: every non-build control is handled', () => {
	test('every manifest control id is either tier "build" or in emit-css HANDLED_IDS', () => {
		const unhandled = controls.filter((c) => c.tier !== 'build' && !HANDLED_IDS.has(c.id));
		assert.deepEqual(
			unhandled.map((c) => c.id),
			[],
			'every non-build control must be handled by emit-css.js'
		);
	});

	test('HANDLED_IDS contains no unknown or build-tier ids', () => {
		const byId = new Map(controls.map((c) => [c.id, c]));
		for (const id of HANDLED_IDS) {
			const control = byId.get(id);
			assert.ok(control, `HANDLED_IDS references unknown control id "${id}"`);
			assert.notEqual(control.tier, 'build', `HANDLED_IDS should not include build-tier "${id}"`);
		}
	});
});

describe('treatments.js completeness', () => {
	const selectTreatmentIds = controls
		.filter((c) => c.type === 'select' && treatments[c.id])
		.map((c) => c.id);

	test('every non-default option of every treatment control has a treatments.js entry', () => {
		for (const id of selectTreatmentIds) {
			const control = controls.find((c) => c.id === id);
			for (const opt of control.options) {
				if (opt.value === control.default) continue;
				const entry = treatments[id][opt.value];
				assert.ok(entry, `treatments["${id}"]["${opt.value}"] is missing`);
				assert.ok(entry.css && entry.css.trim().length > 0, `treatments["${id}"]["${opt.value}"].css is empty`);
				assert.ok(entry.probe && entry.probe.selector && entry.probe.property, `treatments["${id}"]["${opt.value}"].probe is incomplete`);
			}
		}
	});

	test('every non-default option actually produces non-empty emitted CSS from a real state', () => {
		for (const id of selectTreatmentIds) {
			const control = controls.find((c) => c.id === id);
			for (const opt of control.options) {
				if (opt.value === control.default) continue;
				const state = setValue(defaultState(), id, opt.value);
				const out = emitCss(state);
				assert.ok(out.length > readGolden('default.css').length, `${id}=${opt.value} produced no extra CSS`);
			}
		}
	});
});

describe('presets', () => {
	test('starlight-default reproduces the plain default output exactly', () => {
		const base = emitCss(defaultState());
		assert.equal(emitCss(applyPreset(defaultState(), 'starlight-default')), base);
	});

	test('every other preset differs from the default output', () => {
		const base = emitCss(defaultState());
		const exempt = new Set(['starlight-default']);
		for (const preset of presets) {
			if (exempt.has(preset.id)) continue;
			const out = emitCss(applyPreset(defaultState(), preset.id));
			assert.notEqual(out, base, `preset "${preset.id}" produced the default output`);
			assert.ok(out.length > 0);
		}
	});

	test('every preset produces CSS with no @layer wrapper and no !important', () => {
		for (const preset of presets) {
			const out = emitCss(applyPreset(defaultState(), preset.id));
			assert.equal(out.includes('@layer'), false, `preset "${preset.id}" leaked an @layer`);
			assert.equal(out.includes('!important'), false, `preset "${preset.id}" used !important`);
		}
	});
});

// The cases live in tests/golden/cases.js, shared with `npm run golden:update`: default state, the
// "ocean" palette preset and the "dense-technical" character preset.
describe('golden files', () => {
	for (const c of goldenCases.filter((g) => g.file.endsWith('.css'))) {
		test(`emitCss matches tests/golden/${c.file} byte-for-byte`, () => {
			assert.equal(c.emit(), readGolden(c.file));
		});
	}
});

describe('forPreview build-time approximations', () => {
	test('turning pagination off hides .pagination-links', () => {
		const state = setValue(defaultState(), 'page.pagination', false);
		const out = emitCss(state, { forPreview: true });
		assert.match(out, /\.pagination-links\s*\{\s*display: none;/);
	});

	test('turning headingLinks off hides .sl-anchor-link', () => {
		const state = setValue(defaultState(), 'page.headingLinks', false);
		const out = emitCss(state, { forPreview: true });
		assert.match(out, /\.sl-anchor-link\s*\{\s*display: none;/);
	});

	test('credits left untouched (at its "off" manifest default) does NOT hide footer .kudos', () => {
		// Regression test for the W1 round-trip mismatch: page.credits's manifest default is "off",
		// but a real target page can (and the app's own demo site does) set `credits: true`, so an
		// untouched control must not force the preview to hide a link the real page actually shows.
		const out = emitCss(defaultState(), { forPreview: true });
		assert.equal(out.includes('footer .kudos'), false);
	});

	test('explicitly turning credits on emits no hide rule either (nothing to hide)', () => {
		const state = setValue(defaultState(), 'page.credits', true);
		const out = emitCss(state, { forPreview: true });
		assert.equal(out.includes('footer .kudos'), false);
	});

	test('an explicit credits:false in state.values (e.g. a hand-authored/imported state.json) still hides footer .kudos', () => {
		// `setValue` never stores a value equal to the default (see state.js), so this constructs the
		// state by hand rather than via `setValue` - the one way `state.values.page.credits` can ever
		// literally be `false` (explicit intent, not merely "untouched").
		const state = { ...defaultState(), values: { 'page.credits': false } };
		const out = emitCss(state, { forPreview: true });
		assert.match(out, /footer \.kudos\s*\{\s*display: none;/);
	});

	test('non-preview output never includes the build-time approximation CSS', () => {
		const state = setValue(defaultState(), 'page.pagination', false);
		const out = emitCss(state, { forPreview: false });
		assert.equal(out.includes('.pagination-links'), false);
	});

	test('excluding a TOC level hides its <li> contents via display:contents + hidden <a>, not display:none on the <li>', () => {
		let state = setValue(defaultState(), 'page.toc.minLevel', 3);
		// maxLevel stays at its default (3) here on purpose - setting it to its own default would be
		// dropped by `setValue` anyway (see state.js), so this also covers the "only one bound
		// touched" case below.
		const out = emitCss(state, { forPreview: true });
		assert.match(out, /li\[data-svc-level='2'\][\s\S]*?display: contents;/);
		assert.match(out, /li\[data-svc-level='2'\] > a[\s\S]*?display: none;/);
		// The excluded level's container must NOT be display:none (that would also hide nested,
		// in-range descendants).
		assert.doesNotMatch(out, /li\[data-svc-level='2'\]\s*\{\s*display: none;/);
	});

	test('untouched TOC min/max levels emit no level-filtering CSS at all', () => {
		// Regression test for the same mismatch class as page.credits: the manifest default range
		// (2-3) does not match the app's own demo site config (2-4), so an untouched control must
		// leave every level exactly as the real page's own tableOfContents config renders it.
		const out = emitCss(defaultState(), { forPreview: true });
		assert.equal(out.includes('data-svc-level'), false);
	});

	test('an explicit maxLevel with an untouched minLevel excludes only levels above max, never below the default min', () => {
		const state = setValue(defaultState(), 'page.toc.maxLevel', 4);
		const out = emitCss(state, { forPreview: true });
		// Level 5/6 (above the explicit max) are excluded.
		assert.match(out, /li\[data-svc-level='5'\][\s\S]*?display: contents;/);
		assert.match(out, /li\[data-svc-level='6'\][\s\S]*?display: contents;/);
		// Level 1 (below the manifest's default min of 2, but minLevel was never touched) is NOT
		// excluded - the untouched bound imposes no constraint.
		assert.equal(out.includes("data-svc-level='1'"), false);
		// Level 4 (within the new max) is not excluded either.
		assert.equal(out.includes("data-svc-level='4'"), false);
	});

	test('an explicit minLevel with an untouched maxLevel excludes only levels below min, never above the default max', () => {
		const state = setValue(defaultState(), 'page.toc.minLevel', 4);
		const out = emitCss(state, { forPreview: true });
		// Levels 1-3 (below the explicit min) are excluded.
		for (const level of [1, 2, 3]) {
			assert.match(out, new RegExp(`li\\[data-svc-level='${level}'\\][\\s\\S]*?display: contents;`));
		}
		// Levels 5/6 (above the manifest's default max of 3, but maxLevel was never touched) are NOT
		// excluded.
		assert.equal(out.includes("data-svc-level='5'"), false);
		assert.equal(out.includes("data-svc-level='6'"), false);
	});
});

describe('layout.radius drives Tier-2 hooks independently of treatment selection', () => {
	test('changing only layout.radius emits border-radius rules with no treatment selected', () => {
		const state = setValue(defaultState(), 'layout.radius', 16);
		const out = emitCss(state);
		assert.match(out, /--svc-radius: 16px;/);
		assert.match(out, /\.sidebar-content a\[aria-current='page'\] \{\n\tborder-radius: var\(--svc-radius\);/);
		assert.match(out, /--ec-brdRad: var\(--svc-radius\);/);
	});

	test('an explicit code.frameRadius overrides the global radius hook for --ec-brdRad (last wins)', () => {
		let state = setValue(defaultState(), 'layout.radius', 16);
		state = setValue(state, 'code.frameRadius', 4);
		const out = emitCss(state);
		const lastEcBrdRad = out.lastIndexOf('--ec-brdRad');
		assert.match(out.slice(lastEcBrdRad), /^--ec-brdRad: 4px;/);
	});
});
