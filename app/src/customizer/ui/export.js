/**
 * @file Export dialog (a modal rendered inside the customizer's shadow root): `theme.css`
 * (`emitCss(state)`, NOT `{forPreview:true}` - the real, distributable stylesheet),
 * `APPLY-THEME.md` (`emitApplyTheme(state)`), and `state.json` (the raw `ThemeState`), each with
 * Copy/Download, plus "Copy share link" and "Import state.json". Also: a "Download all (.zip)"
 * button (bundles the same three files via `fflate`) and a "Screenshot (PNG)" section (captures the
 * primary preview lane via `modern-screenshot`, dynamically imported only when clicked).
 *
 * SPEC-C S14: in studio mode this renders in Codex's two-pane shape - a file list (with sizes) on
 * the left, the selected file's content (with Copy/Download) on the right - instead of B's top tab
 * strip. Both navigation UIs are built (small, and they drive the exact same `selectTab`/textareas),
 * `dialog.dataset.shape` picks which one is visible via `styles.js`'s docked-scoped
 * `.svc-dialog[data-shape='files']` rules; overlay mode (S16) always gets `data-shape='tabs'`, the
 * same DOM/behavior as before.
 */
import { zipSync, strToU8 } from 'fflate';
import { emitCss } from '../core/emit-css.js';
import { emitApplyTheme } from '../core/emit-apply.js';
import { encodeState, getName } from '../core/state.js';
import { isStudio, getPageDoc, getPageWin } from './page-doc.js';

/** @param {number} bytes @returns {string} e.g. "1.2 KB" - matches Codex's file-list sizing display. */
function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function textButton(label, onClick) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'svc-btn';
	btn.textContent = label;
	btn.addEventListener('click', onClick);
	return btn;
}

function flash(btn, text, revertMs = 1200) {
	const original = btn.textContent;
	btn.textContent = text;
	setTimeout(() => {
		btn.textContent = original;
	}, revertMs);
}

