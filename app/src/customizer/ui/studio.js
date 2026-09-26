/**
 * @file Studio light-DOM shell: top bar, toolbar, context line,
 * the preview stage - one or two lanes, scaling, Split - and the status bar.
 * Everything here lives in the studio's OWN document (never a shadow root) and talks to panel.js
 * through the controller it sets on `<sl-customizer>`, `host.__svc` (see panel.js's file header for
 * the full surface: getState/subscribe/undo/redo/canUndo/canRedo/setName/getName/getSaveStatus/
 * openExport/importState/getChangeCount/getContrastReport/openGroup/setPreviewTheme).
 *
 * By the time `initStudioShell()` runs, `<sl-customizer>` has already been upgraded and its
 * `connectedCallback` has already run synchronously (it's parsed into the document before this
 * module's `<script type="module">`, and `customElements.define()` - a side effect of importing
 * panel.js, which this same script imports first - upgrades already-parsed custom elements
 * synchronously) - so `host.__svc` is guaranteed to exist here with no extra wait.
 */

import { STARLIGHT_VERSION } from '../core/version.js';
import { withBase, stripBase } from '../core/base-path.js';

const SESSIONSTORAGE_UI_KEY = 'svc-ui';
// D3a: every path this file tracks internally (DEFAULT_PAGE_PATH, STUDIO_PAGES[].path, `currentPath`,
// the `?page=` query value, `sessionStorage['svc-ui'].studioPage`) stays BASE-FREE, on purpose - see
// `core/base-path.js`'s file header. `withBase()`/`stripBase()` convert at exactly two boundaries
// below: setting a frame's `src`/`location.href` (needs the base), and reading a frame's real
// `location.pathname` back (needs the base stripped off before it's compared/stored).
const DEFAULT_PAGE_PATH = '/specimen/';

/** Four tabs - Style guide,
 * Document (was "Long doc"; tab label only - the file is still `guides/kitchen-sink.mdx`), Landing,
 * 404. The three dropped pages (Article, Short doc, Reference) all share Document's `template: doc`
 * layout, so they added length/frontmatter variety but no new template; they stay in the demo site,
 * reachable via its own sidebar, where the switcher shows its existing "Other: /path/" state (see
 * `markCurrentPage` below). Order is the toolbar's left-to-right order. */
const STUDIO_PAGES = [
	{ id: 'specimen', label: 'Style guide', path: '/specimen/', icon: 'doc' },
	{ id: 'longdoc', label: 'Document', path: '/guides/kitchen-sink/', icon: 'doc' },
	{ id: 'landing', label: 'Landing', path: '/', icon: 'home' },
	{ id: '404', label: '404', path: '/404/', icon: 'alert' },
];
export { STUDIO_PAGES };

/** Fit (fills the lane, always scale 1, no transform) plus fixed natural widths.
 * Laptop 1280, Wide 1920 and Ultra-wide 2560 sit alongside the
 * original Desktop 1440/Tablet 820/Mobile 390 - "seeing the desktop layout on large screens". */
const STUDIO_DEVICES = [
	{ id: 'fit', label: 'Fit', width: null },
	{ id: '1280', label: 'Laptop 1280', width: 1280 },
	{ id: '1440', label: 'Desktop 1440', width: 1440 },
	{ id: '1920', label: 'Wide 1920', width: 1920 },
	{ id: '2560', label: 'Ultra-wide 2560', width: 2560 },
	{ id: 'tablet', label: 'Tablet 820', width: 820 },
	{ id: 'mobile', label: 'Mobile 390', width: 390 },
];
export { STUDIO_DEVICES };

