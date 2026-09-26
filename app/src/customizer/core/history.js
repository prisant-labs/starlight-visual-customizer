/**
 * @file A pure, DOM-free undo/redo stack over `ThemeState` snapshots. Works in Node
 * and the browser (`structuredClone` is a global in both, Node 22+).
 *
 * Contract: the caller records the state as it was BEFORE a change, tagged with a `key` that
 * identifies the kind of change. Two consecutive `record` calls with the same key inside
 * `coalesceMs` of each other coalesce into one undo step (a slider drag: many `input` events, one
 * key, one step). A preset apply / group reset / reset-all / import should each pass a `key`
 * that's distinct from any other in-flight coalescing key (e.g. a string unique to that action),
 * so they always land as their own step even if they happen to follow closely after something
 * else. Recording anything clears the redo stack, matching ordinary undo-stack semantics.
 */

/**
 * @param {{limit?: number, coalesceMs?: number}} [opts]
 * @returns {{
 *   record: (prevState: object, key: string, now?: number) => void,
 *   undo: (currentState: object) => object | null,
 *   redo: (currentState: object) => object | null,
 *   canUndo: () => boolean,
 *   canRedo: () => boolean,
 *   clear: () => void,
 * }}
 */
export function createHistory({ limit = 100, coalesceMs = 650 } = {}) {
	/** @type {{state: object, key: string, time: number}[]} Oldest first; the last entry is the state to restore on the next undo(). */
	let undoStack = [];
	/** @type {object[]} Oldest first; the last entry is the state to restore on the next redo(). */
	let redoStack = [];

	function clone(state) {
		return typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
	}

	/**
	 * @param {object} prevState The state as it was immediately before the change being recorded.
	 * @param {string} key Coalescing key - same key + within `coalesceMs` of the last record merges.
	 * @param {number} [now] Defaults to `Date.now()`; a caller-supplied clock makes this testable.
	 */
	function record(prevState, key, now = Date.now()) {
		const top = undoStack[undoStack.length - 1];
		if (top && top.key === key && now - top.time <= coalesceMs) {
			// Still the same in-flight gesture (e.g. mid-drag): keep the ORIGINAL prevState (the value
			// before the gesture started) as the undo target, just extend the coalescing window.
			top.time = now;
			return;
		}
		undoStack.push({ state: clone(prevState), key, time: now });
		if (undoStack.length > limit) undoStack.shift();
		redoStack = []; // a new step always invalidates whatever was available to redo
	}

	/**
	 * @param {object} currentState The live state, about to be replaced by the popped snapshot.
	 * @returns {object | null} The state to restore, or `null` if there is nothing to undo.
	 */
	function undo(currentState) {
		const entry = undoStack.pop();
		if (!entry) return null;
		redoStack.push(clone(currentState));
		if (redoStack.length > limit) redoStack.shift();
		return entry.state;
	}

	/**
	 * @param {object} currentState The live state, about to be replaced by the popped snapshot.
	 * @returns {object | null} The state to restore, or `null` if there is nothing to redo.
	 */
	function redo(currentState) {
		const state = redoStack.pop();
		if (state === undefined) return null;
		undoStack.push({ state: clone(currentState), key: '__redo__', time: Date.now() });
		if (undoStack.length > limit) undoStack.shift();
		return state;
	}

	function canUndo() {
		return undoStack.length > 0;
	}
	function canRedo() {
		return redoStack.length > 0;
	}
	function clear() {
		undoStack = [];
		redoStack = [];
	}

	return { record, undo, redo, canUndo, canRedo, clear };
}
