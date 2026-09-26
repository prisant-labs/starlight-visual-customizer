import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { controls, GROUPS, FONTS } from '../../src/customizer/core/manifest.js';

describe('controls', () => {
	test('every control has a unique, dotted id', () => {
		const ids = controls.map((c) => c.id);
		assert.equal(new Set(ids).size, ids.length, 'duplicate control id found');
		for (const id of ids) assert.match(id, /^[a-z]+(\.[a-zA-Z]+)+$/, `id "${id}" is not dotted`);
	});

	test('every control belongs to a declared group', () => {
		for (const c of controls) assert.ok(GROUPS.includes(c.group), `unknown group "${c.group}" on ${c.id}`);
	});

	test('every control has a non-empty section and target', () => {
		// This module runs under plain `node --test` (no DOM), so it can only check the target
		// string's shape (non-empty, balanced brackets/parens/quotes - the usual way a hand-edited
		// selector goes wrong). Actually matching >=1 *visible* element on a live page is
		// tests/e2e/targets.mjs's job, run against the real browser DOM.
		for (const c of controls) {
			assert.equal(typeof c.section, 'string', `${c.id} missing section`);
			assert.ok(c.section.trim().length > 0, `${c.id} has an empty section`);
			assert.equal(typeof c.target, 'string', `${c.id} missing target`);
			assert.ok(c.target.trim().length > 0, `${c.id} has an empty target`);
			for (const [open, close] of [['(', ')'], ['[', ']']]) {
				const opens = c.target.split(open).length - 1;
				const closes = c.target.split(close).length - 1;
				assert.equal(opens, closes, `${c.id}'s target "${c.target}" has unbalanced ${open}${close}`);
			}
			assert.equal(
				(c.target.match(/'/g) || []).length % 2,
				0,
				`${c.id}'s target "${c.target}" has an unbalanced quote`
			);
		}
	});

	test('sections are contiguous within each group (row order is display order)', () => {
		/** @type {Map<string, string[]>} */
		const sectionsByGroup = new Map();
		for (const c of controls) {
			if (!sectionsByGroup.has(c.group)) sectionsByGroup.set(c.group, []);
			sectionsByGroup.get(c.group).push(c.section);
		}
		for (const [group, sections] of sectionsByGroup) {
			const seen = new Set();
			let last = null;
			for (const section of sections) {
				if (section !== last) {
					assert.ok(
						!seen.has(section),
						`group "${group}" has a non-contiguous section "${section}" (order: ${JSON.stringify(sections)})`
					);
					seen.add(section);
					last = section;
				}
			}
		}
	});

	test('every control is JSON-serializable (no functions, no cycles)', () => {
		const json = JSON.stringify(controls);
		assert.ok(json.length > 0);
		assert.deepEqual(JSON.parse(json), controls);
	});

	test('range controls declare min/max/step and default is within range', () => {
		for (const c of controls.filter((c) => c.type === 'range')) {
			assert.equal(typeof c.min, 'number', `${c.id} missing min`);
			assert.equal(typeof c.max, 'number', `${c.id} missing max`);
			assert.equal(typeof c.step, 'number', `${c.id} missing step`);
			assert.ok(c.default >= c.min && c.default <= c.max, `${c.id} default out of range`);
		}
	});

	test('select/font controls declare options including the default value', () => {
		for (const c of controls.filter((c) => c.type === 'select' || c.type === 'font')) {
			assert.ok(Array.isArray(c.options) && c.options.length > 0, `${c.id} missing options`);
			assert.ok(
				c.options.some((o) => o.value === c.default),
				`${c.id} default "${c.default}" is not one of its own options`
			);
		}
	});

	test('the fixed ids exist with the exact documented defaults', () => {
		const byId = new Map(controls.map((c) => [c.id, c]));
		const expected = {
			'page.toc.minLevel': 2,
			'page.toc.maxLevel': 3,
			'page.pagination': true,
			'page.lastUpdated': false,
			'page.headingLinks': true,
			'page.credits': false,
			'code.theme': 'starlight-default',
			'type.font.body': 'system',
			'type.font.heading': 'system',
			'type.font.mono': 'system',
		};
		for (const [id, defaultValue] of Object.entries(expected)) {
			assert.ok(byId.has(id), `fixed id "${id}" is missing from manifest.js`);
			assert.equal(byId.get(id).default, defaultValue, `fixed id "${id}" has the wrong default`);
		}
		assert.equal(byId.get('code.theme').group, 'Code');
		assert.equal(byId.get('page.toc.minLevel').tier, 'build');
		assert.equal(byId.get('code.theme').tier, 'build');
	});
});

describe('FONTS', () => {
	test('every entry has id/family/pkg/category and category is sans|serif|mono', () => {
		for (const f of FONTS) {
			assert.equal(typeof f.id, 'string');
			assert.equal(typeof f.family, 'string');
			assert.match(f.pkg, /^@fontsource-variable\//);
			assert.ok(['sans', 'serif', 'mono'].includes(f.category), `bad category for ${f.id}`);
		}
		assert.equal(new Set(FONTS.map((f) => f.id)).size, FONTS.length, 'duplicate FONTS id');
	});

	test('every FONTS package exists on the npm registry (npm view)', { timeout: 60_000 }, () => {
		for (const f of FONTS) {
			let name;
			try {
				name = execFileSync('npm', ['view', f.pkg, 'name'], { encoding: 'utf8', shell: true }).trim();
			} catch (err) {
				assert.fail(`npm view failed for ${f.pkg}: ${err.message}`);
			}
			assert.equal(name, f.pkg);
		}
	});

	test("every type:'font' control's options are exactly FONTS + 'system'", () => {
		const expectedValues = new Set(['system', ...FONTS.map((f) => f.id)]);
		for (const c of controls.filter((c) => c.type === 'font')) {
			const actual = new Set(c.options.map((o) => o.value));
			assert.deepEqual(actual, expectedValues, `${c.id} options do not match FONTS + system`);
		}
	});
});
