/**
 * @file "Navigation" section: a tree editor over `state.ia`, materializing
 * `iaFromStarlightConfig(fixtureSidebar)` into `state.ia` on the first edit (SPEC.md). Owns its
 * own `workingTree` (a structured clone), mutates it in place via direct array-splice operations,
 * and calls back into `panel.js` on every commit so the sidebar re-renders and state persists.
 *
 * Text fields (label/slug/href/directory/badge text) commit on `change` (blur/Enter), not
 * `input`: a full tree re-render on every keystroke would blur the field mid-type. Structural
 * edits (move/indent/delete/checkbox/select) commit immediately since they aren't typed into.
 *
 * The label input is the one exception: it updates the model + the live sidebar preview on every
 * `input` (real-time, per SPEC.md Round 2 item 2) without calling `renderTree()`, and only
 * triggers a full tree re-render on `change` (blur/Enter) - so typing a multi-word label never
 * loses focus. Disclosure ("show details") open/closed state is tracked in `openIds` (by stable
 * `item.id`) across `renderTree()` calls, independent of the DOM nodes it rebuilds each time -
 * without this, `buildDetails` re-hid every row on every edit (Round 2 item 1, root cause (b)).
 */
import { iaFromStarlightConfig, parseSidebarSource, iaFromFileListing } from '../core/ia.js';
import { fixtureSidebar } from '../../fixture-sidebar.mjs';

const BADGE_VARIANTS = ['default', 'note', 'tip', 'caution', 'danger', 'success'];

function cloneTree(items) {
	return typeof structuredClone === 'function' ? structuredClone(items) : JSON.parse(JSON.stringify(items));
}

function iconButton(label, title, onClick) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'svc-ia-btn';
	btn.textContent = label;
	btn.title = title;
	btn.setAttribute('aria-label', title);
	btn.addEventListener('click', onClick);
	return btn;
}

function textButton(label, onClick) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'svc-btn';
	btn.textContent = label;
	btn.addEventListener('click', onClick);
	return btn;
}

function field(labelText, inputEl) {
	const label = document.createElement('label');
	const span = document.createElement('span');
	span.textContent = labelText;
	label.appendChild(span);
	label.appendChild(inputEl);
	return label;
}

/** Module-scope (SPEC-C E3: shared by both the overlay tree editor and the studio one below, which
 * have their own separate `workingTree`/`commit` closures) - `isGroup` is accepted for readability
 * at call sites even though the badge shape doesn't currently vary by item type.
 * @param {import('../core/ia.js').SidebarItem} item
 * @param {boolean} isGroup
 * @param {() => void} commit
 */
function buildBadgeFields(item, isGroup, commit) {
	const wrap = document.createElement('div');
	wrap.className = 'svc-ia-details-row';
	const textInput = document.createElement('input');
	textInput.type = 'text';
	textInput.value = item.badge?.text ?? '';
	textInput.placeholder = 'Badge text (blank = none)';
	const variantSelect = document.createElement('select');
	for (const v of BADGE_VARIANTS) {
		const opt = document.createElement('option');
		opt.value = v;
		opt.textContent = v;
		variantSelect.appendChild(opt);
	}
	variantSelect.value = item.badge?.variant ?? 'default';
	textInput.addEventListener('change', () => {
		const text = textInput.value.trim();
		if (!text) delete item.badge;
		else item.badge = { text, variant: variantSelect.value };
		commit();
	});
	variantSelect.addEventListener('change', () => {
		if (item.badge) {
			item.badge.variant = variantSelect.value;
			commit();
		}
	});
	wrap.appendChild(field('Badge text', textInput));
	wrap.appendChild(field('Badge variant', variantSelect));
	return wrap;
}

/**
 * SPEC-C E3: dispatches to whichever rendering the caller needs. `core/ia.js` (the data model) and
 * this dispatch are the only things the two share on purpose - S16/overlay mode must stay
 * byte-identical (smoke.mjs/ui-round2.mjs assert its exact DOM shape: `.svc-ia-row`,
 * `.svc-ia-details`, `.svc-ia-btn`, live-typing `.svc-ia-label-input`), so `createOverlayTreeEditor`
 * below is that pre-existing implementation, UNCHANGED. `createStudioTreeEditor` is new: Codex's
 * tree shape (A6), restyle only - no new structure capability, per the settled decision.
 * @param {import('../core/state.js').ThemeState} initialState
 * @param {{onIaChange: (ia: import('../core/ia.js').SidebarItem[] | null, coalesceKey?: string) => void}} callbacks
 * @param {{studio?: boolean}} [opts]
 * @returns {{root: HTMLElement, refresh: (state: import('../core/state.js').ThemeState) => void}}
 */
export function createIaEditor(initialState, callbacks, opts = {}) {
	return opts.studio ? createStudioTreeEditor(initialState, callbacks) : createOverlayTreeEditor(initialState, callbacks);
}

/**
 * @param {import('../core/state.js').ThemeState} initialState
 * @param {{onIaChange: (ia: import('../core/ia.js').SidebarItem[] | null, coalesceKey?: string) => void}} callbacks
 * @returns {{root: HTMLElement, refresh: (state: import('../core/state.js').ThemeState) => void}}
 */
