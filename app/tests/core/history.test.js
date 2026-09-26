import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createHistory } from '../../src/customizer/core/history.js';

describe('createHistory', () => {
	test('canUndo/canRedo start false', () => {
		const h = createHistory();
		assert.equal(h.canUndo(), false);
		assert.equal(h.canRedo(), false);
	});

	test('a single record makes undo available and restores the prior state', () => {
		const h = createHistory();
		h.record({ n: 0 }, 'a', 1000);
		assert.equal(h.canUndo(), true);
		const restored = h.undo({ n: 1 });
		assert.deepEqual(restored, { n: 0 });
		assert.equal(h.canRedo(), true);
	});

	test('undo with an empty stack returns null and does not throw', () => {
		const h = createHistory();
		assert.equal(h.undo({ n: 1 }), null);
	});

	test('redo with an empty stack returns null', () => {
		const h = createHistory();
		assert.equal(h.redo({ n: 1 }), null);
	});

	test('redo restores what undo just popped', () => {
		const h = createHistory();
		h.record({ n: 0 }, 'a', 1000);
		const undone = h.undo({ n: 1 });
		assert.deepEqual(undone, { n: 0 });
		const redone = h.redo({ n: 0 });
		assert.deepEqual(redone, { n: 1 });
	});

	test('consecutive records with the same key inside coalesceMs merge into one step (a slider drag)', () => {
		const h = createHistory({ coalesceMs: 650 });
		h.record({ n: 0 }, 'range:foo', 1000);
		h.record({ n: 1 }, 'range:foo', 1200); // 200ms later, same key: coalesces
		h.record({ n: 2 }, 'range:foo', 1500); // 300ms after that, still within window
		// Only one undo step exists; undoing restores the ORIGINAL prevState (n:0), not an
		// intermediate one - the whole drag is one step.
		const restored = h.undo({ n: 3 });
		assert.deepEqual(restored, { n: 0 });
		assert.equal(h.canUndo(), false);
	});

	test('records with the same key but more than coalesceMs apart are separate steps', () => {
		const h = createHistory({ coalesceMs: 650 });
		h.record({ n: 0 }, 'range:foo', 1000);
		h.record({ n: 1 }, 'range:foo', 2000); // 1000ms later: new step
		assert.deepEqual(h.undo({ n: 2 }), { n: 1 });
		assert.deepEqual(h.undo({ n: 1 }), { n: 0 });
		assert.equal(h.canUndo(), false);
	});

	test('records with different keys never coalesce even at the same timestamp', () => {
		const h = createHistory();
		h.record({ n: 0 }, 'preset:a', 1000);
		h.record({ n: 1 }, 'preset:b', 1000);
		assert.deepEqual(h.undo({ n: 2 }), { n: 1 });
		assert.deepEqual(h.undo({ n: 1 }), { n: 0 });
	});

	test('a new record clears the redo stack', () => {
		const h = createHistory();
		h.record({ n: 0 }, 'a', 1000);
		h.undo({ n: 1 });
		assert.equal(h.canRedo(), true);
		h.record({ n: 1 }, 'b', 2000);
		assert.equal(h.canRedo(), false);
	});

	test('preset apply / group reset / reset all / import each count as one step (distinct keys)', () => {
		const h = createHistory();
		h.record({ step: 0 }, 'preset:ocean', 1000);
		h.record({ step: 1 }, 'reset-group:Colors', 1001);
		h.record({ step: 2 }, 'reset-all', 1002);
		h.record({ step: 3 }, 'import', 1003);
		assert.deepEqual(h.undo({ step: 4 }), { step: 3 });
		assert.deepEqual(h.undo({ step: 3 }), { step: 2 });
		assert.deepEqual(h.undo({ step: 2 }), { step: 1 });
		assert.deepEqual(h.undo({ step: 1 }), { step: 0 });
		assert.equal(h.canUndo(), false);
	});

	test('snapshots are deep clones: mutating the caller-visible object afterward does not corrupt history', () => {
		const h = createHistory();
		const obj = { values: { a: 1 } };
		h.record(obj, 'a', 1000);
		obj.values.a = 999; // mutate after recording
		const restored = h.undo({ values: { a: 2 } });
		assert.equal(restored.values.a, 1, 'history must hold its own copy, unaffected by later mutation');
	});

	test('respects the limit option, dropping the oldest entries', () => {
		const h = createHistory({ limit: 2 });
		h.record({ n: 0 }, 'a', 1000);
		h.record({ n: 1 }, 'b', 2000);
		h.record({ n: 2 }, 'c', 3000);
		// Only 2 entries retained: the oldest (n:0) was dropped.
		assert.deepEqual(h.undo({ n: 3 }), { n: 2 });
		assert.deepEqual(h.undo({ n: 2 }), { n: 1 });
		assert.equal(h.canUndo(), false);
	});

	test('clear() empties both stacks', () => {
		const h = createHistory();
		h.record({ n: 0 }, 'a', 1000);
		h.undo({ n: 1 });
		h.clear();
		assert.equal(h.canUndo(), false);
		assert.equal(h.canRedo(), false);
	});

	test('default clock (no explicit now) still works', () => {
		const h = createHistory();
		h.record({ n: 0 }, 'a');
		assert.equal(h.canUndo(), true);
	});
});