/** F2: zoom steps beside the device control (percent, as fractions) - "Fit" (the natural
 * fit-to-column scale, today's behavior) is a separate sentinel, not a step in this list. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
export { ZOOM_STEPS };

const ICONS = {
	doc: '<path d="M6 3.5h9l4 4V20.5H6z"/><path d="M14.5 3.5V8h4"/>',
	home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
	alert: '<path d="M12 3.5L21.5 20h-19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
	undo: '<path d="M7 8H4V5"/><path d="M4.5 8A8 8 0 1112 20"/>',
	redo: '<path d="M17 8h3V5"/><path d="M19.5 8A8 8 0 1012 20"/>',
	export: '<path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M4 17v3h16v-3"/>',
	'import': '<path d="M12 16V3"/><path d="M7 8l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
	moon: '<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>',
	split: '<rect x="3.5" y="4" width="17" height="16" rx="1"/><path d="M12 4v16"/>',
	overlay: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5"/>',
	newtab: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
	desktop: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
	fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
	tablet: '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M11.5 18h1"/>',
	mobile: '<rect x="8" y="3" width="8" height="18" rx="1.2"/><path d="M11.5 18h1"/>',
	// Distinct silhouettes for Wide/Ultra-wide - flatter/wider than
	// `desktop`, and progressively more so, so the three read as a size progression at a glance.
	wide: '<rect x="2" y="6" width="20" height="9" rx="1"/><path d="M9 19h6M12 15v4"/>',
	ultrawide: '<rect x="1" y="7.5" width="22" height="6" rx="1"/><path d="M10 19h4M12 13.5v5.5"/>',
};
function icon(name, size = 16) {
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function loadUiState() {
	try {
		const raw = sessionStorage.getItem(SESSIONSTORAGE_UI_KEY);
		const parsed = raw ? JSON.parse(raw) : null;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
function saveUiState(partial) {
	try {
		const merged = { ...loadUiState(), ...partial };
		sessionStorage.setItem(SESSIONSTORAGE_UI_KEY, JSON.stringify(merged));
	} catch {}
}

function normalizePath(pathname) {
	const stripped = String(pathname || '').replace(/\/+$/, '');
	return stripped === '' ? '/' : stripped;
}

function h(tag, attrs = {}, html) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') el.className = v;
		else el.setAttribute(k, v);
	}
	if (html != null) el.innerHTML = html;
	return el;
}

/** Walks `activeElement` across shadow boundaries (the filter/number inputs/theme-name field can
 * each be the "real" focus target several shadow roots deep) to decide whether a keyboard shortcut
 * should be ignored because the user is typing. */
