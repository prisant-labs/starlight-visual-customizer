/**
 * @file "Inspect": click an element on the previewed page to
 * reach exactly the controls that style it. Lives in the studio's own light DOM (a sibling of `studio.js`, same pattern: a plain
 * `initInspect()` called once after `initStudioShell()` from `studio.astro`).
 *
 * The reverse lookup this is built on already exists on every manifest control
 * (`core/manifest.js`): a `target` CSS selector for the page element(s) it styles. The algorithm is
 * exactly "walk up from the pointer to the innermost element matching ANY control's target, then
 * collect every control whose target matches THAT element" - built generically off `controls`, never
 * a per-control id.
 *
 * Two DOM regions this module touches, deliberately kept separate:
 *  - **Each previewed page's own document** (light/dark lane iframes, `page-doc.js`'s `getPageDocs()`
 *    lanes): hover/selection outlines (plain CSS classes with `outline`, which never affects layout)
 *    and the small pointer-following tag, injected via one `<style>` per document - never a
 *    fixed-position overlay in the HOST document like `target-highlight.js` uses, because these
 *    outlines and the pointer tag live in the SAME document as the elements/pointer they track, so
 *    no host<->frame coordinate translation is needed at all.
 *  - **The panel's own shadow root** (`host.shadowRoot`, opened by panel.js - `{mode: 'open'}`):
 *    the "Inspecting: <Group> - <Section>" chip (built and styled entirely here or in panel.js's
 *    own small additive block, never in styles.js) and expanding the sections that hold the scope's controls (direct
 *    DOM reads/writes against controls.js's already-rendered `.svc-section`/`.svc-control` markup -
 *    no controls.js changes needed). The scope's own persistent highlight on each control ROW,
 *    though, does need panel.js's help - `controlRows` (which row belongs to which control id) is
 *    private to its closure - hence `host.__svc.highlightControls`/`clearInspected` in panel.js's
 *    one marked additive block.
 */
import { controls, GROUPS } from '../core/manifest.js';
// `resolvedEl` below lives inside a lane iframe - a plain
// `Element.scrollIntoView()` there can bleed into the HOST document's own scroll containers (see
// target-highlight.js's file-level note on `scrollElementIntoView`). Shared with that module's own
// scroll-and-correct loop rather than duplicated here.
import { scrollElementIntoView } from './target-highlight.js';

// ---------------------------------------------------------------------------------------------
// Manifest-derived, computed once (selectors don't change at runtime): every control with a
// `target` whose selector actually parses (defensive - one bad selector must never break every
// OTHER control's hit-testing by poisoning a single combined `.matches()` call), plus that
// combined selector for I2's fast "does ANY control care about this element" pre-check.
// ---------------------------------------------------------------------------------------------
function isValidSelector(selector) {
	try {
		document.createDocumentFragment().querySelector(selector);
		return true;
	} catch {
		return false;
	}
}
const VALID_CONTROLS = controls.filter((c) => c.target && isValidSelector(c.target));
const COMBINED_SELECTOR = VALID_CONTROLS.map((c) => c.target).join(', ');

/** @param {Element} startEl @returns {Element | null} The innermost ancestor-or-self of `startEl`
 * matching any control's `target` (I2). */
function findInnermostMatch(startEl) {
	let node = startEl;
	while (node && node.nodeType === 1) {
		try {
			if (COMBINED_SELECTOR && node.matches(COMBINED_SELECTOR)) return node;
		} catch {
			/* pre-validated, but never let a runtime engine quirk break hover */
		}
		node = node.parentElement;
	}
	return null;
}

/** @param {Element} el @returns {import('../core/manifest.js').Control[]} Every control whose
 * `target` matches `el` (I2's "scope"), in manifest order. */
function computeScope(el) {
	const scope = [];
	for (const c of VALID_CONTROLS) {
		try {
			if (el.matches(c.target)) scope.push(c);
		} catch {
			/* pre-validated; defensive only */
		}
	}
	return scope;
}