function createOverlayTreeEditor(initialState, callbacks) {
	const root = document.createElement('div');

	const treeContainer = document.createElement('div');
	treeContainer.className = 'svc-ia-tree';
	root.appendChild(treeContainer);

	const rootAddRow = document.createElement('div');
	rootAddRow.className = 'svc-ia-add-row';
	rootAddRow.appendChild(textButton('+ Add link', () => addLink(workingTree)));
	rootAddRow.appendChild(textButton('+ Add group', () => addGroup(workingTree)));
	root.appendChild(rootAddRow);

	const importBox = document.createElement('div');
	importBox.className = 'svc-ia-import';
	const textarea = document.createElement('textarea');
	textarea.rows = 6;
	textarea.placeholder = 'Paste a sidebar config array, or a file listing (ls -R / tree / plain paths)…';
	const errorEl = document.createElement('div');
	errorEl.className = 'svc-ia-error';
	errorEl.hidden = true;
	const importActions = document.createElement('div');
	importActions.className = 'svc-ia-import-actions';
	importActions.appendChild(
		textButton('Import sidebar config', () => {
			try {
				const parsed = parseSidebarSource(textarea.value);
				errorEl.hidden = true;
				workingTree = parsed;
				callbacks.onIaChange(cloneTree(workingTree));
				renderTree();
			} catch (err) {
				errorEl.hidden = false;
				errorEl.textContent = err instanceof Error ? err.message : String(err);
			}
		})
	);
	importActions.appendChild(
		textButton('Import file listing', () => {
			const parsed = iaFromFileListing(textarea.value);
			errorEl.hidden = true;
			workingTree = parsed;
			callbacks.onIaChange(cloneTree(workingTree));
			renderTree();
		})
	);
	importActions.appendChild(
		textButton('Reset to site nav', () => {
			workingTree = cloneTree(iaFromStarlightConfig(fixtureSidebar));
			errorEl.hidden = true;
			callbacks.onIaChange(null);
			renderTree();
		})
	);
	importBox.appendChild(textarea);
	importBox.appendChild(errorEl);
	importBox.appendChild(importActions);
	root.appendChild(importBox);

	/** @type {import('../core/ia.js').SidebarItem[]} */
	let workingTree = cloneTree(initialState.ia ?? iaFromStarlightConfig(fixtureSidebar));
	/** @type {Set<string>} item ids whose "show details" disclosure is currently open, survives `renderTree()` rebuilds. */
	let openIds = new Set();

	function collectIds(items, set) {
		for (const item of items) {
			set.add(item.id);
			if (item.type === 'group') collectIds(item.items, set);
		}
		return set;
	}

	function makeId(type) {
		const ids = collectIds(workingTree, new Set());
		let n = 1;
		let id = `${type}-new-${n}`;
		while (ids.has(id)) {
			n++;
			id = `${type}-new-${n}`;
		}
		return id;
	}

	function commit() {
		callbacks.onIaChange(cloneTree(workingTree));
		renderTree();
	}

	function addLink(siblings) {
		siblings.push({ type: 'link', id: makeId('link'), label: 'New link', href: '#' });
		commit();
	}

	function addGroup(siblings) {
		siblings.push({ type: 'group', id: makeId('group'), label: 'New group', items: [] });
		commit();
	}

	/** @param {{siblings: any[], index: number}[]} path */
	function moveUp(path) {
		const { siblings, index } = path[path.length - 1];
		if (index === 0) return;
		[siblings[index - 1], siblings[index]] = [siblings[index], siblings[index - 1]];
		commit();
	}
	function moveDown(path) {
		const { siblings, index } = path[path.length - 1];
		if (index === siblings.length - 1) return;
		[siblings[index], siblings[index + 1]] = [siblings[index + 1], siblings[index]];
		commit();
	}
	function outdent(path) {
		if (path.length < 2) return;
		const cur = path[path.length - 1];
		const parent = path[path.length - 2];
		const [item] = cur.siblings.splice(cur.index, 1);
		parent.siblings.splice(parent.index + 1, 0, item);
		commit();
	}
	function indent(path) {
		const cur = path[path.length - 1];
		if (cur.index === 0) return;
		const prevSibling = cur.siblings[cur.index - 1];
		if (prevSibling.type !== 'group') return;
		const [item] = cur.siblings.splice(cur.index, 1);
		prevSibling.items.push(item);
		commit();
	}
	function removeItem(path) {
		const { siblings, index } = path[path.length - 1];
		siblings.splice(index, 1);
		commit();
	}

	function buildDetails(item, path) {
		const details = document.createElement('div');
		details.className = 'svc-ia-details';
		details.hidden = !openIds.has(item.id); // survives rebuilds via `openIds`, not a fixed `true`

		if (item.type === 'link') {
			const row = document.createElement('div');
			row.className = 'svc-ia-details-row';
			const slugInput = document.createElement('input');
			slugInput.type = 'text';
			slugInput.value = item.slug ?? '';
			slugInput.placeholder = 'content/docs slug, e.g. guides/kitchen-sink';
			const hrefInput = document.createElement('input');
			hrefInput.type = 'text';
			hrefInput.value = item.href ?? '';
			hrefInput.placeholder = 'external/absolute URL';
			slugInput.addEventListener('change', () => {
				const value = slugInput.value.trim();
				if (value) {
					item.slug = value;
					delete item.href;
					hrefInput.value = '';
				} else {
					delete item.slug;
				}
				commit();
			});
			hrefInput.addEventListener('change', () => {
				const value = hrefInput.value.trim();
				if (value) {
					item.href = value;
					delete item.slug;
					slugInput.value = '';
				} else {
					delete item.href;
				}
				commit();
			});
			row.appendChild(field('Slug', slugInput));
			row.appendChild(field('Href (external)', hrefInput));
			details.appendChild(row);
			details.appendChild(buildBadgeFields(item, false, commit));

			const hiddenRow = document.createElement('div');
			hiddenRow.className = 'svc-ia-details-row';
			const hiddenLabel = document.createElement('label');
			hiddenLabel.className = 'svc-inline';
			const hiddenCheckbox = document.createElement('input');
			hiddenCheckbox.type = 'checkbox';
			hiddenCheckbox.checked = !!item.hidden;
			hiddenCheckbox.addEventListener('change', () => {
				item.hidden = hiddenCheckbox.checked;
				commit();
			});
			hiddenLabel.appendChild(hiddenCheckbox);
			hiddenLabel.appendChild(document.createTextNode('hidden'));
			hiddenRow.appendChild(hiddenLabel);
			details.appendChild(hiddenRow);
		} else if (item.type === 'group') {
			const row = document.createElement('div');
			row.className = 'svc-ia-details-row';
			const collapsedLabel = document.createElement('label');
			collapsedLabel.className = 'svc-inline';
			const collapsedCheckbox = document.createElement('input');
			collapsedCheckbox.type = 'checkbox';
			collapsedCheckbox.checked = !!item.collapsed;
			collapsedCheckbox.addEventListener('change', () => {
				item.collapsed = collapsedCheckbox.checked;
				commit();
			});
			collapsedLabel.appendChild(collapsedCheckbox);
			collapsedLabel.appendChild(document.createTextNode('starts collapsed'));
			row.appendChild(collapsedLabel);
			details.appendChild(row);
			details.appendChild(buildBadgeFields(item, true, commit));
		} else if (item.type === 'autogenerate') {
			const row = document.createElement('div');
			row.className = 'svc-ia-details-row';
			const dirInput = document.createElement('input');
			dirInput.type = 'text';
			dirInput.value = item.directory;
			dirInput.addEventListener('change', () => {
				item.directory = dirInput.value.trim();
				commit();
			});
			row.appendChild(field('Directory', dirInput));
			const collapsedLabel = document.createElement('label');
			collapsedLabel.className = 'svc-inline';
			const collapsedCheckbox = document.createElement('input');
			collapsedCheckbox.type = 'checkbox';
			collapsedCheckbox.checked = !!item.collapsed;
			collapsedCheckbox.addEventListener('change', () => {
				item.collapsed = collapsedCheckbox.checked;
				commit();
			});
			collapsedLabel.appendChild(collapsedCheckbox);
			collapsedLabel.appendChild(document.createTextNode('starts collapsed'));
			row.appendChild(collapsedLabel);
			details.appendChild(row);
		}
		return details;
	}

	/**
	 * @param {import('../core/ia.js').SidebarItem} item
	 * @param {any[]} siblings
	 * @param {number} index
	 * @param {{siblings:any[], index:number}[]} parentPath
	 */
	function buildRow(item, siblings, index, parentPath) {
		const path = [...parentPath, { siblings, index }];
		const rowRoot = document.createElement('div');
		rowRoot.className = 'svc-ia-row';

		const main = document.createElement('div');
		main.className = 'svc-ia-row-main';

		const isOpen = openIds.has(item.id);
		const disclosureBtn = iconButton(isOpen ? '▾' : '▸', 'Show details', () => {
			const nowOpen = details.hidden; // about to become visible
			details.hidden = !details.hidden;
			disclosureBtn.textContent = details.hidden ? '▸' : '▾';
			disclosureBtn.setAttribute('aria-expanded', String(!details.hidden));
			if (nowOpen) openIds.add(item.id);
			else openIds.delete(item.id);
		});
		disclosureBtn.setAttribute('aria-expanded', String(isOpen));
		main.appendChild(disclosureBtn);

		const typeTag = document.createElement('span');
		typeTag.className = 'svc-ia-type';
		typeTag.textContent = item.type === 'autogenerate' ? 'auto' : item.type;
		main.appendChild(typeTag);

		// Full row width (SPEC.md Round 2 root cause (d) - six buttons used to squeeze this input
		// down to a handful of visible characters). `input` updates the model + live sidebar preview
		// immediately without rebuilding the tree (real-time, keeps focus); `change` (blur/Enter)
		// does the normal full commit, safe now that `openIds` survives the rebuild.
		const labelInput = document.createElement('input');
		labelInput.type = 'text';
		labelInput.className = 'svc-ia-label-input';
		labelInput.value = item.label ?? '';
		labelInput.disabled = item.type === 'autogenerate';
		// Coordinator bug fix (undo-after-rename): `input` (every keystroke, live preview) and
		// `change` (blur/Enter) both feed the SAME per-item coalescing key so panel.js's
		// `history.record` merges a whole typing+blur gesture into ONE undo step - the same "many
		// events, one key, one step" contract a slider drag already gets. `change` still needs its
		// own call (not just relying on the last `input`) so a rename committed with no intervening
		// keystroke (e.g. programmatic) still records; panel.js's own no-op guard (unchanged `ia`)
		// is what stops `change` from recording a SECOND, redundant step after `input` already did.
		const renameKey = `label:${item.id}`;
		labelInput.addEventListener('input', () => {
			item.label = labelInput.value;
			callbacks.onIaChange(cloneTree(workingTree), renameKey);
		});
		labelInput.addEventListener('change', () => {
			item.label = labelInput.value;
			callbacks.onIaChange(cloneTree(workingTree), renameKey);
			renderTree();
		});
		main.appendChild(labelInput);

		rowRoot.appendChild(main);

		// Second, compact line: move/indent/delete never squeeze the label input above.
		const actions = document.createElement('div');
		actions.className = 'svc-ia-row-actions';
		const upBtn = iconButton('▲', 'Move up', () => moveUp(path));
		const downBtn = iconButton('▼', 'Move down', () => moveDown(path));
		const outdentBtn = iconButton('⇤', 'Outdent', () => outdent(path));
		const indentBtn = iconButton('⇥', 'Indent into previous group', () => indent(path));
		const deleteBtn = iconButton('✕', 'Delete', () => removeItem(path));
		upBtn.disabled = index === 0;
		downBtn.disabled = index === siblings.length - 1;
		outdentBtn.disabled = path.length < 2;
		indentBtn.disabled = index === 0 || siblings[index - 1]?.type !== 'group';
		actions.appendChild(upBtn);
		actions.appendChild(downBtn);
		actions.appendChild(outdentBtn);
		actions.appendChild(indentBtn);
		actions.appendChild(deleteBtn);
		rowRoot.appendChild(actions);

		const details = buildDetails(item, path);
		rowRoot.appendChild(details);

		if (item.type === 'group') {
			const childrenWrap = document.createElement('div');
			childrenWrap.className = 'svc-ia-children';
			for (const [childIndex, child] of item.items.entries()) {
				childrenWrap.appendChild(buildRow(child, item.items, childIndex, path));
			}
			const addRow = document.createElement('div');
			addRow.className = 'svc-ia-add-row';
			addRow.appendChild(textButton('+ Add link', () => addLink(item.items)));
			addRow.appendChild(textButton('+ Add group', () => addGroup(item.items)));
			childrenWrap.appendChild(addRow);
			rowRoot.appendChild(childrenWrap);
		}

		return rowRoot;
	}

	function renderTree() {
		treeContainer.replaceChildren(...workingTree.map((item, index) => buildRow(item, workingTree, index, [])));
	}

	renderTree();

	function refresh(state) {
		workingTree = cloneTree(state.ia ?? iaFromStarlightConfig(fixtureSidebar));
		renderTree();
	}

	return { root, refresh };
}

