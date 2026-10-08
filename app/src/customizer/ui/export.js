/**
 * @file The Export dialog, a modal inside the customizer's shadow root. It has three parts:
 *
 * - **"For your Astro site"**, the main export, in two ways. "Copy for your coding agent" copies the
 *   agent message, which holds the setup steps and the whole stylesheet. "Download the files (.zip)"
 *   downloads `theme.css` and `APPLY-THEME.md` in one folder.
 * - **"Other exports"**, in a quieter column: the customizer settings, as a settings file or a share
 *   link, and a screenshot of the preview. A small picture of the preview renders when the dialog
 *   opens, and the screenshot options (light or dark, visible area or full page) fold away.
 * - **A tab for every file**, each with Copy and Download, so nothing is exported unseen.
 *
 * `core/export-files.js` builds every file and names it; this module only presents them. Screenshots
 * come from `modern-screenshot`, which loads the first time a picture is needed. The top bar's
 * Screenshot and Share buttons open this same dialog at the matching export (`open('screenshot')`,
 * `open('share')`).
 */
import { buildExportFiles, buildZip } from '../core/export-files.js';
import { encodeState, getName } from '../core/state.js';
import { presets } from '../core/presets.js';
import { buildShareUrl } from '../core/share-link.js';
import { isStudio, getPageDoc, getPageWin, getFrameEls } from './page-doc.js';
import { stripBase } from '../core/base-path.js';
import { DEMO_DIR } from '../../demo-site.mjs';

/** @param {number} bytes @returns {string} e.g. "1.2 KB". */
function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

/** @param {string} filename @param {Blob} blob */
function downloadBlob(filename, blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	// Revoked later, not at once: some browsers start the download after the click returns.
	setTimeout(() => URL.revokeObjectURL(url), 2000);
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

/** @param {string} pathname e.g. "/demo/specimen/" @returns {string} e.g. "specimen"; the demo's
 * home page ("/demo/") and the site root ("/") -> "landing" */
function pageSlugFromPath(pathname) {
	// Base-free first, so a site served under a sub-path still names its home page "landing". The
	// demo folder is dropped too, so file names stay the same as before the demo moved under /demo/.
	const trimmed = stripBase(String(pathname || '/')).replace(/^\/+|\/+$/g, '');
	const parts = trimmed.split('/').filter(Boolean);
	if (parts[0] === DEMO_DIR) parts.shift();
	return parts.length ? parts[parts.length - 1] : 'landing';
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

/** How long a capture waits for lazy images to load before it goes ahead without them. */
const LAZY_IMAGE_WAIT_MS = 5000;
/** `modern-screenshot`'s own limit on each image load and each fetch. Its default is 30 seconds. */
const CAPTURE_RESOURCE_TIMEOUT_MS = 15000;

/**
 * `modern-screenshot` waits for every image in the page to load before it clones anything, up to its
 * `timeout`. A lazy image below the fold has never loaded, so it held every capture of the Document
 * demo page for the full 30 seconds. A capture therefore asks each such image to load now, and
 * `restoreLazyImages` puts its `loading` attribute back afterward.
 * @param {Document} doc
 * @returns {Promise<HTMLImageElement[]>} The images whose attribute changed.
 */
async function loadLazyImages(doc) {
	const images = [.../** @type {NodeListOf<HTMLImageElement>} */ (doc.body.querySelectorAll('img[loading="lazy"]'))].filter((img) => !img.complete);
	for (const img of images) img.loading = 'eager';
	const loaded = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
	await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, LAZY_IMAGE_WAIT_MS))]);
	return images;
}

/** @param {HTMLImageElement[]} images */
function restoreLazyImages(images) {
	for (const img of images) img.setAttribute('loading', 'lazy');
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
 * The capture takes a lane: by default the primary one, but the Export dialog passes Split's
 * dark lane for a dark picture, so it never has to switch a lane that the studio holds in one mode.
 * @param {'visible'|'full'} kind
 * @param {{doc: Document|null|undefined, win: Window|null|undefined}} [target]
 * @returns {Promise<{blob: Blob, width: number, height: number, doc: Document}>}
 */
async function capturePageScreenshot(kind, target = { doc: getPageDoc(), win: getPageWin() }) {
	const { domToBlob } = await import('modern-screenshot');
	const { doc, win } = target;
	if (!doc || !win || !doc.body) throw new Error('The preview page is not available right now.');
	if (doc.fonts && doc.fonts.ready) {
		try {
			await doc.fonts.ready;
		} catch {
			/* best-effort - proceed with whatever is loaded */
		}
	}
	const lazyImages = await loadLazyImages(doc);

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
			timeout: CAPTURE_RESOURCE_TIMEOUT_MS,
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
		return { blob, width, height, doc };
	} finally {
		win.removeEventListener('error', suppressCloneErrors, true);
		if (suppressedErrorCount > 0) {
			console.info(`[svc] screenshot: suppressed ${suppressedErrorCount} error(s) from cloned custom elements`);
		}
		unmarkSelectsAfterClone(markedSelects);
		restoreLazyImages(lazyImages);
		for (const el of marked) el.removeAttribute(FIXED_MARK);
	}
}