/** @param {Document} doc @param {string} target @returns {number} */
function docMatchCount(doc, target) {
	try {
		return doc.querySelectorAll(target).length;
	} catch {
		return 0;
	}
}

/**
 * A real element routinely matches controls from more than one group at once - e.g. the ACTIVE
 * sidebar link matches both `color.accent.hue`/`color.accent.chroma` (Colors: it IS accent-colored)
 * and `sidebar.activeStyle`/`sidebar.itemPaddingY` (Sidebar: sidebar-specific styling) - and manifest
 * order alone always favors Colors (it's declared first), which would open the wrong rail group for
 * a "click the sidebar" scope. This picks the group I4 opens/anchors on: the group with the most
 * controls in the scope; a tie is broken toward whichever tied group's MOST SPECIFIC control (the
 * fewest other elements on the page its own target matches) is more specific - a broad, shared
 * target like accent hue's (matches every link on the page) loses to a narrow one like an
 * active-item style (matches only the current item). Verified empirically against four
 * representative elements on `/demo/specimen/` (active sidebar link -> Sidebar, an h2 -> Typography, a
 * code block -> Code, a callout -> Content) before writing this, not guessed.
 * @param {import('../core/manifest.js').Control[]} scope @param {Document} doc
 * @returns {string}
 */
function pickPrimaryGroup(scope, doc) {
	if (scope.length === 1) return scope[0].group;
	/** @type {Map<string, import('../core/manifest.js').Control[]>} */
	const byGroup = new Map();
	for (const c of scope) {
		if (!byGroup.has(c.group)) byGroup.set(c.group, []);
		byGroup.get(c.group).push(c);
	}
	let maxCount = 0;
	for (const arr of byGroup.values()) maxCount = Math.max(maxCount, arr.length);
	const tied = [...byGroup.keys()].filter((g) => byGroup.get(g).length === maxCount);
	if (tied.length === 1) return tied[0];
	let best = tied[0];
	let bestMinMatches = Infinity;
	for (const g of tied) {
		const minMatches = Math.min(...byGroup.get(g).map((c) => docMatchCount(doc, c.target)));
		if (minMatches < bestMinMatches) {
			bestMinMatches = minMatches;
			best = g;
		}
	}
	return best;
}

/** @param {Document} doc @param {string} target @returns {Element | null} First VISIBLE match. */
function firstVisibleMatch(doc, target) {
	let nodes;
	try {
		nodes = doc.querySelectorAll(target);
	} catch {
		return null;
	}
	for (const el of nodes) if (el.getClientRects().length > 0) return el;
	return null;
}

/**
 * This list is PAGE AREAS, not individual
 * controls - listing every control duplicated the panel itself. One entry per distinct SCOPE
 * (the same `<group> › <section>` naming the hover tag and the chip use), for every scope with
 * at least one visible match on `doc`, grouped by manifest group in `GROUPS` (+ Navigation) order.
 * Choosing an entry re-resolves and selects it exactly as clicking that element would (`selectScope`).
 *
 * A control whose OWN target is page-wide (`body`, matched literally - `color.role.bg`/
 * `color.role.text` are the only two in this manifest) is excluded: "the whole page" isn't a
 * clickable spot the way "Sidebar › Items" is.
 * LEFT OUT rather than added back as "<Group> › Whole page" - no group in this manifest is
 * page-wide-only (Colors, the only group with any body-level control, has plenty of specific ones
 * too), so a synthetic entry would only ever ADD noise, never fill a gap.
 * @param {Document} doc
 * @returns {Map<string, {group: string, section: string, el: Element}[]>}
 */