/** @param {string} filename @param {Blob} blob */
function downloadBlob(filename, blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function downloadText(filename, text) {
	downloadBlob(filename, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

async function copyToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/** Lowercase, hyphenated slug of the theme name for export filenames (item 2/3), matching
 * `core/ia.js`'s own slugify shape but with this feature's own fallback. @param {string} name */
function slugifyThemeName(name) {
	const s = String(name ?? '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return s || 'starlight-theme';
}

/** @param {string} pathname e.g. "/specimen/" @returns {string} e.g. "specimen"; "/" -> "landing" */
function pageSlugFromPath(pathname) {
	const trimmed = String(pathname || '/').replace(/^\/+|\/+$/g, '');
	return trimmed ? trimmed.split('/').pop() : 'landing';
}

/**
 * Item 2: one zip containing the same three files the dialog shows, byte-identical to what
 * Copy/Download already use for each - built from the already-refreshed textareas, never
 * re-derived, so "exactly the contents the dialog shows" holds by construction.
 * @param {{id:string, filename:string}[]} tabDefs
 * @param {Record<string, HTMLTextAreaElement>} textareas
 * @returns {Blob}
 */
function buildExportZipBlob(tabDefs, textareas) {
	/** @type {Record<string, Uint8Array>} */
	const files = {};
	for (const def of tabDefs) files[def.filename] = strToU8(textareas[def.id].value);
	const zipped = zipSync(files);
	return new Blob([zipped], { type: 'application/zip' });
}

/** Throwaway attribute (requirement 2/5): records a live `<select>`'s current `.value` so
 * `onCloneEachNode` can fix up the CLONE's `<option>`s without ever touching the live `<option>`
 * elements' own `selected` attribute - see `capturePageScreenshot`'s doc comment. A brand-new
 * attribute that gets added then removed leaves every pre-existing attribute (name, value, AND
 * order) untouched, which a remove-then-re-add of an EXISTING attribute (e.g. `selected`) cannot
 * guarantee, since re-adding always appends at the end of the attribute list. */
const SELECT_VALUE_MARK = 'data-svc-shot-select-value';

/** @param {Document} doc @returns {HTMLSelectElement[]} */
function markSelectsForClone(doc) {
	/** @type {HTMLSelectElement[]} */
	const marked = [];
	for (const select of doc.body.querySelectorAll('select')) {
		select.setAttribute(SELECT_VALUE_MARK, select.value);
		marked.push(select);
	}
	return marked;
}

/** @param {HTMLSelectElement[]} marked */
function unmarkSelectsAfterClone(marked) {
	for (const select of marked) select.removeAttribute(SELECT_VALUE_MARK);
}

/**
 * Item 3: screenshot the primary preview lane's page (`page-doc.js`'s `getPageDoc()`/`getPageWin()`)
 * at its natural width W, current light/dark mode, current theme - `modern-screenshot` is dynamically
 * imported here so it costs nothing on a normal page load.
 *
 * "Full page" renders the whole document top-to-bottom in one pass (`height` = full scroll height);
 * Starlight's header/sidebar/right-TOC are all `position: fixed` (verified against the installed
 * 0.42.4 sources - `dist/style/*.css` is byte-identical to 0.42.3, so this still holds), so -
 * exactly like a browser's own full-page screenshot algorithm - they render
 * once, pinned to the top of that tall render, never repeated.
 *
 * "Visible area" needs the CURRENT scroll position with the fixed header/sidebar/TOC still pinned at
 * their on-screen spot (as a visitor sees it), not sitting at the top of an unscrolled render. This
 * library clones the live DOM into an SVG `foreignObject` sized to `width`x`height` and renders that;
 * shifting the whole clone up by `scrollY` (the documented way to crop a sub-range, per the library's
 * own "render in sections" pattern) would drag every `position: fixed` element up with it too, since
 * a CSS transform on an ancestor becomes that fixed element's containing block. So: before capture,
 * mark every element that is ACTUALLY `position: fixed` in the live page with a throwaway attribute;
 * in `onCloneEachNode` (given only the clone, never the original - the attribute is what survives
 * `cloneNode` and lets it self-identify), add a compensating `translateY(+scrollY)` so it lands back
 * at its true on-screen position once the shared ancestor shift is undone for everything else.
 *
 * The capture root is `doc.body`, NOT `doc.documentElement`: in standards-mode HTML,
 * `documentElement` (`<html>`) is the element the page actually scrolls (its `scrollTop` mirrors
 * `window.scrollY`), while `body`'s own `scrollTop` is always 0. The library's own
 * `features.restoreScrollPosition` (kept on, for free fidelity on any element with a GENUINE inner
 * scroll, e.g. the sidebar nav's own overflow) shifts each cloned node by ITS OWN live `scrollTop` -
 * rooting at `documentElement` fed it `window.scrollY` a SECOND time on top of this function's own
 * compensating transform (double-shifted the page, pushed the fixed header/sidebar off-canvas
 * entirely - caught by looking at the produced PNGs next to a live capture, not by the automated
 * dimension checks, which happily passed on the wrong image). Rooting at `body` sidesteps this: its
 * own scrollTop is always 0, so only real inner-scrolled descendants get touched.
 *
 * W9a fix - the blank sidebar/TOC bug: the compensating `translateY(+scrollY)` above was built as
 * `prev ? \`translateY(${scrollY}px) ${prev}\` : \`translateY(${scrollY}px)\`` , where `prev` is
 * whatever `el.style.transform` already reads on the clone. That is safe when `prev` is empty, but
 * `modern-screenshot`'s own `copyCssStyles` step (which runs before `onCloneEachNode`, and copies
 * each cloned node's computed style as an inline style, diffed against a generic default instance of
 * the same tag) sets `prev` to the STRING `"none"` - not `""` - for exactly `.sidebar-pane` and
 * `.right-sidebar` (their diff against a default element includes `transform` even though there's no
 * real transform; `.header` and the skip-link's diff doesn't, by whatever quirk of that comparison,
 * so they read `prev === ""` and never hit this). `"none"` is truthy, so those two elements got
 * `transform: "translateY(2400px) none"` - a single CSS `<transform-list>` value can never mix a
 * function with the `none` keyword, so the browser's CSSOM setter silently REJECTS the whole
 * assignment and leaves `transform: none` in place. With no compensating shift, the sidebar and TOC
 * stayed offset by the ancestor's `translateY(-scrollY)` - at scrollY 2400 against an ~800-1000px
 * viewport, that pushes them entirely outside the rendered box, i.e. blank. (Confirmed empirically:
 * instrumenting `onCloneEachNode` showed `el.style.transform` reading back unchanged, exactly for the
 * elements whose `prev` was `"none"`, and only those.) Fix: treat `"none"` the same as no existing
 * transform - see `existingTransform` below.
 *
 * W9a fix - the `<select>`'s wrong value: `modern-screenshot`'s `copyInputValue` sets a `value`
 * *attribute* on cloned `<input>`/`<textarea>`/`<select>` elements, but `<select>` has no such
 * attribute - which option renders as chosen is driven purely by which `<option>` carries the
 * `selected` *content attribute*, copied verbatim from the live option by the native `cloneNode`.
 * Starlight's `ThemeSelect.astro` always marks the `auto` option `selected` in its SSR markup;
 * switching the theme at runtime (`select.value = ...` / `option.selected = true`) changes the LIVE
 * selectedness but never rewrites that content attribute, so a clone always shows the SSR default
 * ("Auto") regardless of the page's actual theme. Fix: before capture, mark every live `<select>`
 * with its current `.value` (`markSelectsForClone`); in `onCloneEachNode`, once a marked select's
 * `<option>` clones are attached (children are cloned before `onCloneEachNode` fires for their
 * parent), set `selected` on the one matching option clone and clear it from the rest. This touches
 * only the CLONE's `<option>`s, never the live ones, so there's nothing to restore on them at all.
 *
 * W9a fix - the three page errors: Starlight's `<site-search>` (and a couple of other inline-script
 * custom elements) read `this.querySelector(...)` synchronously in their constructor and call a
 * method on the result without a null check. `modern-screenshot` clones every element (including
 * already-upgraded custom elements) via a shallow, native `node.cloneNode(false)`; per the custom
 * element spec this re-invokes the constructor on the new (still childless) clone, so those
 * `querySelector` calls return `null` and the follow-on call throws. The browser's own "create an
 * element" algorithm already catches that exception (it substitutes a plain unknown-element stand-in
 * and reports the error) - rendering isn't affected: this library's `cloneChildNodes` walk populates
 * the clone's children itself, independent of whether the native upgrade succeeded, and CSS matches
 * on tag/class regardless of the JS interface behind it. There's no public API to opt an element out
 * of the custom-element-upgrade-on-clone behavior (it's a synchronous, unconditional step of
 * `cloneNode`'s own spec algorithm), so preventing the throw itself isn't cheap - but the resulting
 * `error` event IS cancelable (that's what "report the exception" fires), and cancelling it suppresses
 * the browser's console logging without changing anything about the capture. So: install a scoped
 * `error` listener for the duration of the capture only - round 2: narrowed to only the specific
 * known message shapes this failure mode produces (`KNOWN_CLONE_ERROR_FRAGMENTS` below), so a real,
 * unrelated error during the same window still surfaces normally instead of being silently eaten; the
 * number actually suppressed is logged once via `console.info` after the capture finishes.
 * @param {'visible'|'full'} kind
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
async function capturePageScreenshot(kind) {
	const { domToBlob } = await import('modern-screenshot');
	const doc = getPageDoc();
	const win = getPageWin();
	if (!doc || !win || !doc.body) throw new Error('The preview page is not available right now.');
	if (doc.fonts && doc.fonts.ready) {
		try {
			await doc.fonts.ready;
		} catch {
			/* best-effort - proceed with whatever is loaded */
		}
	}

	const width = Math.max(1, Math.round(win.innerWidth));
	const viewportHeight = Math.max(1, Math.round(win.innerHeight));
	const fullHeight = Math.max(1, Math.round(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)));
	const scrollY = win.scrollY || doc.documentElement.scrollTop || 0;
	const height = kind === 'full' ? fullHeight : viewportHeight;
	const shiftFixed = kind === 'visible' && scrollY > 0;

	const FIXED_MARK = 'data-svc-shot-fixed';
	/** @type {Element[]} */
	const marked = [];
	if (shiftFixed) {
		for (const el of doc.body.querySelectorAll('*')) {
			if (win.getComputedStyle(el).position === 'fixed') {
				el.setAttribute(FIXED_MARK, '1');
				marked.push(el);
			}
		}
	}

	const bg = win.getComputedStyle(doc.body).backgroundColor || win.getComputedStyle(doc.documentElement).backgroundColor || '#ffffff';

	// Requirement 2: make every <select> (theme, language) clone show its LIVE value, not
	// whatever SSR marked `selected` in the static markup - see the doc comment above.
	const markedSelects = markSelectsForClone(doc);

	// Requirement 4 (round 2 - narrowed): only the specific, known clone-time failures get
	// suppressed (custom element constructors re-running on a still-childless shallow clone - see
	// the doc comment above); anything else propagates and logs normally, so a REAL bug during a
	// capture is never silently hidden. Counted and reported once, after the capture, rather than
	// swallowed outright.
	const KNOWN_CLONE_ERROR_FRAGMENTS = ["reading 'addEventListener'", "reading 'querySelectorAll'"];
	let suppressedErrorCount = 0;
	/** @param {ErrorEvent} event */
	const suppressCloneErrors = (event) => {
		const msg = event?.message || event?.error?.message || '';
		if (KNOWN_CLONE_ERROR_FRAGMENTS.some((fragment) => msg.includes(fragment))) {
			suppressedErrorCount++;
			event.preventDefault();
		}
	};
	win.addEventListener('error', suppressCloneErrors, true);

	try {
		const blob = await domToBlob(doc.body, {
			width,
			height,
			scale: 1, // never devicePixelRatio-scale - the PNG's own pixel dimensions must equal W (and the frame's height)
			backgroundColor: bg,
			features: { restoreScrollPosition: true }, // honors any element with its OWN internal scroll (e.g. an overflowing sidebar)
			// W9a round 2 - the ~8px offset bug: `modern-screenshot` unconditionally strips every
			// margin-* longhand from the capture ROOT's copied inline style (`copyCssStyles`'s
			// `if (isRoot) { style.delete('margin-top'); ... }`), on the assumption that a typical
			// capture root's own page-context margin shouldn't push the render around inside the
			// image. The render target is an SVG `foreignObject` serialized to a data URI and decoded
			// as an isolated image resource - NONE of the live document's stylesheets apply there
			// (that's why `copyCssStyles` bothers copying every computed property inline at all); only
			// the browser's own UA default stylesheet plus whatever inline styles this library set. Our
			// root IS `doc.body`, and the UA default stylesheet's `body { margin: 8px }` rule still
			// matches a bare `<body>` tag with no inline margin override - so every capture rendered
			// with a full 8px margin at the top-left that the live page never had (Starlight's own
			// reset.css zeroes it there, but that stylesheet doesn't exist inside the foreignObject).
			// Overriding `margin` here (applied via `applyCssStyleWithOptions`, which runs AFTER
			// `copyCssStyles` stripped the diffed value) fixes it for every capture, not just the
			// scrolled/shiftFixed case - Full page hit the exact same 8px offset at scroll 0.
			style: { margin: '0', ...(shiftFixed ? { transform: `translateY(-${scrollY}px)` } : {}) },
			onCloneEachNode(cloned) {
				if (cloned.nodeType !== 1) return cloned;
				const el = /** @type {HTMLElement} */ (cloned);
				if (shiftFixed && el.hasAttribute?.(FIXED_MARK)) {
					// `copyCssStyles` may have already set `transform: none` inline (see doc comment) -
					// "none" can't be combined with a translate() in one value, so treat it as empty.
					const prev = el.style.transform;
					const existingTransform = prev && prev !== 'none' ? prev : '';
					el.style.transform = existingTransform ? `translateY(${scrollY}px) ${existingTransform}` : `translateY(${scrollY}px)`;
				}
				if (el.tagName === 'SELECT' && el.hasAttribute(SELECT_VALUE_MARK)) {
					const value = el.getAttribute(SELECT_VALUE_MARK);
					el.removeAttribute(SELECT_VALUE_MARK);
					for (const option of /** @type {HTMLSelectElement} */ (el).options) {
						if (option.value === value) option.setAttribute('selected', '');
						else option.removeAttribute('selected');
					}
				}
				return cloned;
			},
		});
		return { blob, width, height };
	} finally {
		win.removeEventListener('error', suppressCloneErrors, true);
		if (suppressedErrorCount > 0) {
			console.info(`[svc] screenshot: suppressed ${suppressedErrorCount} error(s) from cloned custom elements`);
		}
		unmarkSelectsAfterClone(markedSelects);
		for (const el of marked) el.removeAttribute(FIXED_MARK);
	}
}