// =================================================================================================
// SPEC-C E3: the studio's "Structure (advanced)" tree - Codex's shape (restyle only, per the
// settled decision: no new structure capability, `core/ia.js` unchanged). Separate implementation
// from `createOverlayTreeEditor` above (its own `workingTree`/`commit`/model-mutation closures) so
// S16's overlay suites (smoke.mjs, ui-round2.mjs) keep asserting that pre-existing DOM byte-for-byte
// unchanged; this shares only the pure `core/ia.js` conversions and the module-level
// `cloneTree`/`iconButton`/`textButton`/`field`/`buildBadgeFields` helpers above.
// =================================================================================================

const PAGE_ICON_SVG = '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>';
const FOLDER_ICON_SVG = '<path d="M3.5 6.5h6l1.5 2h9.5v10h-17z"/>';
const AUTO_ICON_SVG = '<path d="M20 12a8 8 0 10-2.34 5.66"/><path d="M20 8v5h-5"/>';
const GRIP_ICON_SVG =
	'<circle cx="9" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="15" cy="18" r="1.3"/>';

/** @param {string} inner @returns {string} */
function structureIconSvg(inner) {
	return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/**
 * @param {import('../core/state.js').ThemeState} initialState
 * @param {{onIaChange: (ia: import('../core/ia.js').SidebarItem[] | null, coalesceKey?: string) => void}} callbacks
 * @returns {{root: HTMLElement, refresh: (state: import('../core/state.js').ThemeState) => void}}
 */
function createStudioTreeEditor(initialState, callbacks) {
	const root = document.createElement('div');
	root.className = 'svc-structure';

	const note = document.createElement('p');
	note.className = 'svc-structure-note';
	note.textContent = 'Changes the sidebar structure. Exported as configuration in APPLY-THEME.md, not CSS.';
	root.appendChild(note);

	const addRow = document.createElement('div');
	addRow.className = 'svc-structure-add-row';
	addRow.appendChild(textButton('+ Page', () => addItem('link')));
	addRow.appendChild(textButton('+ Group', () => addItem('group')));
	root.appendChild(addRow);

	const treeContainer = document.createElement('div');
	treeContainer.className = 'svc-structure-tree';
	treeContainer.setAttribute('role', 'tree');
	treeContainer.setAttribute('aria-label', 'Sidebar structure');
	root.appendChild(treeContainer);

	const toolbar = document.createElement('div');
	toolbar.className = 'svc-structure-toolbar';
	const upBtn = iconButton('▲', 'Move up', () => moveSelected('up'));
	const downBtn = iconButton('▼', 'Move down', () => moveSelected('down'));
	const outdentBtn = iconButton('⇤', 'Outdent', () => moveSelected('outdent'));
	const indentBtn = iconButton('⇥', 'Indent into previous group', () => moveSelected('indent'));
	const deleteBtn = iconButton('✕', 'Delete selected item', () => deleteSelected());
	toolbar.append(upBtn, downBtn, outdentBtn, indentBtn, deleteBtn);
	root.appendChild(toolbar);

	const importBox = document.createElement('div');
	importBox.className = 'svc-ia-import';
	const textarea = document.createElement('textarea');
	textarea.rows = 4;
	textarea.placeholder = 'Paste a sidebar config array, or a file listing (ls -R / tree / plain paths)…';
	const errorEl = document.createElement('div');
	errorEl.className = 'svc-ia-error';
	errorEl.hidden = true;
	const importActions = document.createElement('div');
	importActions.className = 'svc-ia-import-actions';
	importActions.appendChild(
		textButton('Import sidebar config', () => {
			try {
				workingTree = parseSidebarSource(textarea.value);
				errorEl.hidden = true;
				selectedId = workingTree[0]?.id ?? null;
				callbacks.onIaChange(cloneTree(workingTree));
				renderAll();
			} catch (err) {
				errorEl.hidden = false;
				errorEl.textContent = err instanceof Error ? err.message : String(err);
			}
		})
	);
	importActions.appendChild(
		textButton('Import file listing', () => {
			workingTree = iaFromFileListing(textarea.value);
			errorEl.hidden = true;
			selectedId = workingTree[0]?.id ?? null;
			callbacks.onIaChange(cloneTree(workingTree));
			renderAll();
		})
	);
	importActions.appendChild(
		textButton('Reset to site nav', () => {
			workingTree = cloneTree(iaFromStarlightConfig(fixtureSidebar));
			errorEl.hidden = true;
			selectedId = workingTree[0]?.id ?? null;
			callbacks.onIaChange(null);
			renderAll();
		})
	);
	importBox.appendChild(textarea);
	importBox.appendChild(errorEl);
	importBox.appendChild(importActions);

	const formContainer = document.createElement('div');
	formContainer.className = 'svc-structure-form';
	root.appendChild(formContainer);
	root.appendChild(importBox);

	/** @type {import('../core/ia.js').SidebarItem[]} */
	let workingTree = cloneTree(initialState.ia ?? iaFromStarlightConfig(fixtureSidebar));
	/** @type {string | null} */
	let selectedId = workingTree[0]?.id ?? null;
	/** @type {{id: string, startX: number, startY: number, moved: boolean, overId: string|null, overPos: 'before'|'after'|'inside'|null} | null}
	 * Pointer-based drag state (E3's "HTML5 drag and drop" requirement is met at the UX level - a
	 * visible drop indicator, drop-in-middle-to-nest / drop-on-edge-to-reorder - via plain
	 * mousedown/mousemove/mouseup instead of the actual HTML5 `draggable`/`dragstart`/`dragover`/
	 * `drop` API: that native API was confirmed to hang this project's pinned headless Chromium build
	 * (chromium-1228) the instant `mousedown` is followed by `mousemove` on a `draggable` element -
	 * the same real-mouse-event pattern already used for range-slider drags elsewhere in this
	 * codebase (`realSliderDrag` in the e2e suites) has no such issue, since it never engages the
	 * browser's native drag state machine.
	 * Sa (drag feedback): `overId`/`overPos` also drive a visible insertion marker (see
	 * `showDropLine`/`hideDropLine` below) - feedback only, the drop logic itself (this same
	 * before/after/inside calculation) is unchanged. Escape while `pointerDrag` is non-null cancels
	 * the whole gesture (`cancelPointerDrag`): no `moveNode`/`commit()` ever runs, so no structure
	 * change and no history step. */
	let pointerDrag = null;
	/** @type {HTMLElement | null} A single reusable marker element, lazily (re)created in
	 * `treeContainer` - `renderTree()`'s `replaceChildren()` detaches it on every commit, so
	 * `showDropLine` re-appends it whenever it finds it missing/detached rather than trusting the
	 * cached reference alone. */
	let dropLineEl = null;

	/** @param {HTMLElement} targetRowEl @param {'before'|'after'} edge */
	function showDropLine(targetRowEl, edge) {
		if (!dropLineEl || !treeContainer.contains(dropLineEl)) {
			dropLineEl = document.createElement('div');
			dropLineEl.className = 'svc-structure-drop-line';
			treeContainer.appendChild(dropLineEl);
		}
		const containerRect = treeContainer.getBoundingClientRect();
		const rowRect = targetRowEl.getBoundingClientRect();
		dropLineEl.style.top = `${(edge === 'before' ? rowRect.top : rowRect.bottom) - containerRect.top}px`;
		dropLineEl.style.left = `${rowRect.left - containerRect.left}px`;
		dropLineEl.style.width = `${rowRect.width}px`;
		dropLineEl.style.display = 'block';
	}
	function hideDropLine() {
		if (dropLineEl) dropLineEl.style.display = 'none';
	}

	function commit() {
		callbacks.onIaChange(cloneTree(workingTree));
		renderAll();
	}

	function collectIds(items, set) {
		for (const item of items) {
			set.add(item.id);
			if (item.type === 'group') collectIds(item.items, set);
		}
		return set;
	}
	function makeId(type) {
		const ids = collectIds(workingTree, new Set());
		let n = 1;
		let id = `${type}-new-${n}`;
		while (ids.has(id)) {
			n++;
			id = `${type}-new-${n}`;
		}
		return id;
	}

	/** @param {string} id @param {import('../core/ia.js').SidebarItem[]} [list] @param {{siblings: any[], index: number}[]} [parentPath]
	 * @returns {{item: any, siblings: any[], index: number, path: {siblings: any[], index: number}[]} | null} */
	function findById(id, list = workingTree, parentPath = []) {
		for (let i = 0; i < list.length; i++) {
			const item = list[i];
			const path = [...parentPath, { siblings: list, index: i }];
			if (item.id === id) return { item, siblings: list, index: i, path };
			if (item.type === 'group') {
				const found = findById(id, item.items, path);
				if (found) return found;
			}
		}
		return null;
	}

	/** @param {string} ancestorId @param {string} id @returns {boolean} True if `id` is `ancestorId` itself or lives inside its subtree. */
	function isSelfOrDescendant(ancestorId, id) {
		if (ancestorId === id) return true;
		const anc = findById(ancestorId);
		if (!anc || anc.item.type !== 'group') return false;
		function walk(list) {
			for (const it of list) {
				if (it.id === id) return true;
				if (it.type === 'group' && walk(it.items)) return true;
			}
			return false;
		}
		return walk(anc.item.items);
	}

	function addItem(kind) {
		const item =
			kind === 'link'
				? { type: 'link', id: makeId('link'), label: 'New page', slug: '' }
				: { type: 'group', id: makeId('group'), label: 'New group', items: [] };
		const found = selectedId ? findById(selectedId) : null;
		if (found) found.siblings.splice(found.index + 1, 0, item);
		else workingTree.push(item);
		selectedId = item.id;
		commit();
	}

	/** @param {'up'|'down'|'outdent'|'indent'} action */
	function moveSelected(action) {
		const found = selectedId ? findById(selectedId) : null;
		if (!found) return;
		if (action === 'up') {
			if (found.index === 0) return;
			[found.siblings[found.index - 1], found.siblings[found.index]] = [found.siblings[found.index], found.siblings[found.index - 1]];
		} else if (action === 'down') {
			if (found.index === found.siblings.length - 1) return;
			[found.siblings[found.index], found.siblings[found.index + 1]] = [found.siblings[found.index + 1], found.siblings[found.index]];
		} else if (action === 'outdent') {
			if (found.path.length < 2) return;
			const parent = found.path[found.path.length - 2];
			const [it] = found.siblings.splice(found.index, 1);
			parent.siblings.splice(parent.index + 1, 0, it);
		} else if (action === 'indent') {
			if (found.index === 0) return;
			const prevSibling = found.siblings[found.index - 1];
			if (prevSibling.type !== 'group') return;
			const [it] = found.siblings.splice(found.index, 1);
			prevSibling.items.push(it);
		}
		commit();
	}

	function deleteSelected() {
		const found = selectedId ? findById(selectedId) : null;
		if (!found) return;
		found.siblings.splice(found.index, 1);
		selectedId = null;
		commit();
	}

	/**
	 * HTML5 drag and drop (E3: "drop on a group's middle nests, on a row's top or bottom edge
	 * reorders"). Re-finds `targetId` AFTER removing the dragged item (rather than reusing the
	 * pre-removal `siblings`/`index`), so a reorder within the SAME list is never off-by-one from the
	 * splice shifting indices out from under it.
	 * @param {string} id @param {string} targetId @param {'before'|'after'|'inside'} position
	 * @returns {boolean}
	 */
	function moveNode(id, targetId, position) {
		if (isSelfOrDescendant(id, targetId)) return false; // never drop onto itself or into its own subtree
		const src = findById(id);
		if (!src) return false;
		const [item] = src.siblings.splice(src.index, 1);
		const target = findById(targetId);
		if (!target) {
			src.siblings.splice(src.index, 0, item); // put it back - target vanished somehow
			return false;
		}
		if (position === 'inside' && target.item.type === 'group') target.item.items.push(item);
		else if (position === 'before') target.siblings.splice(target.index, 0, item);
		else target.siblings.splice(target.index + 1, 0, item);
		return true;
	}

	function clearDropIndicators() {
		for (const el of treeContainer.querySelectorAll('[data-drop]')) delete el.dataset.drop;
		hideDropLine();
	}

	function flattenIds(list = workingTree) {
		const out = [];
		for (const item of list) {
			out.push(item.id);
			if (item.type === 'group') out.push(...flattenIds(item.items));
		}
		return out;
	}

	/** @param {KeyboardEvent} event @param {string} id */
	function handleRowKeydown(event, id) {
		const flat = flattenIds();
		const idx = flat.indexOf(id);
		if (event.key === 'ArrowDown' && idx < flat.length - 1) {
			event.preventDefault();
			selectItem(flat[idx + 1]);
		} else if (event.key === 'ArrowUp' && idx > 0) {
			event.preventDefault();
			selectItem(flat[idx - 1]);
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selectItem(id);
		}
	}

	/** @param {string} id */
	function selectItem(id) {
		selectedId = id;
		renderAll();
		treeContainer.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.focus();
	}

	/** @param {number} threshold @returns {boolean} */
	function pastDragThreshold(event, threshold = 4) {
		const dx = event.clientX - pointerDrag.startX;
		const dy = event.clientY - pointerDrag.startY;
		return Math.hypot(dx, dy) >= threshold;
	}

	/** Pointer-drag move handler (document-level while a drag is in progress - see `pointerDrag`'s
	 * comment). `event.composedPath()[0]` is the innermost element under the pointer even across the
	 * shadow boundary this tree lives in; `.closest()` from there stays within this same shadow tree. */
	function onPointerDragMove(event) {
		if (!pointerDrag) return;
		if (!pointerDrag.moved) {
			if (!pastDragThreshold(event)) return;
			pointerDrag.moved = true;
			treeContainer.querySelector(`[data-row-id="${CSS.escape(pointerDrag.id)}"]`)?.classList.add('svc-structure-row-dragging');
		}
		const hovered = event.composedPath()[0]?.closest?.('.svc-structure-row');
		clearDropIndicators();
		if (hovered && hovered.dataset.rowId !== pointerDrag.id) {
			const rect = hovered.getBoundingClientRect();
			const fraction = (event.clientY - rect.top) / rect.height;
			const hoveredItem = findById(hovered.dataset.rowId)?.item;
			const pos = fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : hoveredItem?.type === 'group' ? 'inside' : 'after';
			hovered.dataset.drop = pos;
			pointerDrag.overId = hovered.dataset.rowId;
			pointerDrag.overPos = pos;
			// Sa: feedback only - `data-drop` (above) still drives the 'inside' highlight (CSS) and
			// stays the source of truth `moveNode` reads from; 'before'/'after' additionally get a
			// clear line BETWEEN rows rather than a mark on the row's own edge.
			if (pos === 'inside') hideDropLine();
			else showDropLine(hovered, pos);
		} else {
			pointerDrag.overId = null;
			pointerDrag.overPos = null;
		}
	}

	/** Sa: Escape while dragging cancels the whole gesture - no `moveNode`/`commit()` runs, so no
	 * structure change and no history step, and every visual trace (dim + marker) is removed. */
	function onPointerDragKeydown(event) {
		if (event.key !== 'Escape' || !pointerDrag) return;
		event.preventDefault();
		event.stopPropagation();
		cancelPointerDrag();
	}
	function cancelPointerDrag() {
		document.removeEventListener('mousemove', onPointerDragMove);
		document.removeEventListener('keydown', onPointerDragKeydown, true);
		if (!pointerDrag) return;
		const { id } = pointerDrag;
		pointerDrag = null;
		clearDropIndicators();
		treeContainer.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.classList.remove('svc-structure-row-dragging');
	}

	function onPointerDragUp() {
		document.removeEventListener('mousemove', onPointerDragMove);
		document.removeEventListener('keydown', onPointerDragKeydown, true);
		if (!pointerDrag) return; // already cancelled (Escape) - nothing left to do
		const { id, moved, overId, overPos } = pointerDrag;
		pointerDrag = null;
		clearDropIndicators();
		treeContainer.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.classList.remove('svc-structure-row-dragging');
		if (!moved) {
			selectItem(id); // a plain click (no meaningful movement) - not a drag
			return;
		}
		if (overId && moveNode(id, overId, overPos)) {
			selectedId = id;
			commit();
			treeContainer.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.focus();
		}
	}

	/** @param {import('../core/ia.js').SidebarItem} item @param {number} depth @returns {HTMLElement} */
	function buildStructureRow(item, depth) {
		const wrap = document.createElement('div');
		wrap.className = 'svc-structure-node';

		const row = document.createElement('div');
		row.className = 'svc-structure-row' + (item.id === selectedId ? ' svc-structure-row-selected' : '');
		row.dataset.rowId = item.id;
		row.style.setProperty('--depth', String(depth));
		row.tabIndex = item.id === selectedId ? 0 : -1;
		row.setAttribute('role', 'treeitem');
		row.setAttribute('aria-selected', String(item.id === selectedId));
		row.setAttribute('aria-label', item.label || '(untitled)');

		const grip = document.createElement('span');
		grip.className = 'svc-structure-grip';
		grip.setAttribute('aria-hidden', 'true');
		grip.innerHTML = structureIconSvg(GRIP_ICON_SVG);
		row.appendChild(grip);

		const icon = document.createElement('span');
		icon.className = 'svc-structure-icon';
		icon.innerHTML = structureIconSvg(item.type === 'group' ? FOLDER_ICON_SVG : item.type === 'autogenerate' ? AUTO_ICON_SVG : PAGE_ICON_SVG);
		row.appendChild(icon);

		const label = document.createElement('span');
		label.className = 'svc-structure-label';
		label.textContent = item.label || (item.type === 'autogenerate' ? `(auto: ${item.directory})` : '(untitled)');
		row.appendChild(label);

		if (item.badge) {
			const badge = document.createElement('span');
			badge.className = 'svc-structure-badge';
			badge.textContent = item.badge.text;
			row.appendChild(badge);
		}
		if (item.hidden) {
			const hiddenTag = document.createElement('span');
			hiddenTag.className = 'svc-structure-hidden-tag';
			hiddenTag.textContent = 'hidden';
			row.appendChild(hiddenTag);
		}

		row.addEventListener('keydown', (event) => handleRowKeydown(event, item.id));
		// Pointer-based drag (see `pointerDrag`'s own comment above for why this isn't HTML5 native
		// drag-and-drop): mousedown starts tracking; a plain click (no meaningful movement) selects on
		// mouseup, a real drag past the threshold shows a drop indicator and reorders on mouseup.
		row.addEventListener('mousedown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault(); // no native text-selection while dragging
			pointerDrag = { id: item.id, startX: event.clientX, startY: event.clientY, moved: false, overId: null, overPos: null };
			document.addEventListener('mousemove', onPointerDragMove);
			document.addEventListener('mouseup', onPointerDragUp, { once: true });
			// Capture phase: wins over any other Escape handler (e.g. Inspect's, a dialog's) while a
			// drag is in flight, and is removed again in `cancelPointerDrag`/`onPointerDragUp`.
			document.addEventListener('keydown', onPointerDragKeydown, true);
		});

		wrap.appendChild(row);
		if (item.type === 'group' && item.items.length) {
			const children = document.createElement('div');
			children.className = 'svc-structure-children';
			for (const child of item.items) children.appendChild(buildStructureRow(child, depth + 1));
			wrap.appendChild(children);
		}
		return wrap;
	}

	function renderTree() {
		treeContainer.replaceChildren(...workingTree.map((item) => buildStructureRow(item, 0)));
	}

	function renderToolbarState() {
		const found = selectedId ? findById(selectedId) : null;
		upBtn.disabled = !found || found.index === 0;
		downBtn.disabled = !found || found.index === found.siblings.length - 1;
		outdentBtn.disabled = !found || found.path.length < 2;
		indentBtn.disabled = !found || found.index === 0 || found.siblings[found.index - 1]?.type !== 'group';
		deleteBtn.disabled = !found;
	}

	/** E3: "a 'Selected item' form below with the fields B's editor already edits" - reuses
	 * `buildBadgeFields` (module-scope, shared with the overlay editor) for badge fields, and the
	 * SAME `.svc-ia-label-input` class on the label field the overlay editor uses (smoke.mjs/
	 * ui-round2.mjs only ever look for it inside `.svc-ia-row`/the overlay's own tree, so re-using
	 * the class here for the studio's separate form is a harmless, purely visual convention share). */
	function renderForm() {
		formContainer.replaceChildren();
		const found = selectedId ? findById(selectedId) : null;
		const title = document.createElement('div');
		title.className = 'svc-structure-form-title';
		title.textContent = 'Selected item';
		if (found) {
			const tag = document.createElement('span');
			tag.textContent = found.item.type === 'autogenerate' ? 'Autogenerated' : found.item.type === 'group' ? 'Group' : 'Page link';
			title.appendChild(tag);
		}
		formContainer.appendChild(title);

		if (!found) {
			const empty = document.createElement('p');
			empty.className = 'svc-structure-empty';
			empty.textContent = workingTree.length ? 'Select an item above to edit its fields.' : 'Your tree is empty - add a page or group above.';
			formContainer.appendChild(empty);
			return;
		}
		const item = found.item;

		const labelInput = document.createElement('input');
		labelInput.type = 'text';
		labelInput.className = 'svc-ia-label-input';
		labelInput.value = item.label ?? '';
		labelInput.disabled = item.type === 'autogenerate';
		// Coordinator bug fix (undo-after-rename): see the overlay editor's identical comment above -
		// the same per-item coalescing key across `input`/`change` keeps a whole typing+blur gesture
		// as ONE undo step (panel.js's own no-op guard drops `change`'s redundant re-commit).
		const renameKey = `label:${item.id}`;
		labelInput.addEventListener('input', () => {
			item.label = labelInput.value;
			callbacks.onIaChange(cloneTree(workingTree), renameKey);
			const rowLabel = treeContainer.querySelector(`[data-row-id="${CSS.escape(item.id)}"] .svc-structure-label`);
			if (rowLabel) rowLabel.textContent = labelInput.value;
		});
		labelInput.addEventListener('change', () => {
			item.label = labelInput.value;
			callbacks.onIaChange(cloneTree(workingTree), renameKey);
			renderAll();
		});
		formContainer.appendChild(field('Label', labelInput));

		if (item.type === 'link') {
			const row = document.createElement('div');
			row.className = 'svc-ia-details-row';
			const slugInput = document.createElement('input');
			slugInput.type = 'text';
			slugInput.value = item.slug ?? '';
			slugInput.placeholder = 'content/docs slug, e.g. guides/kitchen-sink';
			const hrefInput = document.createElement('input');
			hrefInput.type = 'text';
			hrefInput.value = item.href ?? '';
			hrefInput.placeholder = 'external/absolute URL';
			slugInput.addEventListener('change', () => {
				const value = slugInput.value.trim();
				if (value) {
					item.slug = value;
					delete item.href;
					hrefInput.value = '';
				} else delete item.slug;
				commit();
			});
			hrefInput.addEventListener('change', () => {
				const value = hrefInput.value.trim();
				if (value) {
					item.href = value;
					delete item.slug;
					slugInput.value = '';
				} else delete item.href;
				commit();
			});
			row.appendChild(field('Slug', slugInput));
			row.appendChild(field('Href (external)', hrefInput));
			formContainer.appendChild(row);
			formContainer.appendChild(buildBadgeFields(item, false, commit));

			const hiddenLabel = document.createElement('label');
			hiddenLabel.className = 'svc-inline';
			const hiddenCheckbox = document.createElement('input');
			hiddenCheckbox.type = 'checkbox';
			hiddenCheckbox.checked = !!item.hidden;
			hiddenCheckbox.addEventListener('change', () => {
				item.hidden = hiddenCheckbox.checked;
				commit();
			});
			hiddenLabel.appendChild(hiddenCheckbox);
			hiddenLabel.appendChild(document.createTextNode('Hide in navigation'));
			formContainer.appendChild(hiddenLabel);
		} else if (item.type === 'group') {
			const collapsedLabel = document.createElement('label');
			collapsedLabel.className = 'svc-inline';
			const collapsedCheckbox = document.createElement('input');
			collapsedCheckbox.type = 'checkbox';
			collapsedCheckbox.checked = !!item.collapsed;
			collapsedCheckbox.addEventListener('change', () => {
				item.collapsed = collapsedCheckbox.checked;
				commit();
			});
			collapsedLabel.appendChild(collapsedCheckbox);
			collapsedLabel.appendChild(document.createTextNode('Starts collapsed'));
			formContainer.appendChild(collapsedLabel);
			formContainer.appendChild(buildBadgeFields(item, true, commit));
		} else if (item.type === 'autogenerate') {
			const dirInput = document.createElement('input');
			dirInput.type = 'text';
			dirInput.value = item.directory;
			dirInput.addEventListener('change', () => {
				item.directory = dirInput.value.trim();
				commit();
			});
			formContainer.appendChild(field('Directory', dirInput));
			const collapsedLabel = document.createElement('label');
			collapsedLabel.className = 'svc-inline';
			const collapsedCheckbox = document.createElement('input');
			collapsedCheckbox.type = 'checkbox';
			collapsedCheckbox.checked = !!item.collapsed;
			collapsedCheckbox.addEventListener('change', () => {
				item.collapsed = collapsedCheckbox.checked;
				commit();
			});
			collapsedLabel.appendChild(collapsedCheckbox);
			collapsedLabel.appendChild(document.createTextNode('Starts collapsed'));
			formContainer.appendChild(collapsedLabel);
		}
	}

	function renderAll() {
		renderTree();
		renderToolbarState();
		renderForm();
	}

	renderAll();

	function refresh(state) {
		workingTree = cloneTree(state.ia ?? iaFromStarlightConfig(fixtureSidebar));
		if (!findById(selectedId)) selectedId = workingTree[0]?.id ?? null;
		renderAll();
	}

	return { root, refresh };
}