function computeAvailableSurfaces(doc) {
	/** @type {Map<string, {group: string, section: string, el: Element}>} keyed `group::section` */
	const scopesByKey = new Map();
	const order = [];
	for (const c of VALID_CONTROLS) {
		const el = firstVisibleMatch(doc, c.target);
		if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') continue; // page-wide - excluded, see above
		const scope = computeScope(el);
		if (!scope.length) continue;
		const primaryGroup = pickPrimaryGroup(scope, doc);
		const anchor = scope.find((sc) => sc.group === primaryGroup) || scope[0];
		const key = `${primaryGroup}::${anchor.section}`;
		if (scopesByKey.has(key)) continue;
		scopesByKey.set(key, { group: primaryGroup, section: anchor.section, el });
		order.push(key);
	}
	/** @type {Map<string, {group: string, section: string, el: Element}[]>} */
	const byGroup = new Map();
	for (const groupName of [...GROUPS, 'Navigation']) byGroup.set(groupName, []);
	for (const key of order) {
		const entry = scopesByKey.get(key);
		byGroup.get(entry.group)?.push(entry);
	}
	for (const [name, list] of [...byGroup]) if (!list.length) byGroup.delete(name);
	return byGroup;
}

/** @param {Document} doc @returns {boolean} */
function isTypingIn(doc) {
	let el = doc.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// ---------------------------------------------------------------------------------------------
// Frame-document CSS (I3): plain classes, disjoint for hover vs. a persisted click-selection so
// clearing hover outlines on every pointer move never wipes the selection's own outline (a real bug
// caught before shipping - both used to share one class name). `outline` never affects layout
// (I3's "outlines... never change the page's layout"); a small NEGATIVE offset keeps them from being
// clipped by an ancestor's `overflow` (the sidebar pane, the TOC rail) the way a positive offset
// would. `!important` guards against the previewed page's own theme CSS (which this same studio
// also live-edits) ever coincidentally setting `outline` on the same elements.
// ---------------------------------------------------------------------------------------------
const FRAME_CSS = `
/* A plain accent outline disappears on an already accent-filled element (the
   active sidebar item). Two INSET rings (white, then accent) read on any background in light or
   dark - whichever ring doesn't blend into what's under it still shows, and neither affects layout
   (box-shadow, like outline, never participates in box geometry). */
.svc-insp-hover-solid, .svc-insp-sel-solid { outline: none !important; box-shadow: inset 0 0 0 2px #ffffff, inset 0 0 0 4px #4453c9 !important; }
.svc-insp-hover-dashed, .svc-insp-sel-dashed { outline: 1.5px dashed rgba(68, 83, 201, 0.65) !important; outline-offset: -2px !important; }
.svc-insp-hover-solid, .svc-insp-hover-dashed { cursor: crosshair !important; }
#svc-inspect-tag {
	position: fixed;
	z-index: 2147483647;
	pointer-events: none;
	background: #1b2130;
	color: #ffffff;
	font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
	padding: 3px 8px;
	border-radius: 5px;
	white-space: nowrap;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
}
`;

/** Shadow-root CSS for the "Inspecting: ..." chip. Uses the same `--ui-*` tokens
 * styles.js defines under `:host([data-docked='true'])` so this inherits the existing, already
 * contrast-verified palette instead of inventing new colors the contrast walk hasn't seen. */
const CHIP_CSS = `
.svc-inspect-chip { margin: 0 0 0.65rem; padding: 0.6rem 0.7rem; border: 1px solid var(--ui-line, #dde1e8); border-radius: 8px; background: var(--ui-accent-tint, rgba(68, 83, 201, 0.08)); }
.svc-inspect-chip-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.svc-inspect-chip-title { font-size: 0.75rem; font-weight: 700; color: var(--ui-accent-ink, #3a46b0); }
.svc-inspect-chip-close { border: 0; background: transparent; color: var(--ui-muted, #566072); font-size: 0.9375rem; line-height: 1; padding: 0.15rem 0.35rem; cursor: pointer; border-radius: 4px; }
.svc-inspect-chip-close:hover { background: var(--ui-panel, #ffffff); color: var(--ui-ink, #1b2130); }
.svc-inspect-chip-close:focus-visible { outline: 2px solid var(--ui-accent, #4453c9); outline-offset: 1px; }
.svc-inspect-chip-list { list-style: none; margin: 0.55rem 0 0; padding: 0; display: grid; gap: 0.15rem; }
/* These looked like plain text - link/button styling (accent-ink color, which
   still clears the panel's 7:1 label floor at ~7.8:1, plus a hover/focus treatment) signals they're
   actionable, matching the reset-group button and rail items' own affordance language. */
.svc-inspect-chip-list button { display: block; width: 100%; text-align: left; border: 1px solid transparent; background: transparent; padding: 0.3rem 0.4rem; font-size: 0.75rem; font-weight: 600; color: var(--ui-accent-ink, #3a46b0); border-radius: 5px; cursor: pointer; }
.svc-inspect-chip-list button:hover { background: var(--ui-panel, #ffffff); border-color: var(--ui-line, #dde1e8); text-decoration: underline; }
.svc-inspect-chip-list button:focus-visible { outline: 2px solid var(--ui-accent, #4453c9); outline-offset: 1px; background: var(--ui-panel, #ffffff); }
.svc-inspect-chip-group { color: var(--ui-muted, #566072); font-size: 0.6875rem; margin-left: 0.3rem; font-weight: 400; }
`;

function h(tag, attrs = {}, html) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') el.className = v;
		else el.setAttribute(k, v);
	}
	if (html != null) el.innerHTML = html;
	return el;
}