// ---------------------------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------------------------

/** Every sentence the dialog shows, written once. */
const WORDS = {
	title: (name) => `Export “${name}”`,
	sub: (preset, n) => `${preset} · ${n} change${n === 1 ? '' : 's'}`,
	main: 'For your Astro site',
	agent: {
		title: 'With a coding agent',
		line: 'Paste one message into Claude Code, Codex or Cursor.',
		label: 'Copy for your coding agent',
		done: 'Copied. Paste it into your coding agent, with your project open.',
		fail: 'Copy failed. Open the Agent message tab and download it instead.',
	},
	files: {
		title: 'Download the files',
		line: 'Get theme.css and the steps. You make the changes.',
		label: 'Download the files (.zip)',
		done: 'Download started. Unzip it in your project, then follow APPLY-THEME.md, or ask your agent to.',
		fail: 'Could not build the zip. Download each file from its tab instead.',
	},
	other: 'Other exports',
	custom: { title: 'Customizer settings', line: 'For this tool, not your website.' },
	settings: {
		label: 'Download settings file',
		line: 'Reopen this theme here later.',
		done: 'Download started. Open it with Import to keep editing.',
	},
	link: {
		label: 'Copy share link',
		line: 'Someone else opens an editable copy.',
		done: 'Copied. Send the link to anyone.',
		fail: 'Copy failed. The browser blocked the clipboard.',
	},
	shot: { title: 'Screenshot', line: 'A picture of the preview.' },
	png: {
		label: 'Download PNG',
		options: 'Options',
		hideOptions: 'Hide options',
		appearance: 'Appearance',
		area: 'Page area',
		rendering: 'Rendering the picture…',
		renderingFull: 'Rendering the full page. This can take several seconds.',
		slow: 'A full page can take several seconds.',
		done: 'Download started.',
		fail: 'Could not create the screenshot.',
		thumbWait: 'Rendering a preview…',
		thumbNone: 'No preview here. Download PNG still works.',
		thumbLabel: 'Show the screenshot in the file tabs',
		fullNote: 'This preview shows the visible area. The download renders the full page.',
	},
	copy: 'Copy',
	copied: 'Copied',
	download: 'Download',
	close: 'Close',
	closeLabel: 'Close export dialog',
};

/** The file tabs, in order. The site's files come first; a thin rule separates the others. */
const FILES = [
	{ id: 'message', tab: 'Agent message', site: true },
	{ id: 'css', tab: 'Stylesheet', site: true },
	{ id: 'apply', tab: 'Setup steps', site: true },
	{ id: 'settings', tab: 'Settings file', site: false },
	{ id: 'png', tab: 'Screenshot', site: false },
];

/** Stroked 24px icons, in the studio top bar's style. */
const ICON_PATHS = {
	agent: '<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><path d="M7 9.5l3 2.5-3 2.5"/><path d="M12.5 15h4.5"/>',
	zip: '<path d="M6 3.5h9l4 4V20.5H6z"/><path d="M14.5 3.5V8H19"/><path d="M10 6h1.5M10 9h1.5M10 12h1.5M9.5 15h2.5v3h-2.5z"/>',
	copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.5"/><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
	download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
	link: '<path d="M10 14a4.5 4.5 0 0 0 6.36 0l3.18-3.18a4.5 4.5 0 0 0-6.36-6.36l-1.06 1.06"/><path d="M14 10a4.5 4.5 0 0 0-6.36 0l-3.18 3.18a4.5 4.5 0 0 0 6.36 6.36l1.06-1.06"/>',
	sliders: '<path d="M5 4v16M12 4v16M19 4v16"/><path d="M3 9h4M10 15h4M17 7h4"/>',
	camera: '<path d="M4 8.5h3.2l1.6-2.2h6.4l1.6 2.2H20v10.5H4z"/><circle cx="12" cy="13.6" r="3.4"/>',
	check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
	close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

/** @param {keyof typeof ICON_PATHS} name @param {number} [size] @returns {Node} */
function iconNode(name, size = 16) {
	const t = document.createElement('template');
	t.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
	return /** @type {Node} */ (t.content.firstChild);
}

/**
 * Builds an element. Children are nodes or plain text; text never goes through innerHTML, so a
 * theme name can never become markup.
 * @param {string} tag
 * @param {Record<string, string|boolean|null|undefined>} [attrs]
 * @param {(Node|string)[]} [children]
 * @returns {HTMLElement}
 */
function h(tag, attrs = {}, children = []) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value == null || value === false) continue;
		el.setAttribute(key, value === true ? '' : String(value));
	}
	el.append(...children);
	return el;
}