function isTypingTarget() {
	let el = document.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export function initStudioShell() {
	const host = document.querySelector('sl-customizer');
	const svc = host && host.__svc;
	if (!svc) return; // overlay mode, or panel.js failed to init - nothing to build

	const uiState = loadUiState();

	// ===============================================================================================
	// Top bar (S1, S13, S14)
	// ===============================================================================================
	const topbar = document.getElementById('svc-topbar');
	const drawerToggle = h('button', { type: 'button', id: 'svc-drawer-toggle', class: 'svc-tb-btn svc-tb-btn-icon', 'aria-label': 'Toggle controls panel' }, icon('overlay', 18));
	drawerToggle.addEventListener('click', () => {
		const open = host.dataset.drawerOpen !== 'true';
		host.dataset.drawerOpen = String(open);
	});
	topbar.appendChild(drawerToggle);

	const brand = h('div', { class: 'svc-brand' });
	const brandMark = h(
		'span',
		{ class: 'svc-brand-mark' },
		'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.2 6.3L20.5 11.5l-6.3 2.2L12 20l-2.2-6.3L3.5 11.5l6.3-2.2z"/></svg>'
	);
	const brandName = h('span', { class: 'svc-brand-name' }, 'Starlight <b>Studio</b>');
	const brandTag = h('span', { class: 'svc-brand-tag' }, 'C');
	brand.appendChild(brandMark);
	brand.appendChild(brandName);
	brand.appendChild(brandTag);
	topbar.appendChild(brand);

	topbar.appendChild(h('div', { class: 'svc-topbar-sep' }));

	const nameInput = h('input', { id: 'svc-theme-name', type: 'text', 'aria-label': 'Theme name' });
	nameInput.value = svc.getName();
	nameInput.addEventListener('change', () => svc.setName(nameInput.value));
	topbar.appendChild(nameInput);

	const saveStatus = h('span', { id: 'svc-save-status' });
	topbar.appendChild(saveStatus);

	topbar.appendChild(h('div', { class: 'svc-topbar-spacer' }));

	const actions = h('div', { id: 'svc-topbar-actions' });
	const undoBtn = h('button', { type: 'button', class: 'svc-tb-btn svc-tb-btn-icon', title: 'Undo (Ctrl/Cmd+Z)', 'aria-label': 'Undo' }, icon('undo'));
	const redoBtn = h('button', { type: 'button', class: 'svc-tb-btn svc-tb-btn-icon', title: 'Redo (Ctrl/Cmd+Shift+Z)', 'aria-label': 'Redo' }, icon('redo'));
	undoBtn.addEventListener('click', () => svc.undo());
	redoBtn.addEventListener('click', () => svc.redo());
	const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: 'hidden' });
	importInput.addEventListener('change', async () => {
		const file = importInput.files?.[0];
		importInput.value = '';
		if (!file) return;
		try {
			const parsed = JSON.parse(await file.text());
			svc.importState(parsed);
		} catch (err) {
			window.alert(`Could not import state.json: ${err instanceof Error ? err.message : String(err)}`);
		}
	});
	const importBtn = h('button', { type: 'button', class: 'svc-tb-btn' }, `${icon('import')}<span>Import</span>`);
	importBtn.addEventListener('click', () => importInput.click());
	const exportBtn = h('button', { type: 'button', class: 'svc-tb-btn svc-tb-btn-primary' }, `${icon('export')}<span>Export</span>`);
	exportBtn.addEventListener('click', () => svc.openExport());
	actions.appendChild(undoBtn);
	actions.appendChild(redoBtn);
	actions.appendChild(importBtn);
	actions.appendChild(importInput);
	actions.appendChild(exportBtn);
	topbar.appendChild(actions);

	function refreshTopbar() {
		undoBtn.disabled = !svc.canUndo();
		redoBtn.disabled = !svc.canRedo();
		const status = svc.getSaveStatus();
		if (status.ok) {
			saveStatus.textContent = 'Saved locally';
			saveStatus.title = new Date(status.at).toLocaleTimeString();
		} else {
			saveStatus.textContent = 'Not saved (storage blocked)';
			saveStatus.title = '';
		}
		if (document.activeElement !== nameInput) nameInput.value = svc.getName();
	}
	svc.subscribe(refreshTopbar);
	refreshTopbar();

	// Ctrl/Cmd+E opens export (S14); Ctrl/Cmd+Z / Ctrl+Y / Ctrl/Cmd+Shift+Z drive undo/redo (S11) -
	// ignored while typing (advisor trap: walk shadow-root activeElement chains, not just document's).
	document.addEventListener('keydown', (event) => {
		if (isTypingTarget()) return;
		const mod = event.ctrlKey || event.metaKey;
		if (!mod) return;
		const key = event.key.toLowerCase();
		if (key === 'e') {
			event.preventDefault();
			svc.openExport();
		} else if (key === 'z' && event.shiftKey) {
			event.preventDefault();
			svc.redo();
		} else if (key === 'z') {
			event.preventDefault();
			svc.undo();
		} else if (key === 'y') {
			event.preventDefault();
			svc.redo();
		}
	});

	// '\' toggles the panel column collapsed/expanded, ignored while
	// typing - no modifier key, so it must NOT fire inside any text field (unlike the Ctrl/Cmd
	// shortcuts above, a bare '\' is a real character a person could otherwise be typing).
	document.addEventListener('keydown', (event) => {
		if (event.key !== '\\' || event.ctrlKey || event.metaKey || event.altKey) return;
		if (isTypingTarget()) return;
		event.preventDefault();
		svc.togglePanelCollapse();
	});

	// ===============================================================================================
	// Stage: lanes, scaling (S8), Split (S9)
	// ===============================================================================================
	const stage = document.getElementById('svc-stage');
	const laneEls = {
		light: document.querySelector('.svc-lane[data-lane="light"]'),
		dark: document.querySelector('.svc-lane[data-lane="dark"]'),
	};
	const frameEls = {
		light: laneEls.light.querySelector('iframe[data-svc-preview]'),
		dark: laneEls.dark.querySelector('iframe[data-svc-preview]'),
	};

	/** @type {'light'|'dark'|'split'} */
	let mode = ['light', 'dark', 'split'].includes(uiState.mode) ? uiState.mode : 'light';
	/** @type {typeof STUDIO_DEVICES[number]['id']} */
	let deviceId = STUDIO_DEVICES.some((d) => d.id === uiState.device) ? uiState.device : 'fit';
	/** @type {'fit'|number} F2: 'fit' is S8's original behavior (scale the chosen width down to the
	 * column); a number is an explicit zoom fraction from ZOOM_STEPS that overrides it. Has no effect
	 * while deviceId is 'fit' itself (a fluid width has no natural size to zoom relative to). */
	let zoom = ZOOM_STEPS.includes(uiState.zoom) ? uiState.zoom : 'fit';
	let currentPath = loadInitialPagePath();

	/** MutationObservers forcing each lane's `data-theme` while Split is active (S9: "set each
	 * frame's documentElement.dataset.theme after load and hold it"). Cleared/rebuilt on mode change
	 * and on each lane navigation. */
	const forcedThemeObservers = new Map();
	function clearForcedTheme(laneKey) {
		forcedThemeObservers.get(laneKey)?.disconnect();
		forcedThemeObservers.delete(laneKey);
	}
	function forceLaneTheme(laneKey, theme) {
		clearForcedTheme(laneKey);
		const doc = frameEls[laneKey].contentDocument;
		if (!doc || !doc.documentElement) return;
		const apply = () => {
			if (doc.documentElement.dataset.theme !== theme) doc.documentElement.dataset.theme = theme;
		};
		apply();
		const observer = new MutationObserver(apply);
		observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		forcedThemeObservers.set(laneKey, observer);
	}

	function applyMode() {
		const isSplit = mode === 'split';
		stage.dataset.split = String(isSplit);
		laneEls.dark.hidden = !isSplit;
		if (isSplit) {
			// S9: forced lanes must not write starlight-theme to localStorage - handled entirely here
			// (forceLaneTheme only ever touches each doc's own dataset.theme), never via
			// svc.setPreviewTheme (which DOES write localStorage - single-lane modes only).
			if (frameEls.light.contentDocument) forceLaneTheme('light', 'light');
			if (frameEls.dark.contentDocument) forceLaneTheme('dark', 'dark');
		} else {
			clearForcedTheme('light');
			clearForcedTheme('dark');
			svc.setPreviewTheme(mode);
		}
		recomputeAllScales();
	}

	/** @param {'light'|'dark'|'split'} next */
	function setMode(next) {
		mode = next;
		saveUiState({ mode });
		updateModeSeg();
		applyMode();
	}

	/** @param {string} id */
	function setDevice(id) {
		deviceId = id;
		saveUiState({ device: deviceId });
		updateDeviceSeg();
		updateZoomUi();
		recomputeAllScales();
	}

	// ---- Zoom ----
	/** @param {'fit'|number} next */
	function setZoom(next) {
		zoom = next;
		saveUiState({ zoom });
		updateZoomUi();
		recomputeAllScales();
	}
	/** @param {1|-1} dir */
	function stepZoom(dir) {
		const device = STUDIO_DEVICES.find((d) => d.id === deviceId) || STUDIO_DEVICES[0];
		if (!device.width) return; // Fit's fluid width has nothing to zoom relative to
		// A numeric zoom steps from its own current value; 'fit' steps from 100% as a baseline (the
		// natural fit-to-column percentage varies continuously with window size, so there's no single
		// "next step" from it - 100% is a simple, predictable anchor to step away from instead).
		const baseline = typeof zoom === 'number' ? zoom : 1;
		let idx = ZOOM_STEPS.indexOf(baseline);
		if (idx === -1) {
			idx = 0;
			for (let i = 1; i < ZOOM_STEPS.length; i++) {
				if (Math.abs(ZOOM_STEPS[i] - baseline) < Math.abs(ZOOM_STEPS[idx] - baseline)) idx = i;
			}
		}
		const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir));
		setZoom(ZOOM_STEPS[nextIdx]);
	}
	function updateZoomUi() {
		const device = STUDIO_DEVICES.find((d) => d.id === deviceId) || STUDIO_DEVICES[0];
		const disabled = !device.width;
		zoomMinusBtn.disabled = disabled || (typeof zoom === 'number' && zoom <= ZOOM_STEPS[0]);
		zoomPlusBtn.disabled = disabled || (typeof zoom === 'number' && zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]);
		zoomFitBtn.disabled = disabled || zoom === 'fit';
		zoomValueEl.textContent = disabled ? '—' : zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`;
	}

	// ---- scaling (S8) ----
	/** @type {Map<string, ResizeObserver>} */
	const laneResizeObservers = new Map();
	function scaleLane(laneKey) {
		const wrap = laneEls[laneKey].querySelector('.svc-lane-wrap');
		const shell = laneEls[laneKey].querySelector('.svc-lane-shell');
		const frame = frameEls[laneKey];
		const device = STUDIO_DEVICES.find((d) => d.id === deviceId) || STUDIO_DEVICES[0];
		// P8 fix: `.svc-lane-wrap` has its own padding (studio.astro), and `clientWidth`/`clientHeight`
		// include padding - using them directly as "available space" let the shell size itself a few
		// px too WIDE for the wrap's actual CONTENT box, so centering (`justify-content: center`)
		// clipped an equal sliver off each edge under `overflow: hidden` (visible as the scaled page's
		// right edge, e.g. the theme-select chevron, cut off at device 1440 in a 1440px window).
		// Percentage widths (the Fit branch's `100%`) already resolve against the content box per the
		// CSS spec regardless of box-sizing, so only this explicit-pixel path needed the subtraction.
		// `getBoundingClientRect()`, not `clientWidth`/`clientHeight`, for sub-pixel precision -
		// `clientWidth`/`clientHeight` round to the nearest integer, which left up to ~1px of drift
		// between the computed scale/size here and the frame's actual rendered box.
		const wrapCs = getComputedStyle(wrap);
		const wrapRect = wrap.getBoundingClientRect();
		const availW = wrapRect.width - parseFloat(wrapCs.paddingLeft) - parseFloat(wrapCs.paddingRight);
		const availH = wrapRect.height - parseFloat(wrapCs.paddingTop) - parseFloat(wrapCs.paddingBottom);
		if (!device.width) {
			// Fit: no transform at all (S8), the frame just fills the lane.
			shell.style.width = '100%';
			shell.style.height = '100%';
			frame.style.width = '100%';
			frame.style.height = '100%';
			frame.style.transform = '';
			delete frame.dataset.svcScale;
			wrap.dataset.pannable = 'false'; // F2: Fit never needs to pan
			setLaneScaleLabel(laneKey, null);
			return;
		}
		// F2: an explicit zoom overrides S8's original "shrink the chosen width to fit the column"
		// scale; 'fit' (no zoom interaction yet, or "Fit" pressed) keeps that original behavior exactly
		// - `renderedW` below reduces to the old `Math.min(device.width, availW)` in that case.
		const s = typeof zoom === 'number' ? zoom : Math.min(1, availW / device.width);
		const renderedW = device.width * s;
		shell.style.width = `${renderedW}px`;
		shell.style.height = `${availH}px`;
		frame.style.width = `${device.width}px`;
		frame.style.height = `${availH / s}px`;
		// F0 fix: the old `s >= 0.999` one-sided check assumed `s` could never exceed 1 (true before
		// F2's zoom existed) - a zoom of 110-150% (s > 1) hit that branch too and incorrectly cleared
		// the transform, silently un-zooming. An "approximately 1" tolerance on both sides is correct
		// for every s this control can now produce.
		if (Math.abs(s - 1) < 0.001) {
			frame.style.transform = '';
			delete frame.dataset.svcScale;
		} else {
			frame.style.transform = `scale(${s})`;
			frame.dataset.svcScale = String(s);
		}
		// F2: "a zoom larger than fit makes the lane scroll horizontally to pan" - the deliberate,
		// x-axis-only exception to F0's "no host ancestor of the iframe is ever scrollable" rule
		// (studio.astro's `.svc-lane-wrap[data-pannable='true']` rule; overflow-y stays clip always).
		wrap.dataset.pannable = String(renderedW > availW + 0.5);
		setLaneScaleLabel(laneKey, { width: device.width, scale: s });
	}
	function setLaneScaleLabel(laneKey, info) {
		const label = laneEls[laneKey].querySelector('.svc-lane-scale');
		if (!info) {
			label.textContent = '';
			return;
		}
		label.textContent = `${info.width}px · ${Math.round(info.scale * 100)}%`;
	}
	function recomputeAllScales() {
		scaleLane('light');
		if (mode === 'split') scaleLane('dark');
		updateContextScaleLabel();
	}
	for (const laneKey of ['light', 'dark']) {
		const wrap = laneEls[laneKey].querySelector('.svc-lane-wrap');
		const ro = new ResizeObserver(() => {
			if (laneKey === 'dark' && mode !== 'split') return;
			scaleLane(laneKey);
			updateContextScaleLabel();
		});
		ro.observe(wrap);
		laneResizeObservers.set(laneKey, ro);
	}

	function updateContextScaleLabel() {
		const device = STUDIO_DEVICES.find((d) => d.id === deviceId) || STUDIO_DEVICES[0];
		const scaleLabel = document.getElementById('svc-scale-label');
		if (!device.width) {
			scaleLabel.textContent = 'Fit · 100%';
			return;
		}
		const s = Number.parseFloat(frameEls.light.dataset.svcScale || '1');
		scaleLabel.textContent = `${device.width}px · ${Math.round(s * 100)}%`;
	}

	// ---- page navigation (both lanes together, S9) ----
	/** @param {string} path Base-free (this module's own convention). */
	function navigateAll(path) {
		currentPath = path;
		for (const laneKey of ['light', 'dark']) {
			const frame = frameEls[laneKey];
			if (laneKey === 'dark' && mode !== 'split') continue;
			try {
				if (normalizePath(stripBase(frame.contentWindow.location.pathname)) !== normalizePath(path)) frame.contentWindow.location.href = withBase(path);
			} catch {
				frame.src = withBase(path);
			}
		}
		markCurrentPage(path);
		updateUrl(path);
		saveUiState({ studioPage: path });
	}

	/** @param {string} path Base-free - callers below always strip the base before calling this. */
	function onLaneNavigated(laneKey, path) {
		if (laneKey === 'light') {
			currentPath = path;
			markCurrentPage(path);
			updateUrl(path);
			saveUiState({ studioPage: path });
		}
		// S9: "a link click inside either lane navigates the other to the same path."
		if (mode === 'split') {
			const otherKey = laneKey === 'light' ? 'dark' : 'light';
			const otherFrame = frameEls[otherKey];
			try {
				if (normalizePath(stripBase(otherFrame.contentWindow.location.pathname)) !== normalizePath(path)) {
					otherFrame.contentWindow.location.href = withBase(path);
				}
			} catch {
				/* cross-origin/inaccessible momentarily - next explicit navigateAll() call recovers */
			}
			forceLaneTheme(laneKey, laneKey === 'light' ? 'light' : 'dark');
		}
		updateBreadcrumb();
	}

	for (const laneKey of ['light', 'dark']) {
		frameEls[laneKey].addEventListener('load', () => {
			let path = null;
			try {
				// D3a: strip the base immediately on read, so every downstream consumer of `path`
				// (onLaneNavigated, currentPath, sessionStorage, the `?page=` URL) stays base-free.
				path = stripBase(frameEls[laneKey].contentWindow.location.pathname);
			} catch {
				/* cross-origin or mid-navigation */
			}
			if (path) onLaneNavigated(laneKey, path);
			recomputeAllScales();
			if (mode === 'split') forceLaneTheme(laneKey, laneKey === 'light' ? 'light' : 'dark');
		});
	}

	function updateBreadcrumb() {
		const crumb = document.getElementById('svc-breadcrumb');
		const segments = currentPath.split('/').filter(Boolean);
		const labels = segments.map((s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
		// The last segment is the page itself: prefer its own title (the frame's <h1>) so the crumb
		// matches what the page says (e.g. "Style guide" for /specimen/), falling back to the URL.
		try {
			const pageTitle = frameEls.light?.contentDocument?.querySelector('main h1, h1')?.textContent?.trim();
			if (pageTitle && labels.length) labels[labels.length - 1] = pageTitle;
		} catch {
			/* frame mid-navigation - the URL-derived label stays */
		}
		crumb.textContent = labels.length ? labels.join(' / ') : 'Home';
	}

	// ===============================================================================================
	// Toolbar (S6)
	// ===============================================================================================
	const toolbar = document.getElementById('svc-toolbar');
	const pageTabs = h('div', { class: 'svc-page-tabs', role: 'group', 'aria-label': 'Page' });
	/** @type {Map<string, HTMLButtonElement>} */
	const pageButtons = new Map();
	for (const page of STUDIO_PAGES) {
		const btn = h('button', { type: 'button', class: 'svc-page-tab', 'aria-selected': 'false' }, `${icon(page.icon, 15)}<span>${page.label}</span>`);
		btn.addEventListener('click', () => navigateAll(page.path));
		pageButtons.set(page.id, btn);
		pageTabs.appendChild(btn);
	}
	const otherLabel = h('span', { class: 'svc-page-other', hidden: 'hidden' });
	pageTabs.appendChild(otherLabel);
	toolbar.appendChild(pageTabs);

	const toolbarRight = h('div', { class: 'svc-toolbar-right' });

	const modeSeg = h('div', { class: 'svc-seg', role: 'group', 'aria-label': 'Preview mode' });
	const modeButtons = new Map();
	for (const [id, label, iconName] of [
		['light', 'Light', 'sun'],
		['dark', 'Dark', 'moon'],
		['split', 'Split', 'split'],
	]) {
		const btn = h('button', { type: 'button', class: 'svc-seg-btn', 'aria-pressed': 'false' }, `${icon(iconName, 14)}<span>${label}</span>`);
		btn.addEventListener('click', () => setMode(id));
		modeSeg.appendChild(btn);
		modeButtons.set(id, btn);
	}
	function updateModeSeg() {
		for (const [id, btn] of modeButtons) btn.setAttribute('aria-pressed', String(id === mode));
	}
	toolbarRight.appendChild(modeSeg);

	const deviceSeg = h('div', { class: 'svc-seg', role: 'group', 'aria-label': 'Device width' });
	const deviceButtons = new Map();
	// Wide/Ultra-wide get their own distinct silhouettes; Laptop 1280
	// and Desktop 1440 share `desktop` (the title tooltip's own width already tells them apart).
	const deviceIcons = { fit: 'fit', '1280': 'desktop', '1440': 'desktop', '1920': 'wide', '2560': 'ultrawide', tablet: 'tablet', mobile: 'mobile' };
	for (const device of STUDIO_DEVICES) {
		const btn = h('button', { type: 'button', class: 'svc-seg-btn', 'aria-pressed': 'false', title: device.width ? `${device.width}px` : 'Fills the available width' }, icon(deviceIcons[device.id], 14));
		btn.addEventListener('click', () => setDevice(device.id));
		deviceSeg.appendChild(btn);
		deviceButtons.set(device.id, btn);
	}
	function updateDeviceSeg() {
		for (const [id, btn] of deviceButtons) btn.setAttribute('aria-pressed', String(id === deviceId));
	}
	toolbarRight.appendChild(deviceSeg);

	// ---- Zoom control - minus, current percentage, plus, Fit. ----
	const zoomSeg = h('div', { class: 'svc-seg svc-zoom-seg', role: 'group', 'aria-label': 'Zoom' });
	const zoomMinusBtn = h('button', { type: 'button', class: 'svc-seg-btn', 'aria-label': 'Zoom out' }, '−');
	const zoomValueEl = h('span', { class: 'svc-zoom-value' });
	const zoomPlusBtn = h('button', { type: 'button', class: 'svc-seg-btn', 'aria-label': 'Zoom in' }, '+');
	const zoomFitBtn = h('button', { type: 'button', class: 'svc-seg-btn svc-zoom-fit', 'aria-label': 'Zoom to fit' }, 'Fit');
	zoomMinusBtn.addEventListener('click', () => stepZoom(-1));
	zoomPlusBtn.addEventListener('click', () => stepZoom(1));
	zoomFitBtn.addEventListener('click', () => setZoom('fit'));
	zoomSeg.appendChild(zoomMinusBtn);
	zoomSeg.appendChild(zoomValueEl);
	zoomSeg.appendChild(zoomPlusBtn);
	zoomSeg.appendChild(zoomFitBtn);
	toolbarRight.appendChild(zoomSeg);

	// The overlay panel is retired from the studio's own UI - the two
	// top-right icons used to open a different UX, and "Open in new
	// tab" alone now covers "see this page outside the studio" (the visitor-mode page, complete with
	// its own "Open in Studio" pill to come back). The overlay stays reachable only behind the
	// `?svc-overlay` URL flag (panel.js's overlay-mount gate), used solely by the engine test suites.
	const newTabLink = h('a', { class: 'svc-icon-link', target: '_blank', rel: 'noopener', title: 'Open in new tab', 'aria-label': 'Open in new tab' }, icon('newtab', 16));
	toolbarRight.appendChild(newTabLink);

	toolbar.appendChild(toolbarRight);

	function markCurrentPage(path) {
		const norm = normalizePath(path);
		let matched = null;
		for (const page of STUDIO_PAGES) {
			const isCurrent = normalizePath(page.path) === norm;
			if (isCurrent) matched = page;
			const btn = pageButtons.get(page.id);
			btn.setAttribute('aria-selected', String(isCurrent));
		}
		otherLabel.hidden = !!matched;
		if (!matched) otherLabel.textContent = `Other: ${path}`;
		newTabLink.href = `${withBase(path)}?view`;
	}

	// ===============================================================================================
	// Context line (S7)
	// ===============================================================================================
	const contextLine = document.getElementById('svc-context-line');
	const breadcrumbEl = h('span', { id: 'svc-breadcrumb' });
	const contextRight = h('span', { id: 'svc-context-right' });
	contextRight.innerHTML = `<span>Real Starlight ${STARLIGHT_VERSION} build · CSS live</span>`;
	const scaleLabelEl = h('span', { id: 'svc-scale-label' });
	contextRight.appendChild(scaleLabelEl);
	contextLine.appendChild(breadcrumbEl);
	contextLine.appendChild(contextRight);

	// ===============================================================================================
	// Status bar (S12)
	// ===============================================================================================
	const statusbar = document.getElementById('svc-statusbar');
	const statusLeft = h('span', { id: 'svc-status-left' });
	const statusMid = h('button', { type: 'button', id: 'svc-status-mid' });
	const statusRight = h('span', { id: 'svc-status-right' });
	statusRight.innerHTML = `<span>Starlight ${STARLIGHT_VERSION}</span><span class="svc-legend-chip">CSS · live</span><span class="svc-legend-chip">Config · on export</span>`;
	statusbar.appendChild(statusLeft);
	statusbar.appendChild(statusMid);
	statusbar.appendChild(statusRight);

	// S12: the dialog itself lives in panel.js's shadow root (it reuses the export dialog's
	// `.svc-dialog*` CSS, which only applies inside that shadow root - see panel.js's comment).
	statusMid.addEventListener('click', () => svc.openContrastDialog());

	function refreshStatusBar() {
		const n = svc.getChangeCount();
		statusLeft.textContent = `${n} change${n === 1 ? '' : 's'} from Starlight default`;
		const report = svc.getContrastReport();
		if (report.allPass) {
			statusMid.textContent = 'Text pairs meet AA (light + dark)';
			statusMid.classList.remove('svc-status-warn');
		} else {
			const warnCount = report.rows.filter((r) => !r.pass).length;
			statusMid.textContent = `${warnCount} contrast warning${warnCount === 1 ? '' : 's'}`;
			statusMid.classList.add('svc-status-warn');
		}
	}
	svc.subscribe(refreshStatusBar);

	// ===============================================================================================
	// Initial state
	// ===============================================================================================
	function loadInitialPagePath() {
		try {
			const fromUrl = new URL(location.href).searchParams.get('page');
			if (fromUrl && fromUrl.startsWith('/')) return fromUrl;
		} catch {}
		const fromSession = loadUiState().studioPage;
		if (typeof fromSession === 'string' && fromSession.startsWith('/')) return fromSession;
		return DEFAULT_PAGE_PATH;
	}
	function updateUrl(path) {
		try {
			history.replaceState(null, '', `${location.pathname}?page=${path}`);
		} catch {}
	}

	updateModeSeg();
	updateDeviceSeg();
	updateZoomUi();
	markCurrentPage(currentPath);
	updateUrl(currentPath);
	updateBreadcrumb();
	// D3a: studio.astro's own initial `src="..."` markup is already base-included (it renders through
	// this same `withBase()` at Astro build/render time) - strip it back off before comparing against
	// `currentPath` (base-free), and re-add it if a different page needs loading.
	if (normalizePath(stripBase(frameEls.light.getAttribute('src') || '')) !== normalizePath(currentPath)) {
		frameEls.light.src = withBase(currentPath);
	}
	applyMode();
	refreshStatusBar();

	// Below 900px the panel column is a drawer (S1) - closed by default there so the rail+stage are
	// the initial view; at/above 900px it's always shown (data-drawer-open is irrelevant there - the
	// CSS media query only reacts to it under 900px). Only reset on actually CROSSING the 900px
	// breakpoint (not on every resize event) - otherwise a manual toggle while already narrow (e.g.
	// opening the drawer, then a small resize still under 900px) would get silently undone.
	let wasWide = window.innerWidth >= 900;
	host.dataset.drawerOpen = String(wasWide);
	window.addEventListener('resize', () => {
		const isWide = window.innerWidth >= 900;
		if (isWide !== wasWide) {
			wasWide = isWide;
			host.dataset.drawerOpen = String(isWide);
		}
	});
}