export function initInspect() {
	const host = document.querySelector('sl-customizer');
	const svc = host && host.__svc;
	if (!svc) return; // overlay mode, or panel.js failed to init - nothing to build

	const laneEls = {
		light: document.querySelector('.svc-lane[data-lane="light"]'),
		dark: document.querySelector('.svc-lane[data-lane="dark"]'),
	};
	const frameEls = {
		light: laneEls.light?.querySelector('iframe[data-svc-preview]'),
		dark: laneEls.dark?.querySelector('iframe[data-svc-preview]'),
	};
	if (!frameEls.light) return;

	let active = false;
	/** @type {{doc: Document | null, el: Element | null, scope: import('../core/manifest.js').Control[] | null}} */
	const hoverState = { doc: null, el: null, scope: null };
	/** @type {{doc: Document, el: Element} | null} */
	let persistentSelection = null;

	// =============================================================================================
	// I1: toolbar toggle + I5's "Elements" list entry point.
	// =============================================================================================
	const toolbarRight = document.querySelector('.svc-toolbar-right');
	const inspectBtn = h(
		'button',
		{ type: 'button', class: 'svc-seg-btn svc-inspect-toggle', 'aria-pressed': 'false', title: 'Inspect (I) - click an element on the page to reach its controls' },
		'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span>Inspect</span>'
	);
	const elementsBtn = h('button', { type: 'button', class: 'svc-seg-btn svc-inspect-elements-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'List every styleable element on this page' }, 'Elements');
	const inspectGroup = h('div', { class: 'svc-seg svc-inspect-seg', role: 'group', 'aria-label': 'Inspect' });
	inspectGroup.appendChild(inspectBtn);
	inspectGroup.appendChild(elementsBtn);
	if (toolbarRight) {
		const firstIconLink = toolbarRight.querySelector('.svc-icon-link');
		if (firstIconLink) toolbarRight.insertBefore(inspectGroup, firstIconLink);
		else toolbarRight.appendChild(inspectGroup);
	}

	inspectBtn.addEventListener('click', () => setActive(!active));
	elementsBtn.addEventListener('click', () => {
		if (!active) setActive(true);
		toggleElementsPopover();
	});

	// =============================================================================================
	// Panel shadow-root chip (I4).
	// =============================================================================================
	let chipStyleInjected = false;
	let chipEl = null;
	let chipTitleEl = null;
	let chipListEl = null;
	function ensureChip() {
		if (chipEl) return chipEl;
		const root = host.shadowRoot;
		if (!root) return null;
		if (!chipStyleInjected) {
			const style = document.createElement('style');
			style.textContent = CHIP_CSS;
			root.appendChild(style);
			chipStyleInjected = true;
		}
		const panelCol = root.querySelector('.svc-panel-col');
		if (!panelCol) return null;
		chipEl = document.createElement('div');
		chipEl.className = 'svc-inspect-chip';
		chipEl.hidden = true;
		const headRow = document.createElement('div');
		headRow.className = 'svc-inspect-chip-head';
		chipTitleEl = document.createElement('span');
		chipTitleEl.className = 'svc-inspect-chip-title';
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'svc-inspect-chip-close';
		closeBtn.setAttribute('aria-label', 'Clear inspection');
		closeBtn.textContent = '×';
		closeBtn.addEventListener('click', () => clearSelection());
		headRow.appendChild(chipTitleEl);
		headRow.appendChild(closeBtn);
		chipListEl = document.createElement('ul');
		chipListEl.className = 'svc-inspect-chip-list';
		chipEl.appendChild(headRow);
		chipEl.appendChild(chipListEl);
		panelCol.insertBefore(chipEl, panelCol.firstChild);
		return chipEl;
	}
	function showChip(primaryGroup, anchor, scope) {
		const el = ensureChip();
		if (!el) return;
		el.hidden = false;
		chipTitleEl.textContent = `Inspecting: ${primaryGroup} › ${anchor.section}`;
		chipListEl.replaceChildren();
		for (const c of scope) {
			const li = document.createElement('li');
			const btn = document.createElement('button');
			btn.type = 'button';
			// NOT `data-control-id` (bug found in testing): controls.js's real rows use exactly that
			// attribute, and the chip sits BEFORE `.svc-panel-sections` in the panel column, so an
			// unscoped `[data-control-id="..."]` lookup elsewhere would match this chip button instead
			// of the actual row it was trying to find, the moment a scope control's own id also became
			// one of the chip's own list entries (which it always does - the anchor lists itself).
			btn.dataset.chipControlId = c.id;
			btn.textContent = c.label;
			if (c.group !== primaryGroup) {
				const tag = document.createElement('span');
				tag.className = 'svc-inspect-chip-group';
				tag.textContent = `(${c.group})`;
				btn.appendChild(tag);
			}
			btn.addEventListener('click', () => svc.openGroupForInspect(c.group, c.id));
			li.appendChild(btn);
			chipListEl.appendChild(li);
		}
	}
	function hideChip() {
		if (chipEl) chipEl.hidden = true;
	}

	/** I4: "expand every section holding a scope control" - direct DOM reads/writes against
	 * controls.js's already-rendered markup (`.svc-control[data-control-id]` inside `.svc-section`),
	 * no controls.js changes needed. */
	function expandSectionsFor(scope) {
		const root = host.shadowRoot;
		if (!root) return;
		for (const c of scope) {
			const row = root.querySelector(`.svc-control[data-control-id="${c.id}"]`);
			const section = row?.closest('.svc-section');
			if (!section) continue;
			section.dataset.open = 'true';
			section.querySelector('.svc-section-toggle')?.setAttribute('aria-expanded', 'true');
		}
	}

	/** `openGroup`'s own `focusControlId` -> `.focus()` did not reliably bring a
	 * just-revealed row (its section may have been collapsed a moment earlier, in the same tick) into
	 * view in testing - an explicit `scrollIntoView` on the PANEL COLUMN's own row is more reliable
	 * than depending on browser auto-scroll-on-focus. This only ever scrolls the shadow root's own
	 * `.svc-panel-sections` (a normal scrollable div, never the iframe) - the previewed page cannot be
	 * affected, since a control row isn't part of that document's DOM at all. */
	function scrollAnchorRowIntoView(controlId) {
		const row = host.shadowRoot?.querySelector(`.svc-control[data-control-id="${controlId}"]`);
		if (!row) return;
		try {
			// `block: 'start'`, not `'center'`: a font-list/tile-grid row (e.g. "Heading font" - a
			// full list of face options) can be TALLER than the panel's own visible height, and
			// centering an over-tall element scrolls its MIDDLE into view - pushing the row's own
			// label (what names the control to begin with) off the top edge. Aligning the row's top
			// with the container's top always keeps the label visible, regardless of the row's height.
			row.scrollIntoView({ block: 'start', behavior: 'smooth' });
		} catch {
			/* never let a scroll failure break selection */
		}
	}

	// =============================================================================================
	// Persistent (post-click) page outlines - disjoint classes from hover's, so a hover elsewhere
	// never clears the current selection (see FRAME_CSS's header note).
	// =============================================================================================
	function clearPersistentOutlines() {
		if (!persistentSelection) return;
		try {
			for (const el of persistentSelection.doc.querySelectorAll('.svc-insp-sel-solid, .svc-insp-sel-dashed')) {
				el.classList.remove('svc-insp-sel-solid', 'svc-insp-sel-dashed');
			}
		} catch {
			/* the doc may have navigated away since - nothing to clean up */
		}
		persistentSelection = null;
	}
	function applyPersistentOutlines(doc, resolvedEl, scope) {
		resolvedEl.classList.add('svc-insp-sel-solid');
		const selector = scope.map((c) => c.target).join(', ');
		if (selector) {
			let nodes = [];
			try {
				nodes = doc.querySelectorAll(selector);
			} catch {
				/* pre-validated targets only reach here */
			}
			for (const el of nodes) if (el !== resolvedEl) el.classList.add('svc-insp-sel-dashed');
		}
		persistentSelection = { doc, el: resolvedEl };
	}

	function clearSelection() {
		clearPersistentOutlines();
		svc.clearInspected();
		hideChip();
	}

	/**
	 * I4/I5's shared "select this element" path. @param {Document} doc @param {Element} resolvedEl
	 * @param {{scroll?: boolean}} [opts] I5 scrolls to reach an off-screen element; I4 (a live click)
	 *   never does (the element is already visible under the pointer).
	 */
	function selectScope(doc, resolvedEl, { scroll = false } = {}) {
		const scope = computeScope(resolvedEl);
		if (!scope.length) return;
		const primaryGroup = pickPrimaryGroup(scope, doc);
		const anchor = scope.find((c) => c.group === primaryGroup) || scope[0];
		clearPersistentOutlines();
		applyPersistentOutlines(doc, resolvedEl, scope);
		if (scroll) {
			try {
				scrollElementIntoView(resolvedEl, { block: 'center', behavior: 'smooth' });
			} catch {
				/* never let a scroll failure break selection */
			}
		}
		svc.openGroupForInspect(primaryGroup, anchor.id);
		expandSectionsFor(scope);
		scrollAnchorRowIntoView(anchor.id);
		svc.highlightControls(scope.map((c) => c.id));
		showChip(primaryGroup, anchor, scope);
		closeElementsPopover();
	}

	// =============================================================================================
	// I3: hover outlines + the pointer-following scope tag, per frame document.
	// =============================================================================================
	function clearHoverOutlines() {
		if (!hoverState.doc) return;
		try {
			for (const el of hoverState.doc.querySelectorAll('.svc-insp-hover-solid, .svc-insp-hover-dashed')) {
				el.classList.remove('svc-insp-hover-solid', 'svc-insp-hover-dashed');
			}
		} catch {
			/* the doc may have navigated away - nothing to clean up */
		}
		hoverState.doc = null;
		hoverState.el = null;
		hoverState.scope = null;
	}
	function ensureTag(doc) {
		let tag = doc.getElementById('svc-inspect-tag');
		if (!tag) {
			tag = doc.createElement('div');
			tag.id = 'svc-inspect-tag';
			tag.hidden = true;
			(doc.body || doc.documentElement).appendChild(tag);
		}
		return tag;
	}
	function positionTag(doc, x, y, scope) {
		if (!scope || !scope.length) return;
		const tag = ensureTag(doc);
		const primaryGroup = pickPrimaryGroup(scope, doc);
		const anchor = scope.find((c) => c.group === primaryGroup) || scope[0];
		tag.textContent = `${primaryGroup} › ${anchor.section} · ${scope.length} control${scope.length === 1 ? '' : 's'}`;
		tag.style.left = `${x + 14}px`;
		tag.style.top = `${y + 16}px`;
		tag.hidden = false;
	}
	function hideTagIn(doc) {
		const tag = doc?.getElementById?.('svc-inspect-tag');
		if (tag) tag.hidden = true;
	}

	function handleHover(doc, x, y) {
		// Re-check `active` here, not just in the `pointermove` listener that scheduled this rAF
		// callback: a click's own preceding synthetic pointermove can schedule this BEFORE the click's
		// `Escape`-adjacent teardown runs (`setActive(false)` is synchronous; this callback fires on
		// the next animation frame, which can land either side of it) - without this guard, a stale
		// queued callback re-applies hover outlines just after Inspect turned off. Caught empirically:
		// flaked in a full sequential run, passed every time alone.
		if (!active) return;
		let target;
		try {
			target = doc.elementFromPoint(x, y);
		} catch {
			target = null;
		}
		const resolved = target ? findInnermostMatch(target) : null;
		if (resolved !== hoverState.el || hoverState.doc !== doc) {
			clearHoverOutlines();
			hoverState.doc = doc;
			hoverState.el = resolved;
			if (resolved) {
				resolved.classList.add('svc-insp-hover-solid');
				const scope = computeScope(resolved);
				hoverState.scope = scope;
				const selector = scope.map((c) => c.target).join(', ');
				if (selector) {
					let nodes = [];
					try {
						nodes = doc.querySelectorAll(selector);
					} catch {
						/* pre-validated targets only reach here */
					}
					for (const el of nodes) if (el !== resolved) el.classList.add('svc-insp-hover-dashed');
				}
			} else {
				hoverState.scope = null;
			}
		}
		if (resolved) positionTag(doc, x, y, hoverState.scope);
		else hideTagIn(doc);
	}

	// =============================================================================================
	// Keyboard: Esc always works (I1) - even right after a click focuses a control's own input via
	// `focusControlId`, which a naive "ignore while typing" gate would otherwise swallow. Plain `I`
	// (no modifier) toggles Inspect, gated on not-typing so it doesn't hijack an actual letter "i"
	// keystroke. Registered on the host document AND every attached frame document, since `keydown`
	// never crosses an iframe boundary to its parent.
	// =============================================================================================
	function handleGlobalKeydown(event) {
		// A modal <dialog> (the studio's About) owns the keyboard while it's open: Escape must reach
		// it to close it, and a plain "i" must not toggle Inspect behind it.
		if (document.querySelector('dialog:modal')) return;
		if (event.key === 'Escape') {
			if (!active) return;
			event.preventDefault();
			setActive(false);
			return;
		}
		if (event.key.toLowerCase() === 'i' && !event.ctrlKey && !event.metaKey && !event.altKey) {
			const doc = event.currentTarget?.nodeType === 9 ? event.currentTarget : document;
			if (isTypingIn(doc)) return;
			event.preventDefault();
			setActive(!active);
		}
	}
	document.addEventListener('keydown', handleGlobalKeydown);

	// =============================================================================================
	// Per-document attach (I6): idempotent per `Document` instance (a WeakSet, same pattern
	// panel.js/target-highlight.js already use elsewhere), re-run on every in-frame navigation via
	// the lane iframe's own `load` event AND once synchronously per lane right now (a lane can
	// already be fully loaded - e.g. the Split dark lane, loaded since page load, well before this
	// module's init runs - and would otherwise never fire `load` again for us to listen for).
	// =============================================================================================
	const attachedInspectDocs = new WeakSet();
	const styledDocs = new WeakSet();
	function attachInspectToDoc(doc) {
		if (!doc || doc.URL === 'about:blank' || doc.readyState === 'loading') return;
		if (attachedInspectDocs.has(doc)) return;
		attachedInspectDocs.add(doc);
		if (!styledDocs.has(doc)) {
			styledDocs.add(doc);
			const style = doc.createElement('style');
			style.textContent = FRAME_CSS;
			doc.head.appendChild(style);
		}
		let hoverRaf = null;
		doc.addEventListener(
			'pointermove',
			(event) => {
				if (!active) return;
				const x = event.clientX;
				const y = event.clientY;
				if (hoverRaf != null) return;
				const win = doc.defaultView || window;
				hoverRaf = win.requestAnimationFrame(() => {
					hoverRaf = null;
					handleHover(doc, x, y);
				});
			},
			true
		);
		doc.addEventListener(
			'pointerleave',
			() => {
				if (!active) return;
				if (hoverState.doc === doc) {
					clearHoverOutlines();
					hideTagIn(doc);
				}
			},
			true
		);
		doc.addEventListener(
			'click',
			(event) => {
				if (!active) return;
				event.preventDefault();
				event.stopPropagation();
				const resolved = findInnermostMatch(event.target);
				if (resolved) selectScope(doc, resolved);
			},
			true
		);
		doc.addEventListener('keydown', handleGlobalKeydown, true);
	}
	for (const laneKey of ['light', 'dark']) {
		const frame = frameEls[laneKey];
		if (!frame) continue;
		try {
			attachInspectToDoc(frame.contentDocument);
		} catch {
			/* not yet accessible - the load listener below will catch it */
		}
		frame.addEventListener('load', () => {
			try {
				attachInspectToDoc(frame.contentDocument);
			} catch {
				/* cross-origin/mid-navigation momentarily - nothing to do */
			}
		});
	}

	// =============================================================================================
	// I5: the element list (from the Inspect button's sibling "Elements" toggle).
	// =============================================================================================
	let popoverEl = null;
	function ensurePopover() {
		if (popoverEl) return popoverEl;
		popoverEl = h('div', { class: 'svc-inspect-elements-popover', role: 'dialog', 'aria-label': 'Elements on this page' });
		popoverEl.hidden = true;
		document.body.appendChild(popoverEl);
		document.addEventListener('pointerdown', (event) => {
			if (popoverEl.hidden) return;
			if (event.target === elementsBtn || popoverEl.contains(event.target)) return;
			closeElementsPopover();
		});
		return popoverEl;
	}
	function closeElementsPopover() {
		if (popoverEl && !popoverEl.hidden) {
			popoverEl.hidden = true;
			elementsBtn.setAttribute('aria-expanded', 'false');
		}
	}
	function toggleElementsPopover() {
		const el = ensurePopover();
		if (!el.hidden) {
			closeElementsPopover();
			return;
		}
		const primaryDoc = frameEls.light.contentDocument;
		if (!primaryDoc) return;
		const byGroup = computeAvailableSurfaces(primaryDoc);
		el.replaceChildren();
		let firstBtn = null;
		for (const [groupName, entries] of byGroup) {
			const groupLabel = h('div', { class: 'svc-inspect-elements-group' }, groupName);
			el.appendChild(groupLabel);
			for (const entry of entries) {
				const btn = h('button', { type: 'button', class: 'svc-inspect-elements-item' }, `${entry.group} › ${entry.section}`);
				btn.addEventListener('click', () => {
					if (entry.el.isConnected) selectScope(primaryDoc, entry.el, { scroll: true });
				});
				el.appendChild(btn);
				if (!firstBtn) firstBtn = btn;
			}
		}
		// The Elements button sits near the toolbar's right edge - anchoring the popover by its LEFT
		// edge (the button's own left) routinely pushed it off the right side of the viewport (seen in
		// `c2-inspect-list.png`'s first draft: several item labels clipped). Anchoring by the button's
		// RIGHT edge instead keeps the whole popover on-screen without needing to measure its own width.
		const btnRect = elementsBtn.getBoundingClientRect();
		el.style.left = '';
		el.style.right = `${Math.round(window.innerWidth - btnRect.right)}px`;
		el.style.top = `${Math.round(btnRect.bottom + 6)}px`;
		el.hidden = false;
		elementsBtn.setAttribute('aria-expanded', 'true');
		firstBtn?.focus();
	}

	// =============================================================================================
	// I1: on/off.
	// =============================================================================================
	function updateToggleUi() {
		inspectBtn.setAttribute('aria-pressed', String(active));
	}
	function setActive(next) {
		if (active === next) return;
		active = next;
		updateToggleUi();
		if (!active) {
			clearSelection();
			clearHoverOutlines();
			for (const laneKey of ['light', 'dark']) hideTagIn(frameEls[laneKey]?.contentDocument);
			closeElementsPopover();
		}
	}
	updateToggleUi();
}