/** @param {Document|null|undefined} doc @returns {'light'|'dark'} */
const themeOf = (doc) => (doc?.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light');

/** @param {Window|null} win Waits two frames and a moment, so a mode switch has painted. */
async function settle(win) {
	const w = win || window;
	for (let i = 0; i < 2; i++) await new Promise((resolve) => w.requestAnimationFrame(() => resolve(undefined)));
	await new Promise((resolve) => setTimeout(resolve, 120));
}

/**
 * @param {{
 *   getState: () => import('../core/state.js').ThemeState,
 *   getChangeCount: () => number,
 *   setPreviewTheme: (mode: 'light'|'dark') => void,
 * }} handlers
 * @returns {{root: HTMLElement, open: (where?: 'export'|'screenshot'|'share') => void, close: (restoreFocus?: boolean) => void}}
 */
export function createExportDialog(handlers) {
	let files = buildExportFiles(handlers.getState());
	/** @type {HTMLElement|null} */
	let opener = null;
	/** @type {{mode: 'light'|'dark', area: 'visible'|'full', openedMode: 'light'|'dark', optsOpen: boolean, busy: boolean}} */
	const shot = { mode: 'light', area: 'visible', openedMode: 'light', optsOpen: false, busy: false };

	const backdrop = h('div', { class: 'svc-dialog-backdrop svc-xp-backdrop', hidden: true });
	const dialog = h('div', { class: 'svc-dialog svc-xp', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'svc-xp-title' });
	backdrop.append(dialog);
	const live = h('p', { class: 'svc-sr-only', role: 'status' });

	// ---- Header: the theme's name, its preset and its change count. ----
	const titleEl = h('h2', { id: 'svc-xp-title' });
	const subEl = h('p', { class: 'svc-xp-sub' });
	const closeBtn = h('button', { type: 'button', class: 'svc-xp-close', 'aria-label': WORDS.closeLabel, title: WORDS.close }, [iconNode('close', 18)]);
	dialog.append(h('div', { class: 'svc-dialog-header svc-xp-head' }, [h('div', {}, [titleEl, subEl]), closeBtn]), live);

	/** Each line that a status can replace, keyed by action, with its own resting text.
	 * @type {Record<string, {el: HTMLElement, rest: () => string}>} */
	const lines = {};

	// ---- "For your Astro site": the two ways. ----
	/** @param {'agent'|'files'} kind @param {'agent'|'zip'} iconName @param {'copy'|'download'} actionIcon */
	function wayCard(kind, iconName, actionIcon) {
		const words = WORDS[kind];
		const line = h('p', { class: 'svc-xp-line' }, [words.line]);
		lines[kind] = { el: line, rest: () => words.line };
		const btn = h('button', { type: 'button', class: 'svc-btn svc-btn-primary svc-xp-go', 'data-export': kind }, [iconNode(actionIcon, 17), words.label]);
		const card = h('div', { class: 'svc-xp-way' }, [h('div', { class: 'svc-xp-way-head' }, [iconNode(iconName, 20), h('b', {}, [words.title])]), line, btn]);
		return { card, btn };
	}
	const agentWay = wayCard('agent', 'agent', 'copy');
	const filesWay = wayCard('files', 'zip', 'download');
	const main = h('section', { class: 'svc-xp-main', 'aria-labelledby': 'svc-xp-main-title' }, [
		h('h3', { id: 'svc-xp-main-title', class: 'svc-xp-main-title' }, [WORDS.main]),
		h('div', { class: 'svc-xp-ways' }, [agentWay.card, filesWay.card]),
	]);

	// ---- "Other exports": the customizer settings and the screenshot, one line per option. ----
	/** @param {string} kind @param {keyof typeof ICON_PATHS} iconName @param {string} label */
	const quietBtn = (kind, iconName, label) => h('button', { type: 'button', class: 'svc-btn svc-xp-quiet', 'data-export': kind }, [iconNode(iconName, 15), label]);
	/** @param {'settings'|'link'} kind @param {keyof typeof ICON_PATHS} iconName */
	function option(kind, iconName) {
		const words = WORDS[kind];
		const btn = quietBtn(kind, iconName, words.label);
		const line = h('p', { class: 'svc-xp-line' }, [words.line]);
		lines[kind] = { el: line, rest: () => words.line };
		return { node: h('div', { class: 'svc-xp-opt' }, [btn, line]), btn };
	}
	/** @param {keyof typeof ICON_PATHS} iconName @param {string} title */
	const groupHead = (iconName, title) => h('div', { class: 'svc-xp-group-head' }, [iconNode(iconName, 15), h('b', {}, [title])]);
	const settingsOpt = option('settings', 'download');
	const linkOpt = option('link', 'link');

	const thumbPic = h('span', { class: 'svc-xp-thumb-pic' });
	const thumbBtn = h('button', { type: 'button', class: 'svc-xp-thumb', 'aria-label': WORDS.png.thumbLabel }, [thumbPic]);
	const pngBtn = quietBtn('png', 'download', WORDS.png.label);
	const optsBtn = h('button', { type: 'button', class: 'svc-xp-link', 'aria-expanded': 'false', 'aria-controls': 'svc-xp-shotopts' }, [WORDS.png.options]);
	/** @param {'mode'|'area'} key @param {string} label @param {[string, string, string?][]} choices */
	function segGroup(key, label, choices) {
		const labelId = `svc-xp-${key}-label`;
		const buttons = choices.map(([value, text, extraClass]) => h('button', { type: 'button', role: 'radio', class: extraClass || null, 'data-value': value }, [text]));
		for (const b of buttons) {
			b.addEventListener('click', () => {
				shot[key] = /** @type {any} */ (b.dataset.value);
				paintShot();
				if (key === 'mode') ensureThumb();
			});
		}
		const node = h('div', { class: 'svc-xp-ctl' }, [h('span', { id: labelId }, [label]), h('span', { class: 'svc-xp-seg', role: 'radiogroup', 'aria-labelledby': labelId }, buttons)]);
		return { node, buttons, key };
	}
	const modeGroup = segGroup('mode', WORDS.png.appearance, [['light', 'Light'], ['dark', 'Dark']]);
	// The area buttons keep the old Export dialog's class names, which the screenshot suites use.
	const areaGroup = segGroup('area', WORDS.png.area, [['visible', 'Visible area', 'svc-export-shot-visible-btn'], ['full', 'Full page', 'svc-export-shot-full-btn']]);
	const shotOpts = h('div', { class: 'svc-xp-shotopts', id: 'svc-xp-shotopts', hidden: true }, [modeGroup.node, areaGroup.node]);
	const pngLine = h('p', { class: 'svc-xp-line svc-xp-pngline' });
	lines.png = { el: pngLine, rest: pngRestLine };

	const other = h('section', { class: 'svc-xp-other', 'aria-labelledby': 'svc-xp-other-title' }, [
		h('h3', { id: 'svc-xp-other-title', class: 'svc-xp-other-title' }, [WORDS.other]),
		h('div', { class: 'svc-xp-group' }, [groupHead('sliders', WORDS.custom.title), h('p', { class: 'svc-xp-group-line' }, [WORDS.custom.line]), settingsOpt.node, linkOpt.node]),
		h('div', { class: 'svc-xp-group' }, [groupHead('camera', WORDS.shot.title), h('p', { class: 'svc-xp-group-line' }, [WORDS.shot.line]), thumbBtn, h('div', { class: 'svc-xp-acts' }, [pngBtn, optsBtn]), shotOpts, pngLine]),
	]);

	// ---- A tab for every file, each with Copy and Download. ----
	const tablist = h('div', { class: 'svc-xp-tabs', role: 'tablist', 'aria-label': 'Every file' });
	/** @type {Record<string, HTMLElement>} */
	const tabs = {};
	/** @type {Record<string, {panel: HTMLElement, nameEl: HTMLElement, metaEl: HTMLElement, copyBtn: HTMLElement|null, dlBtn: HTMLElement, content: HTMLElement}>} */
	const panels = {};
	FILES.forEach((f, i) => {
		if (!f.site && FILES[i - 1]?.site) tablist.append(h('span', { class: 'svc-xp-divider', 'aria-hidden': 'true' }));
		const tab = h('button', { type: 'button', role: 'tab', id: `svc-xp-tab-${f.id}`, class: 'svc-xp-tab', 'data-file': f.id, 'aria-controls': `svc-xp-panel-${f.id}` }, [f.tab]);
		tab.addEventListener('click', () => selectFile(f.id));
		tablist.append(tab);
		tabs[f.id] = tab;
		const nameEl = h('span', { class: 'svc-xp-fname' });
		const metaEl = h('span', { class: 'svc-xp-fmeta' });
		const copyBtn = f.id === 'png' ? null : h('button', { type: 'button', class: 'svc-xp-tool', 'data-file': f.id, title: WORDS.copy }, [iconNode('copy', 15)]);
		const dlBtn = h('button', { type: 'button', class: 'svc-btn svc-xp-dl', 'data-file': f.id }, [iconNode('download', 15), WORDS.download]);
		const content = f.id === 'png' ? h('div', { class: 'svc-xp-img' }) : h('pre', { class: 'svc-xp-pre', 'data-file': f.id, tabindex: '0' });
		const panel = h('div', { class: 'svc-xp-panel', role: 'tabpanel', id: `svc-xp-panel-${f.id}`, 'aria-labelledby': `svc-xp-tab-${f.id}`, hidden: true }, [
			h('div', { class: 'svc-xp-panel-head' }, [h('div', { class: 'svc-xp-fileid' }, [nameEl, metaEl]), h('div', { class: 'svc-xp-tools' }, copyBtn ? [copyBtn, dlBtn] : [dlBtn])]),
			content,
		]);
		panels[f.id] = { panel, nameEl, metaEl, copyBtn, dlBtn, content };
		if (copyBtn) copyBtn.addEventListener('click', () => copyFile(f.id, copyBtn));
		dlBtn.addEventListener('click', () => (f.id === 'png' ? runPng() : downloadText(nameOf(f.id), textOf(f.id))));
	});
	const viewer = h('div', { class: 'svc-xp-view' }, [h('div', { class: 'svc-xp-viewer' }, [tablist, ...FILES.map((f) => panels[f.id].panel)])]);

	const body = h('div', { class: 'svc-xp-body' }, [main, other, viewer]);
	dialog.append(body);

	// ---- The files' text and names. ----
	/** @param {string} id @returns {string} */
	function textOf(id) {
		return { message: files.message, css: files.css, apply: files.apply, settings: files.settings }[id] ?? '';
	}
	/** @param {string} id @returns {string} */
	function nameOf(id) {
		if (id === 'png') {
			const lane = laneFor(shot.mode);
			const width = Math.max(1, Math.round(lane.win?.innerWidth || 0));
			return `${files.slug}-${pageSlugFromPath(lane.doc?.location?.pathname)}-${shot.mode}-${width}.png`;
		}
		return { message: files.names.message, css: files.names.css, apply: files.names.apply, settings: files.names.settings }[id] ?? '';
	}

	function refresh() {
		const state = handlers.getState();
		files = buildExportFiles(state);
		titleEl.textContent = WORDS.title(getName(state));
		const preset = presets.find((p) => p.id === state.preset)?.label || 'Starlight default';
		subEl.textContent = WORDS.sub(preset, handlers.getChangeCount());
		for (const id of ['message', 'css', 'apply', 'settings']) {
			const text = textOf(id);
			const name = nameOf(id);
			const p = panels[id];
			p.content.textContent = text;
			p.content.setAttribute('aria-label', `${name} contents`);
			p.nameEl.textContent = name;
			p.metaEl.textContent = formatSize(new Blob([text]).size);
			p.copyBtn?.setAttribute('aria-label', `Copy ${name}`);
			p.dlBtn.setAttribute('aria-label', `Download ${name}`);
		}
		paintShot();
	}

	/** @param {string} id */
	function selectFile(id) {
		for (const f of FILES) {
			const on = f.id === id;
			tabs[f.id].setAttribute('aria-selected', String(on));
			tabs[f.id].tabIndex = on ? 0 : -1;
			panels[f.id].panel.hidden = !on;
		}
		if (id === 'png') ensureThumb();
	}

	// ---- Statuses: a confirmation replaces the line of the action it confirms, then fades back. ----
	/** @type {string|null} */
	let statusKey = null;
	let statusTimer = 0;
	/** @param {string} key @param {{text: string, tone: 'done'|'fail'|'busy'}|null} status */
	function paintLine(key, status) {
		const { el, rest } = lines[key];
		el.classList.toggle('is-done', status?.tone === 'done');
		el.classList.toggle('is-fail', status?.tone === 'fail');
		const resting = rest();
		el.replaceChildren(...(status ? (status.tone === 'done' ? [iconNode('check', 14), status.text] : [status.text]) : resting ? [resting] : []));
	}
	/** @param {string} key @param {string} text @param {'done'|'fail'|'busy'} tone */
	function setStatus(key, text, tone) {
		if (statusKey && statusKey !== key) paintLine(statusKey, null);
		statusKey = key;
		paintLine(key, { text, tone });
		live.textContent = text;
		clearTimeout(statusTimer);
		if (tone !== 'busy') {
			statusTimer = window.setTimeout(() => {
				if (statusKey === key) {
					paintLine(key, null);
					statusKey = null;
				}
			}, 7000);
		}
	}
	function clearStatus() {
		clearTimeout(statusTimer);
		if (statusKey) paintLine(statusKey, null);
		statusKey = null;
		live.textContent = '';
	}

	// ---- The actions. ----
	/** @param {string} kind */
	async function run(kind) {
		if (kind === 'agent') {
			const ok = await copyToClipboard(files.message);
			setStatus('agent', ok ? WORDS.agent.done : WORDS.agent.fail, ok ? 'done' : 'fail');
		} else if (kind === 'files') {
			try {
				downloadBlob(files.names.zip, new Blob([buildZip(files)], { type: 'application/zip' }));
				setStatus('files', WORDS.files.done, 'done');
			} catch {
				setStatus('files', WORDS.files.fail, 'fail');
			}
		} else if (kind === 'settings') {
			downloadText(files.names.settings, files.settings);
			setStatus('settings', WORDS.settings.done, 'done');
		} else if (kind === 'link') {
			// The studio's `?page=` travels with the link, so the recipient lands on the same page.
			const ok = await copyToClipboard(buildShareUrl(location, encodeState(handlers.getState())));
			setStatus('link', ok ? WORDS.link.done : WORDS.link.fail, ok ? 'done' : 'fail');
		} else if (kind === 'png') {
			await runPng();
		}
	}
	for (const btn of [agentWay.btn, filesWay.btn, settingsOpt.btn, linkOpt.btn, pngBtn]) {
		btn.addEventListener('click', () => run(/** @type {string} */ (btn.dataset.export)));
	}
	/** @param {string} id @param {HTMLElement} btn */
	async function copyFile(id, btn) {
		const ok = await copyToClipboard(textOf(id));
		btn.replaceChildren(iconNode(ok ? 'check' : 'close', 15));
		btn.title = ok ? WORDS.copied : WORDS.copy;
		setTimeout(() => {
			btn.replaceChildren(iconNode('copy', 15));
			btn.title = WORDS.copy;
		}, 1400);
	}

	// ---- Screenshots. ----
	/** The preview lanes on screen. Outside the studio, the page itself. */
	function visibleLanes() {
		if (!isStudio()) return [{ doc: getPageDoc(), win: getPageWin() }];
		return getFrameEls()
			.filter((frame) => frame.getClientRects().length > 0 && frame.contentDocument)
			.map((frame) => ({ doc: frame.contentDocument, win: frame.contentWindow }));
	}
	/** A lane that already shows `mode` (in Split, each lane holds its own), or the main lane.
	 * @param {'light'|'dark'} mode */
	function laneFor(mode) {
		return visibleLanes().find((lane) => themeOf(lane.doc) === mode) || { doc: getPageDoc(), win: getPageWin() };
	}
	/**
	 * Captures one lane, and gives up when its page goes away: the preview moved to another page.
	 * A capture of an unloaded page never finishes, and it would hold up every capture after it.
	 * @param {'visible'|'full'} kind @param {{doc: Document|null|undefined, win: Window|null|undefined}} lane
	 * @returns {Promise<{blob: Blob, width: number, height: number, doc: Document}>}
	 */
	function captureWhileShown(kind, lane) {
		const { win } = lane;
		return new Promise((resolve, reject) => {
			const gone = () => reject(new Error('The preview moved to another page during the capture.'));
			win?.addEventListener('pagehide', gone, { once: true });
			capturePageScreenshot(kind, lane)
				.then(resolve, reject)
				.finally(() => win?.removeEventListener('pagehide', gone));
		});
	}
	let captureQueue = Promise.resolve();
	/**
	 * Captures the preview in `mode`. When no lane shows that mode, the main lane switches to it for
	 * the capture and switches back afterwards. Captures run one at a time, and nothing can stop one
	 * that has started, so a capture that is no longer wanted when its turn comes is skipped instead.
	 * @param {'light'|'dark'} mode @param {'visible'|'full'} kind
	 * @param {() => boolean} [stillWanted] Checked when the capture's turn comes.
	 * @returns {Promise<{blob: Blob, width: number, height: number, doc: Document}|null>} `null` when skipped.
	 */
	function captureIn(mode, kind, stillWanted = () => true) {
		const runCapture = async () => {
			if (!stillWanted()) return null;
			const lane = visibleLanes().find((l) => themeOf(l.doc) === mode);
			if (lane) return captureWhileShown(kind, lane);
			const before = themeOf(getPageDoc());
			handlers.setPreviewTheme(mode);
			await settle(getPageWin());
			try {
				return await captureWhileShown(kind, { doc: getPageDoc(), win: getPageWin() });
			} finally {
				handlers.setPreviewTheme(before);
			}
		};
		const next = captureQueue.then(runCapture, runCapture);
		captureQueue = next.then(
			() => undefined,
			() => undefined
		);
		return next;
	}
	async function runPng() {
		if (shot.busy) return;
		shot.busy = true;
		for (const b of [pngBtn, panels.png.dlBtn]) b.setAttribute('aria-busy', 'true');
		setStatus('png', shot.area === 'full' ? WORDS.png.renderingFull : WORDS.png.rendering, 'busy');
		try {
			const mode = shot.mode;
			// The small picture is a visible-area capture at full size. When the view has not changed
			// since, it is the download, and a long page is rendered once instead of twice.
			const thumb = shot.area === 'visible' ? thumbs.get(mode) : undefined;
			const reused = thumb && thumb.key === viewKey(mode) ? await thumb.promise : null;
			const result = reused || (await captureIn(mode, shot.area));
			if (!result) throw new Error('The preview page is not available right now.');
			const { blob, width, doc } = result;
			downloadBlob(`${files.slug}-${pageSlugFromPath(doc?.location?.pathname)}-${mode}-${width}.png`, blob);
			setStatus('png', WORDS.png.done, 'done');
		} catch (err) {
			setStatus('png', `${WORDS.png.fail} ${err instanceof Error ? err.message : String(err)}`, 'fail');
		} finally {
			shot.busy = false;
			for (const b of [pngBtn, panels.png.dlBtn]) b.removeAttribute('aria-busy');
		}
	}

	// The small pictures, one per mode. Each is kept with what it shows: the CSS, the page, the scroll
	// position and the window size. A picture whose view has changed is rendered again.
	/** @typedef {{key: string, url: string|null, failed: boolean, promise: Promise<{blob: Blob, width: number, height: number, doc: Document}|null>}} Thumb */
	/** @type {Map<'light'|'dark', Thumb>} */
	const thumbs = new Map();
	/** What a visible-area picture in `mode` depends on. @param {'light'|'dark'} mode */
	function viewKey(mode) {
		const { doc, win } = laneFor(mode);
		return [files.css, mode, doc?.location?.href || '', Math.round(win?.scrollX || 0), Math.round(win?.scrollY || 0), win?.innerWidth || 0, win?.innerHeight || 0].join('\n');
	}
	function ensureThumb() {
		if (!isStudio()) return paintThumbs();
		const mode = shot.mode;
		const key = viewKey(mode);
		const old = thumbs.get(mode);
		if (old && old.key === key && !old.failed) return paintThumbs();
		/** @type {Thumb} */
		const entry = { key, url: null, failed: false, promise: Promise.resolve(null) };
		const current = () => thumbs.get(mode) === entry;
		// A dialog closed before this picture's turn, or a newer picture for this mode, skips it.
		entry.promise = captureIn(mode, 'visible', () => !backdrop.hidden && current()).then(
			(result) => {
				if (!current()) return result;
				if (result) entry.url = URL.createObjectURL(result.blob);
				else thumbs.delete(mode);
				paintThumbs();
				return result;
			},
			() => {
				// The line under the picture says there is none; Download PNG reports its own errors.
				if (current()) {
					entry.failed = true;
					paintThumbs();
				}
				return null;
			}
		);
		thumbs.set(mode, entry);
		paintThumbs();
		// Only now is the old picture off the page, so its address can go.
		if (old?.url) URL.revokeObjectURL(old.url);
	}
	// Only the pictures are swapped, never the controls around them, so a click is never lost.
	function paintThumbs() {
		const entry = isStudio() ? thumbs.get(shot.mode) : undefined;
		// A picture of an earlier view is never shown, even for the moment before it is replaced.
		const url = entry && entry.key === viewKey(shot.mode) ? entry.url : null;
		const waitText = !isStudio() || entry?.failed ? WORDS.png.thumbNone : WORDS.png.thumbWait;
		thumbPic.replaceChildren(url ? h('img', { src: url, alt: '' }) : h('span', { class: 'svc-xp-thumb-wait' }, [waitText]));
		const note = shot.area === 'full' && url ? [h('p', { class: 'svc-xp-imgnote' }, [WORDS.png.fullNote])] : [];
		panels.png.content.replaceChildren(...note, url ? h('img', { src: url, alt: `The preview page in ${shot.mode} mode` }) : h('p', { class: 'svc-xp-thumb-wait' }, [waitText]));
	}
	/** The line under the screenshot buttons, when no status is showing. */
	function pngRestLine() {
		if (shot.optsOpen) return shot.area === 'full' ? WORDS.png.slow : '';
		if (shot.mode === shot.openedMode && shot.area === 'visible') return '';
		return `${shot.mode === 'dark' ? 'Dark' : 'Light'}, ${shot.area === 'full' ? 'full page' : 'visible area'}.`;
	}
	function paintShot() {
		for (const group of [modeGroup, areaGroup]) {
			for (const b of group.buttons) {
				const on = b.dataset.value === shot[group.key];
				b.setAttribute('aria-checked', String(on));
				b.tabIndex = on ? 0 : -1;
			}
		}
		optsBtn.textContent = shot.optsOpen ? WORDS.png.hideOptions : WORDS.png.options;
		optsBtn.setAttribute('aria-expanded', String(shot.optsOpen));
		shotOpts.hidden = !shot.optsOpen;
		if (statusKey !== 'png') paintLine('png', null);
		panels.png.nameEl.textContent = nameOf('png');
		panels.png.metaEl.textContent = `${shot.mode}, ${shot.area === 'full' ? 'full page' : 'visible area'}`;
		panels.png.dlBtn.setAttribute('aria-label', `Download ${nameOf('png')}`);
		paintThumbs();
	}
	optsBtn.addEventListener('click', () => {
		shot.optsOpen = !shot.optsOpen;
		paintShot();
	});
	thumbBtn.addEventListener('click', () => selectFile('png'));

	// ---- Opening, closing and the keyboard. ----
	function deepActive() {
		let a = document.activeElement;
		while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
		return /** @type {HTMLElement|null} */ (a);
	}
	/** @param {'export'|'screenshot'|'share'} [where] */
	function open(where = 'export') {
		opener = deepActive();
		clearStatus();
		shot.mode = themeOf(getPageDoc());
		shot.openedMode = shot.mode;
		shot.area = 'visible';
		shot.optsOpen = false;
		// Only the studio renders the small picture: outside it, the page is the dialog's own page.
		thumbBtn.hidden = !isStudio();
		refresh();
		backdrop.hidden = false;
		if (where === 'screenshot') {
			selectFile('png');
			pngBtn.focus();
		} else if (where === 'share') {
			selectFile('settings');
			linkOpt.btn.focus();
		} else {
			selectFile('message');
			agentWay.btn.focus();
		}
		ensureThumb();
	}
	/** @param {boolean} [restoreFocus] */
	function close(restoreFocus = true) {
		if (backdrop.hidden) return;
		backdrop.hidden = true;
		clearStatus();
		if (restoreFocus && opener && opener.isConnected) opener.focus();
		opener = null;
	}
	closeBtn.addEventListener('click', () => close());
	// A press that starts inside the dialog and ends on the backdrop, such as selecting text in a
	// file, does not close it.
	let pressOnBackdrop = false;
	backdrop.addEventListener('mousedown', (event) => {
		pressOnBackdrop = event.target === backdrop;
	});
	backdrop.addEventListener('click', (event) => {
		if (event.target === backdrop && pressOnBackdrop) close();
	});

	function focusables() {
		return [.../** @type {NodeListOf<HTMLElement>} */ (dialog.querySelectorAll('button, [tabindex="0"]'))].filter(
			(el) => el.tabIndex >= 0 && !(/** @type {HTMLButtonElement} */ (el).disabled) && el.getClientRects().length > 0
		);
	}
	backdrop.addEventListener('keydown', (event) => {
		const root = /** @type {ShadowRoot|Document} */ (dialog.getRootNode());
		const active = /** @type {HTMLElement|null} */ (root.activeElement);
		if (event.key === 'Escape') {
			event.stopPropagation();
			close();
			return;
		}
		if (event.key === 'Tab') {
			// Focus stays inside the dialog.
			const items = focusables();
			if (!items.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && (active === first || !dialog.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
				event.preventDefault();
				first.focus();
			}
			return;
		}
		// Arrow keys, Home and End move along the file tabs and the screenshot options, and choose.
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
		const group = active?.closest('[role="tablist"], [role="radiogroup"]');
		if (!group || !active) return;
		const items = [.../** @type {NodeListOf<HTMLElement>} */ (group.querySelectorAll('[role="tab"], [role="radio"]'))];
		const i = items.indexOf(active);
		if (i < 0) return;
		event.preventDefault();
		const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
		const n = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (i + (forward ? 1 : -1) + items.length) % items.length;
		items[n].click();
		items[n].focus();
	});

	return { root: backdrop, open, close };
}