/**
 * @param {{getState: () => import('../core/state.js').ThemeState, onImportState: (parsed: any) => void}} handlers
 * @returns {{root: HTMLElement, open: () => void, close: () => void}}
 */
export function createExportDialog(handlers) {
	const backdrop = document.createElement('div');
	backdrop.className = 'svc-dialog-backdrop';
	backdrop.hidden = true;
	backdrop.addEventListener('click', (event) => {
		if (event.target === backdrop) close();
	});
	backdrop.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') close();
	});

	const dialog = document.createElement('div');
	dialog.className = 'svc-dialog';
	dialog.dataset.shape = isStudio() ? 'files' : 'tabs';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Export theme');
	backdrop.appendChild(dialog);

	const tabDefs = [
		{ id: 'css', label: 'theme.css', filename: 'theme.css' },
		{ id: 'apply', label: 'APPLY-THEME.md', filename: 'APPLY-THEME.md' },
		{ id: 'json', label: 'state.json', filename: 'starlight-theme.json' },
	];
	/** @type {Record<string, HTMLTextAreaElement>} */
	const textareas = {};
	/** @type {{id:string, btn:HTMLElement, panel:HTMLElement, fileItem:HTMLElement, sizeEl:HTMLElement}[]} */
	const tabs = [];

	// ---- One shared header (title + close) for both shapes. ----
	const header = document.createElement('div');
	header.className = 'svc-dialog-header';
	const titleEl = document.createElement('h3');
	titleEl.textContent = 'Export';
	header.appendChild(titleEl);
	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'svc-icon-btn';
	closeBtn.textContent = '✕';
	closeBtn.setAttribute('aria-label', 'Close export dialog');
	closeBtn.addEventListener('click', () => close());
	header.appendChild(closeBtn);
	dialog.appendChild(header);

	// ---- Overlay shape: a top tab strip above the tab panels (B's original layout, unchanged). ----
	const tabsBar = document.createElement('div');
	tabsBar.className = 'svc-tabs';
	tabsBar.setAttribute('role', 'tablist');

	// ---- Studio (Codex) shape: a row of [file list | file pane] below the shared header. ----
	const filesRow = document.createElement('div');
	filesRow.className = 'svc-files-row';
	const fileList = document.createElement('div');
	fileList.className = 'svc-file-list';
	fileList.setAttribute('role', 'tablist');
	fileList.setAttribute('aria-label', 'Export files');
	const filePane = document.createElement('div');
	filePane.className = 'svc-file-pane';

	const panelsWrap = document.createElement('div');
	panelsWrap.className = 'svc-tab-panels';

	if (isStudio()) {
		filesRow.appendChild(fileList);
		filePane.appendChild(panelsWrap);
		filesRow.appendChild(filePane);
		dialog.appendChild(filesRow);
	} else {
		dialog.appendChild(tabsBar);
		dialog.appendChild(panelsWrap);
	}

	for (const def of tabDefs) {
		// Tab-strip button (overlay).
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'svc-tab';
		btn.textContent = def.label;
		btn.setAttribute('role', 'tab');
		btn.addEventListener('click', () => selectTab(def.id));
		tabsBar.appendChild(btn);

		// File-list item (studio).
		const fileItem = document.createElement('button');
		fileItem.type = 'button';
		fileItem.className = 'svc-file-item';
		fileItem.setAttribute('role', 'tab');
		const nameEl = document.createElement('span');
		nameEl.className = 'svc-file-item-name';
		nameEl.textContent = def.label;
		const sizeEl = document.createElement('span');
		sizeEl.className = 'svc-file-item-size';
		fileItem.appendChild(nameEl);
		fileItem.appendChild(sizeEl);
		fileItem.addEventListener('click', () => selectTab(def.id));
		fileList.appendChild(fileItem);

		const panel = document.createElement('div');
		panel.className = 'svc-tab-panel';
		const textarea = document.createElement('textarea');
		textarea.className = 'svc-export-textarea';
		textarea.readOnly = true;
		textarea.setAttribute('aria-label', def.label);
		textareas[def.id] = textarea;
		panel.appendChild(textarea);

		const actions = document.createElement('div');
		actions.className = 'svc-ia-import-actions svc-file-pane-actions';
		const copyBtn = textButton('Copy', async () => {
			const ok = await copyToClipboard(textarea.value);
			flash(copyBtn, ok ? 'Copied!' : 'Copy failed');
		});
		const downloadBtn = textButton('Download', () => downloadText(def.filename, textarea.value));
		actions.appendChild(copyBtn);
		actions.appendChild(downloadBtn);
		panel.appendChild(actions);
		panelsWrap.appendChild(panel);

		tabs.push({ id: def.id, btn, panel, fileItem, sizeEl });
	}

	function selectTab(id) {
		for (const tab of tabs) {
			const active = tab.id === id;
			tab.btn.setAttribute('aria-selected', String(active));
			tab.fileItem.setAttribute('aria-selected', String(active));
			tab.panel.dataset.active = String(active);
		}
	}
	selectTab('css');

	// ---- Item 2/3: "Download all (.zip)" and the "Screenshot (PNG)" section - shared by both
	// dialog shapes, sitting between the file view and the footer's share/import row. ----
	const extra = document.createElement('div');
	extra.className = 'svc-export-extra';

	const zipRow = document.createElement('div');
	zipRow.className = 'svc-export-extra-row';
	const zipBtn = textButton('Download all (.zip)', () => {
		try {
			const slug = slugifyThemeName(getName(handlers.getState()));
			downloadBlob(`${slug}.zip`, buildExportZipBlob(tabDefs, textareas));
		} catch (err) {
			window.alert(`Could not build the zip: ${err instanceof Error ? err.message : String(err)}`);
		}
	});
	zipBtn.classList.add('svc-btn-primary', 'svc-export-zip-btn');
	zipRow.appendChild(zipBtn);
	extra.appendChild(zipRow);

	const shotRow = document.createElement('div');
	shotRow.className = 'svc-export-extra-row svc-export-screenshot';
	const shotLabel = document.createElement('span');
	shotLabel.className = 'svc-export-extra-label';
	shotLabel.textContent = 'Screenshot (PNG)';
	shotRow.appendChild(shotLabel);

	const shotButtons = document.createElement('div');
	shotButtons.className = 'svc-export-extra-buttons';

	/** @param {'visible'|'full'} kind @param {HTMLButtonElement} btn */
	async function handleScreenshot(kind, btn) {
		const original = btn.textContent;
		// `btn` has focus (a real click always focuses the button it lands on) when this starts.
		// Disabling a focused element unfocuses it (focus moves off to nothing in particular, usually
		// the document body) - browsers never restore it just because the element becomes enabled
		// again. Left alone, that silently breaks Escape-to-close afterward: the dialog's own keydown
		// listener lives on the backdrop and only fires for events that bubble through it, so once
		// focus has drifted outside the dialog, Escape does nothing and a later click can land on the
		// backdrop instead of whatever the caller expected. Re-focusing the button once it's usable
		// again (below) keeps the dialog's normal keyboard behavior intact through a long capture.
		btn.disabled = true;
		btn.textContent = 'Rendering…';
		try {
			const { blob, width, height } = await capturePageScreenshot(kind);
			const state = handlers.getState();
			const slug = slugifyThemeName(getName(state));
			const doc = getPageDoc();
			const pageSlug = pageSlugFromPath(doc?.location?.pathname);
			const mode = doc?.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light';
			downloadBlob(`${slug}-${pageSlug}-${mode}-${width}.png`, blob);
			void height; // captured for completeness/logging only - not part of the filename (spec's own example)
		} catch (err) {
			window.alert(`Could not create the screenshot: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			btn.disabled = false;
			btn.textContent = original;
			btn.focus();
		}
	}
	const visibleBtn = textButton('Visible area', (event) => handleScreenshot('visible', event.currentTarget));
	visibleBtn.classList.add('svc-export-shot-visible-btn');
	const fullBtn = textButton('Full page', (event) => handleScreenshot('full', event.currentTarget));
	fullBtn.classList.add('svc-export-shot-full-btn');
	shotButtons.appendChild(visibleBtn);
	shotButtons.appendChild(fullBtn);
	shotRow.appendChild(shotButtons);
	extra.appendChild(shotRow);

	const shotHint = document.createElement('p');
	shotHint.className = 'svc-export-hint';
	shotHint.textContent = 'Rendered from the page DOM, not a browser screenshot - effects like backdrop blur and sticky-positioned bars may not match exactly.';
	extra.appendChild(shotHint);

	dialog.appendChild(extra);

	const footer = document.createElement('div');
	footer.className = 'svc-dialog-footer';
	const shareBtn = textButton('Copy share link', async () => {
		const state = handlers.getState();
		const url = `${location.origin}${location.pathname}#svc=${encodeState(state)}`;
		const ok = await copyToClipboard(url);
		flash(shareBtn, ok ? 'Link copied!' : 'Copy failed');
	});
	footer.appendChild(shareBtn);

	const importLabel = document.createElement('label');
	importLabel.className = 'svc-btn';
	importLabel.textContent = 'Import state.json';
	const fileInput = document.createElement('input');
	fileInput.type = 'file';
	fileInput.accept = 'application/json,.json';
	fileInput.hidden = true;
	fileInput.addEventListener('change', async () => {
		const file = fileInput.files?.[0];
		fileInput.value = '';
		if (!file) return;
		try {
			const text = await file.text();
			const parsed = JSON.parse(text);
			handlers.onImportState(parsed);
			refresh(handlers.getState());
		} catch (err) {
			window.alert(`Could not import state.json: ${err instanceof Error ? err.message : String(err)}`);
		}
	});
	importLabel.appendChild(fileInput);
	footer.appendChild(importLabel);
	dialog.appendChild(footer);

	/** @param {import('../core/state.js').ThemeState} state */
	function refresh(state) {
		textareas.css.value = emitCss(state);
		textareas.apply.value = emitApplyTheme(state);
		textareas.json.value = JSON.stringify(state, null, 2);
		// S14: "file list on the left ... with sizes" - byte length of what Copy/Download actually use.
		for (const tab of tabs) tab.sizeEl.textContent = formatSize(new Blob([textareas[tab.id].value]).size);
	}

	function open() {
		refresh(handlers.getState());
		backdrop.hidden = false;
		closeBtn.focus();
	}
	function close() {
		backdrop.hidden = true;
	}

	return { root: backdrop, open, close };
}
