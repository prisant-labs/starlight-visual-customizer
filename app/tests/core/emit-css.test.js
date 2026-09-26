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

	test('default state in forPreview mode emits only the header plus the credits hide (its default is off)', () => {
		// page.pagination and page.headingLinks default to true (nothing to hide); page.credits
		// defaults to false, and preview approximations are value-based (see emit-css.js header),
		// so the credits hide fires even though nothing was "changed" from default.
		const out = emitCss(defaultState(), { forPreview: true });
		assert.equal(out.includes(':root {'), false);
		assert.equal(out.includes('.pagination-links'), false);
		assert.equal(out.includes('.sl-anchor-link'), false);
		assert.match(out, /footer \.kudos\s*\{\s*display: none;/);
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

describe('golden files', () => {
	test('default state matches tests/golden/default.css byte-for-byte', () => {
		assert.equal(emitCss(defaultState()), readGolden('default.css'));
	});

	test('the "ocean" palette preset matches tests/golden/ocean.css byte-for-byte', () => {
		assert.equal(emitCss(applyPreset(defaultState(), 'ocean')), readGolden('ocean.css'));
	});

	test('the "dense-technical" character preset matches tests/golden/dense-technical.css byte-for-byte', () => {
		assert.equal(emitCss(applyPreset(defaultState(), 'dense-technical')), readGolden('dense-technical.css'));
	});
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

	test('credits off (the manifest default) hides footer .kudos even with no other changes', () => {
		const out = emitCss(defaultState(), { forPreview: true });
		assert.match(out, /footer \.kudos\s*\{\s*display: none;/);
	});

	test('non-preview output never includes the build-time approximation CSS', () => {
		const state = setValue(defaultState(), 'page.pagination', false);
		const out = emitCss(state, { forPreview: false });
		assert.equal(out.includes('.pagination-links'), false);
	});

	test('excluding a TOC level hides its <li> contents via display:contents + hidden <a>, not display:none on the <li>', () => {
		let state = setValue(defaultState(), 'page.toc.minLevel', 3);
		state = setValue(state, 'page.toc.maxLevel', 3);
		const out = emitCss(state, { forPreview: true });
		assert.match(out, /li\[data-svc-level='2'\][\s\S]*?display: contents;/);
		assert.match(out, /li\[data-svc-level='2'\] > a[\s\S]*?display: none;/);
		// The excluded level's container must NOT be display:none (that would also hide nested,
		// in-range descendants).
		assert.doesNotMatch(out, /li\[data-svc-level='2'\]\s*\{\s*display: none;/);
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
