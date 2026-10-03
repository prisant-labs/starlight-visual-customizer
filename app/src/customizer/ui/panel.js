/**
 * @file `<sl-customizer>` custom element: the top-level controller. Owns the mutable `state`
 * variable, the shadow-DOM panel skeleton, the single `CSSStyleSheet` pushed to
 * `document.adoptedStyleSheets`, font injection, persistence, and wiring between
 * `controls.js` / `ia-editor.js` / `sidebar-render.js` / `preview-approx.js` / `export.js`.
 *
 * Mounted once per page by `src/components/CustomizerFooter.astro`:
 * `<sl-customizer></sl-customizer>` + `<script>import '../customizer/ui/panel.js';</script>`.
 *
 * Two DOM shapes come out of `initCustomizer`, chosen once by `isStudio()` (page-doc.js) at connect
 * time (a page never switches shape mid-session):
 *  - **Overlay** (a direct page visit carrying the `?svc-overlay` escape hatch): the floating
 *    drawer/FAB, the accordion group list, the sun/moon toggle.
 *  - **Studio** (`/studio/`): a rail (tablist) + panel column (tabpanel) replace the drawer.
 *    `studio.js` builds the REST of the shell (top bar, toolbar, context line, stage)
 *    in the studio's own light DOM and talks to this module through a small controller this file
 *    sets on the host element, `host.__svc` (see its assignment below for the full surface).
 *    Putting the rail INSIDE this shadow root (rather than in studio.js's light DOM) keeps the
 *    rail's `aria-controls` reference intra-document and gives the rail direct access to live
 *    state/history with no extra indirection.
 *
 * Both shapes are built as nested closures inside ONE `initCustomizer` call so every piece of
 * shared mutable state (`state`, `controlRows`, `presetGalleryBody`, `sectionDotRefreshers`, the
 * per-lane stylesheets, history) is a plain local variable both branches close over directly - no
 * cross-module "deps object" plumbing.
 *
 * A THIRD outcome exists above both of these - a direct page visit with NEITHER `?svc-overlay` nor
 * a studio preview iframe mounts no panel at all. `connectedCallback`'s own marked block returns
 * before `initCustomizer` ever runs; the page shows exactly as a real visitor sees it (the existing
 * no-flash preload path already applies the saved theme, no JS required) plus a small "Open in
 * Studio" pill that same block builds directly.
 */
import { useMode, modeRgb, formatHex } from 'culori/fn';

import { controls, GROUPS, FONTS } from '../core/manifest.js';
import { presets } from '../core/presets.js';
import { defaultState, getValue, setValue, applyPreset, encodeState, setName, getName, sameTheme } from '../core/state.js';
import { resolveInitialTheme, buildShareUrl, SHARE_HASH_PREFIX } from '../core/share-link.js';
import { emitCss } from '../core/emit-css.js';
import { contrastRatio, CONTRAST_AA, CONTRAST_AAA } from '../core/color.js';
import { createHistory } from '../core/history.js';

import { panelStyles } from './styles.js';
import {
	createGroupSection,
	createStudioGroupPanel,
	createPresetGallery,
	createContrastBlock,
	createContrastDialog,
	applyControlFilter,
	COLOR_ASSIST,
	GROUP_ICON_PATHS,
	GROUP_DESCRIPTIONS,
} from './controls.js';
import { ensureFontPreviewFacesInjected } from './tiles/index.js';
import { createIaEditor } from './ia-editor.js';
import { harvestSidebarTemplates, renderSidebar } from './sidebar-render.js';
import { stampTocLevels, applySiteTitle } from './preview-approx.js';
import { createExportDialog } from './export.js';
import { createShareLinkDialog } from './share-dialog.js';
import { createTargetHighlighter } from './target-highlight.js';
import { setFrameEls, getPageDoc, getPageWin, getFrameEl, isStudio } from './page-doc.js';
import { withBase, stripBase } from '../core/base-path.js';
import { nextSizing, formatSizing, effectiveSizing, SIZING_STEPS, SIZING_NARROW_BELOW, DEFAULT_SIZING } from '../core/sizing.js';
import { loadSizing, saveSizing, setChromeZoom } from './studio-sizing.js';

useMode(modeRgb); // registers the rgb color model with culori/fn's shared registry (idempotent)

/** Sun/moon icon-button glyphs (overlay header only - studio mode drops this button: the
 * toolbar's Light/Dark/Split replaces it). */
const SUN_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>`;
const MOON_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"></path></svg>`;

const LOCALSTORAGE_STATE_KEY = 'svc-state';
const LOCALSTORAGE_CSS_KEY = 'svc-css';
const SESSIONSTORAGE_UI_KEY = 'svc-ui';
const PRELOAD_STYLE_ID = 'svc-preload';
/** Groups open by default the very first time a visitor arrives (no `svc-ui` yet), overlay mode
 * only. Navigation is intentionally absent - demoted, collapsed by default. */
const DEFAULT_OPEN_GROUPS = ['Presets', 'Colors'];
const FONT_CONTROL_IDS = ['type.font.body', 'type.font.heading', 'type.font.mono'];
/** Every control id `getResolvedColor` can resolve to a live hex, by DOM-probing the custom
 * property named here (see `resolveCssColor`). */
const RESOLVABLE_COLOR_TOKEN_BY_ID = {
	'color.role.bg': '--sl-color-bg',
	'color.role.bgNav': '--sl-color-bg-nav',
	'color.role.bgSidebar': '--sl-color-bg-sidebar',
	'color.role.text': '--sl-color-text',
	'color.role.link': '--sl-color-text-accent',
	'color.accent.hue': '--sl-color-accent',
	'color.gray.hue': '--sl-color-gray-3',
	'color.hue.orange': '--sl-color-orange',
	'color.hue.green': '--sl-color-green',
	'color.hue.blue': '--sl-color-blue',
	'color.hue.purple': '--sl-color-purple',
	'color.hue.red': '--sl-color-red',
};

/** Rail order + separators: GROUPS is already in the display order the rail wants
 * ('Presets, Colors, Typography, Layout | Header, Sidebar, TOC | Content, Components, Code,
 * Footer, Page options | Structure (advanced)') - 'Navigation' (the manifest key behind the
 * retitled "Structure (advanced)" item) is appended last. A separator renders AFTER each of these
 * group names. */
const RAIL_GROUPS = [...GROUPS, 'Navigation'];
const RAIL_SEPARATOR_AFTER = new Set(['Presets', 'Layout', 'TOC', 'Page options']);
const RAIL_TITLES = { Navigation: 'Structure (advanced)' };

/** The group-header eyebrow used to just repeat the group name ("COLORS / Colors"). These are the
 * same clusters the rail's own separators already group groups into (RAIL_SEPARATOR_AFTER), given
 * a category name instead. */
const RAIL_CATEGORY_EYEBROW = {
	Presets: 'Foundations',
	Colors: 'Foundations',
	Typography: 'Foundations',
	Layout: 'Foundations',
	Header: 'Navigation',
	Sidebar: 'Navigation',
	TOC: 'Navigation',
	Content: 'Page content',
	Components: 'Page content',
	Code: 'Page content',
	Footer: 'Page content',
	'Page options': 'Build settings',
	Navigation: 'Advanced',
};

/** No scroll-to-target for Presets, Colors, Typography, Page options, Structure. */
const SCROLL_EXCLUDED_GROUPS = new Set(['Presets', 'Colors', 'Typography', 'Page options', 'Navigation']);

/** Status bar contrast: token PAIRS, resolved via the same DOM-probe `resolveCssColor`
 * already used for the Colors group's live readout (below) rather than re-deriving Starlight's
 * cascade by hand - every token here is a plain custom-property reference (verified against
 * `node_modules/@astrojs/starlight/dist/style/{props,asides}.css` and `SiteTitle.astro`,
 * `SidebarSublist.astro`, `Footer.astro`/`EditLink.astro` for "muted"), so a probe div resolves it
 * correctly regardless of role overrides, semantic-hue changes, or the contrast-floor control -
 * `hostSheet` always carries the CURRENT state's emitted CSS, so this needs no separate
 * palette-math re-implementation and stays correct as either changes. */
const STATUS_CONTRAST_PAIRS = [
	{ label: 'Body text on page', text: '--sl-color-text', bg: '--sl-color-bg' },
	{ label: 'Links on page', text: '--sl-color-text-accent', bg: '--sl-color-bg' },
	{ label: 'Muted text on page', text: '--sl-color-gray-3', bg: '--sl-color-bg' },
	{ label: 'Sidebar text on sidebar', text: '--sl-color-white', bg: '--sl-color-bg-sidebar' },
	{ label: 'Site title on header', text: '--sl-color-text-accent', bg: '--sl-color-bg-nav' },
	{ label: 'Note aside title on its background', text: '--sl-color-blue-high', bg: '--sl-color-blue-low' },
	{ label: 'Tip aside title on its background', text: '--sl-color-purple-high', bg: '--sl-color-purple-low' },
	{ label: 'Caution aside title on its background', text: '--sl-color-orange-high', bg: '--sl-color-orange-low' },
	{ label: 'Danger aside title on its background', text: '--sl-color-red-high', bg: '--sl-color-red-low' },
];

/** @type {Map<string, import('../core/manifest.js').Control>} */
const controlsById = new Map(controls.map((c) => [c.id, c]));

/** A `color`-type role-override control's hex field must show the freshly
 * resolved color after ANY change that can move it (undo/redo/preset/group-reset/reset-all/import
 * for an 'auto' role, and the light/dark toggle for one too) - `getResolvedColor` DOM-probes a
 * computed style that is only accurate AFTER `applyCssEverywhere` has actually run, so a role
 * override's `refresh()` must be called again at every point `COLOR_ASSIST` ids already are
 * (post-CSS-apply), not just once, synchronously, from `fullRerenderControls()`. */
const ROLE_OVERRIDE_IDS = controls.filter((c) => c.type === 'color').map((c) => c.id);

class SlCustomizer extends HTMLElement {
	connectedCallback() {
		if (this._svcInitialized) return;
		this._svcInitialized = true;
		// This same `<sl-customizer>` + panel.js pairing is mounted by
		// EVERY Starlight page via CustomizerFooter.astro, including every page the studio's own
		// preview iframe(s) load - `data-svc-preview` marks those iframes, so a copy of this element
		// running INSIDE one must not build a second, redundant panel (the studio's own top-level
		// `<sl-customizer>` is the only one that should ever mount). Instead it pings the host window
		// once, same-origin, so the host's own attach flow can theme/re-render THIS document - see
		// `window.__svcAttachPreview` below. `window.frameElement` is only readable same-origin, which
		// this always is (studio.astro and the preview site share one origin).
		if (window.frameElement?.hasAttribute('data-svc-preview')) {
			try {
				window.parent.__svcAttachPreview?.(document);
			} catch {
				/* same-origin by construction, but never let a parent-hook failure break this page */
			}
			return;
		}
		// The mount point (Starlight's Footer) sits inside the content column's stacking context,
		// which paints below the header and the TOC rail no matter how high our z-index is.
		// Re-parent to <body> so `position: fixed` + z-index resolve against the root context. Skipped
		// when studio.astro's own markup already placed this element where it belongs (a direct child
		// of <body>, sized as a flex sibling of the workarea) - re-parenting would be a no-op there
		// anyway, but checking first keeps the intent explicit.
		const inStudioShell = this.ownerDocument.querySelector('iframe[data-svc-preview]') != null;

		// =========================================================================================
		// Overlay-mount gate: a top-level page visit should show exactly what a real visitor sees (the
		// saved theme, applied purely by the no-flash preload path already in place - no JS needed for
		// that part) instead of always dropping them into the overlay drawer. The overlay stays
		// reachable, but only behind an explicit URL flag now used solely by this project's own engine
		// test suites (smoke/ui-round2/treatments/targets/tiles.mjs all pass it explicitly) - a real
		// visitor never has a reason to type it. `?svc-overlay` is checked with `.has()` (bare
		// `?svc-overlay` or `?svc-overlay=1`, either works; no value comparison needed).
		// =========================================================================================
		if (!inStudioShell) {
			let hasOverlayFlag = false;
			try {
				hasOverlayFlag = new URLSearchParams(location.search).has('svc-overlay');
			} catch {
				/* malformed location.search - fall through to visitor mode, the safer default */
			}
			if (!hasOverlayFlag) {
				mountOpenInStudioPill(this);
				return; // no panel mounts - the page is exactly what a real visitor sees
			}
		}
		// =========================================================================================
		// End overlay-mount gate.
		// =========================================================================================

		if (!inStudioShell && this.parentElement !== document.body) document.body.appendChild(this);
		initCustomizer(this);
	}
}

// ==================================================================================================
// The "Open in Studio" pill mounted by the overlay-mount gate above for a plain top-level page
// visit. Deliberately outside `initCustomizer`/the shadow root: no panel state exists on this path
// at all, so this needs nothing `initCustomizer` builds. Its CSS is injected here (a plain `<style>`
// in the light document), never added to `styles.js` (whose rules only ever apply inside
// `<sl-customizer>`'s own shadow root anyway - this pill deliberately lives in the page's light DOM
// so `--sl-color-*` custom properties resolve against whatever theme is ALREADY applied to the page,
// making it light/dark aware for free without this file needing to track the page's mode itself).
// ==================================================================================================
const OPEN_IN_STUDIO_PILL_STYLE_ID = 'svc-open-in-studio-style';
const OPEN_IN_STUDIO_PILL_CSS = `
#svc-open-in-studio-pill {
	position: fixed;
	inset-block-end: 1.25rem;
	inset-inline-end: 1.25rem;
	/* Above Starlight's own fixed layers (--sl-z-index-navbar/--sl-z-index-menu, both well under
	   1000) and matched to this codebase's existing "always above real page content" convention
	   (styles.js's overlay :host uses the same literal value). */
	z-index: 2147483000;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	font: 600 0.8125rem/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
	color: var(--sl-color-text-invert);
	background: var(--sl-color-text-accent);
	border: 1px solid var(--sl-color-text-accent);
	border-radius: 999px;
	padding: 0.55rem 0.9rem;
	text-decoration: none;
	box-shadow: var(--sl-shadow-md);
}
#svc-open-in-studio-pill:hover { filter: brightness(1.08); }
#svc-open-in-studio-pill:focus-visible { outline: 2px solid var(--sl-color-text-accent); outline-offset: 2px; }
#svc-open-in-studio-pill svg { width: 0.9rem; height: 0.9rem; display: block; flex-shrink: 0; }
`;

/** @param {HTMLElement} host */
function mountOpenInStudioPill(host) {
	if (document.getElementById('svc-open-in-studio-pill')) return; // idempotent, defensive only
	if (!document.getElementById(OPEN_IN_STUDIO_PILL_STYLE_ID)) {
		const style = document.createElement('style');
		style.id = OPEN_IN_STUDIO_PILL_STYLE_ID;
		style.textContent = OPEN_IN_STUDIO_PILL_CSS;
		document.head.appendChild(style);
	}
	const pill = document.createElement('a');
	pill.id = 'svc-open-in-studio-pill';
	// D3a: `?page=` stays base-free (studio.js's own convention - see its file header) even though
	// `location.pathname` here is the browser's real, base-included path; `/studio/` itself needs
	// `withBase()` since it's what the anchor actually navigates to.
	pill.href = `${withBase('/studio/')}?page=${encodeURIComponent(stripBase(location.pathname))}`;
	pill.setAttribute('aria-label', 'Open this page in Studio');
	pill.innerHTML =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.2 6.3L20.5 11.5l-6.3 2.2L12 20l-2.2-6.3L3.5 11.5l6.3-2.2z"/></svg><span>Open in Studio</span>';
	(host.ownerDocument.body || document.body).appendChild(pill);
}

if (!customElements.get('sl-customizer')) {
	customElements.define('sl-customizer', SlCustomizer);
}

/** @param {HTMLElement} host */
function initCustomizer(host) {
	// Studio design doc, item A: sibling `<iframe data-svc-preview>` element(s) in THIS document mean
	// this is studio.astro's own top-level `<sl-customizer>` - dock instead of float, and route every
	// page-facing operation at the frame(s) instead of `document` (see attachToPageDoc below, and
	// page-doc.js). Absent in plain overlay mode, where every getPageDoc()/getPageWin() call below
	// resolves to `document`/`window` and behavior is byte-identical to before the studio existed.
	// Split mode: there can be TWO frames (light + dark lanes); `setFrameEls` records all of
	// them, `getPageDoc()`/`getFrameEl()` stay pinned to the first (the primary lane).
	const frameEls = Array.from(host.ownerDocument.querySelectorAll('iframe[data-svc-preview]'));
	if (frameEls.length) {
		setFrameEls(frameEls);
		host.dataset.docked = 'true';
	}
	const studio = isStudio();

	// A share link that competes with real work saved here does not replace it yet: `state` starts
	// as the saved theme and the share-link dialog (opened at the end of this function) asks first.
	const initialTheme = loadInitialState();
	/** @type {import('../core/state.js').ThemeState} */
	let state = initialTheme.state;
	let lastSaveOk = persistState(state);
	let lastSaveAt = Date.now();

	// ---- UI-state contract: open groups, panel scroll offset, filter
	// text, and drawer-collapsed persist in sessionStorage (per-tab, not per-theme) and are restored
	// synchronously before this function returns. Also carries `activeGroup` (below). -------------
	let uiState = loadUiState();
	function persistUi(partial) {
		// Re-reads sessionStorage fresh on every write - studio.js owns its OWN fields
		// (`studioPage`/`studioDevice`/etc.) in this SAME key, written independently at times this
		// module has no visibility into; merging onto a stale in-memory snapshot would silently wipe
		// those fields back out on the next unrelated change (confirmed empirically while testing).
		uiState = { ...loadUiState(), ...partial };
		saveUiState(uiState);
	}
	let openGroupsSet = new Set(Array.isArray(uiState.openGroups) ? uiState.openGroups : DEFAULT_OPEN_GROUPS);
	let pendingScrollTop = typeof uiState.scrollTop === 'number' ? uiState.scrollTop : 0;
	let followOnPage = uiState.followOnPage !== false; // default on
	/** Active group persists in sessionStorage['svc-ui']. */
	let activeGroupName = RAIL_GROUPS.includes(uiState.activeGroup) ? uiState.activeGroup : 'Presets';

	// ---- Per-section open/closed state. Keyed by `group::section` so an absent key means
	// "use the default", not "closed". The default is "every section starts open" (an earlier
	// build only opened the first section by default - `isFirstInGroup` is still threaded through
	// for callers/bookkeeping that need to know which section is first, but no longer gates the
	// default). -------------------------------
	let sectionOpenOverrides =
		uiState.openSections && typeof uiState.openSections === 'object' && !Array.isArray(uiState.openSections)
			? { ...uiState.openSections }
			: {};
	/** @type {Map<string, string>} groupName -> its first section's name. */
	const firstSectionByGroup = new Map();
	function isSectionOpen(groupName, sectionName, isFirstInGroup) {
		const key = `${groupName}::${sectionName}`;
		return Object.prototype.hasOwnProperty.call(sectionOpenOverrides, key) ? sectionOpenOverrides[key] : true;
	}
	function onSectionToggle(groupName, sectionName, isOpen) {
		sectionOpenOverrides = { ...sectionOpenOverrides, [`${groupName}::${sectionName}`]: isOpen };
		persistUi({ openSections: sectionOpenOverrides });
	}
	function isSectionOpenByDefault(groupName, sectionName) {
		return isSectionOpen(groupName, sectionName, firstSectionByGroup.get(groupName) === sectionName);
	}
	/** @type {((state: import('../core/state.js').ThemeState) => void)[]} */
	let sectionDotRefreshers = [];

	// =============================================================================================
	// Per-CARD open/closed state, one level below the section state just above - same "every card starts
	// open unless a restored choice says otherwise" contract, keyed by the globally-unique control id
	// (a control's id is scoped to exactly one group/section by construction, so this is equivalent
	// to "per group" without needing a compound key).
	// =============================================================================================
	let cardOpenOverrides =
		uiState.openCards && typeof uiState.openCards === 'object' && !Array.isArray(uiState.openCards) ? { ...uiState.openCards } : {};
	function isCardOpen(controlId) {
		return Object.prototype.hasOwnProperty.call(cardOpenOverrides, controlId) ? cardOpenOverrides[controlId] : true;
	}
	function onCardToggle(controlId, isOpen) {
		cardOpenOverrides = { ...cardOpenOverrides, [controlId]: isOpen };
		persistUi({ openCards: cardOpenOverrides });
	}
	// =============================================================================================
	// End marked block (continues below at the group-header Expand all / Collapse all buttons).
	// =============================================================================================

	// ---- Undo/redo. `historyStepCounter` gives every discrete action (preset/reset-
	// group/reset-all/import) its own never-coalescing key; ordinary control edits key off the
	// control id itself so a slider drag - many `input` events, one id - coalesces into one step. ----
	const history = createHistory({ limit: 100, coalesceMs: 650 });
	let historyStepCounter = 0;
	const distinctHistoryKey = (prefix) => `${prefix}:${historyStepCounter++}`;
	/** @type {Set<() => void>} Notified after every state-affecting change - studio.js's top bar and contrast check/
	 * undo-redo buttons/save status subscribe via `host.__svc.subscribe`. */
	const subscribers = new Set();
	function notifySubscribers() {
		for (const fn of subscribers) {
			try {
				fn();
			} catch {
				/* a subscriber's own bug must never break the panel */
			}
		}
	}

	// ---- adopted stylesheets: one per previewed PAGE document (S9: one per lane), one for the
	// studio HOST document (studio mode only). Each lane's sheet is (re)created per document inside
	// attachToPageDoc - a CSSStyleSheet is bound to the realm it was constructed in, and a frame
	// navigation replaces the page's document/window wholesale. `hostSheet` targets `document`
	// (never navigates), created once, here. In overlay mode `hostSheet` stays null forever. --------
	/** @type {Map<Document, CSSStyleSheet>} */
	const laneSheets = new Map();
	/** @type {CSSStyleSheet | null} */
	let hostSheet = null;
	if (studio) {
		hostSheet = new CSSStyleSheet();
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, hostSheet];
	}

	/** @param {string} cssText */
	function applyCssEverywhere(cssText) {
		for (const sheet of laneSheets.values()) sheet.replaceSync(cssText);
		if (hostSheet) hostSheet.replaceSync(cssText);
	}

	function syncThemeButton() {
		if (studio) return; // S2: studio drops the sun/moon button entirely.
		const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
		const next = theme === 'dark' ? 'light' : 'dark';
		themeToggleBtn.innerHTML = theme === 'light' ? SUN_ICON_SVG : MOON_ICON_SVG;
		themeToggleBtn.setAttribute('aria-label', `Currently ${theme} mode. Click to switch to ${next}.`);
		themeToggleBtn.title = `${theme === 'light' ? 'Light' : 'Dark'} mode - switch to ${next}`;
	}

	// ---- re-attach on every frame navigation, per lane (studio design doc, item D; S9 extends this
	// to every lane). Three triggers call this with a lane's current document: (1) synchronously,
	// once per lane, at the end of this function; (2) that lane's embedded panel.js, via
	// `window.__svcAttachPreview`; (3) that lane iframe's `load` event, a fallback. All three are
	// idempotent per document (`attachedDocs`). In overlay mode only trigger (1) ever fires. ---------
	const attachedDocs = new WeakSet();
	let bodyBuilt = false;
	/** @param {Document | null} doc */
	function attachToPageDoc(doc) {
		if (!doc || doc.URL === 'about:blank' || doc.readyState === 'loading') return;
		if (attachedDocs.has(doc)) return;
		attachedDocs.add(doc);

		doc.getElementById(PRELOAD_STYLE_ID)?.remove();
		stampTocLevels(doc);
		applySiteTitle(doc, getValue(state, 'site.title')); // Reapply on every lane/navigation.
		harvestSidebarTemplates(doc);

		const win = doc.defaultView || window;
		const sheet = new win.CSSStyleSheet();
		laneSheets.set(doc, sheet);
		doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
		sheet.replaceSync(emitCss(state, { forPreview: true }));
		ensureFontsInjectedIn(doc, state);

		renderSidebar(doc, state.ia);

		const isPrimary = doc === getPageDoc();
		// Host mirrors the PRIMARY lane's theme. A secondary Split lane's theme is FORCED by
		// studio.js instead and must never drive the host/chrome mode.
		if (isPrimary && doc.documentElement.dataset.theme) {
			document.documentElement.dataset.theme = doc.documentElement.dataset.theme;
			syncThemeButton();
		}
		if (studio && isPrimary) targetHighlighter.bindFrameWindow(win);

		if (!bodyBuilt && isPrimary) {
			bodyBuilt = true;
			buildBody();
			if (openGroupsSet.has('Typography') || (studio && activeGroupName === 'Typography')) ensureFontPreviewFacesInjected();
			if (!studio) bodyEl.scrollTop = pendingScrollTop;
		}
	}

	function persistPreviewCss() {
		try {
			localStorage.setItem(LOCALSTORAGE_CSS_KEY, buildPreviewCss(state));
		} catch {}
	}

	let rafHandle = null;
	let contrastDirty = false;

	function scheduleApply(colorsChanged) {
		if (colorsChanged) contrastDirty = true;
		if (rafHandle != null) return;
		rafHandle = requestAnimationFrame(() => {
			rafHandle = null;
			applyCssEverywhere(emitCss(state, { forPreview: true }));
			for (const doc of laneSheets.keys()) ensureFontsInjectedIn(doc, state);
			for (const doc of laneSheets.keys()) applySiteTitle(doc, getValue(state, 'site.title')); // Live as you type.
			lastSaveOk = persistState(state);
			lastSaveAt = Date.now();
			persistPreviewCss();
			if (contrastDirty) {
				contrastDirty = false;
				contrastBlock.refresh(computeContrastRows());
				for (const id of Object.keys(COLOR_ASSIST)) controlRows.get(id)?.refresh(state);
				for (const id of ROLE_OVERRIDE_IDS) controlRows.get(id)?.refresh(state);
			}
			for (const refreshDots of sectionDotRefreshers) refreshDots(state);
			if (studio) refreshStudioChrome();
			notifySubscribers();
		});
	}

	// ---- panel DOM -----------------------------------------------------------------------------
	const shadow = host.attachShadow({ mode: 'open' });
	const styleEl = document.createElement('style');
	styleEl.textContent = panelStyles;
	shadow.appendChild(styleEl);

	// ---- "what does this control change?" (the rail's own scroll-to-surface reuses this same
	// `notify`) ----------------------------------------------------------------
	const targetHighlighter = createTargetHighlighter(shadow, { getPageDoc, getFrameEl });
	targetHighlighter.setEnabled(followOnPage);

	// ---- control change handlers (shared by every control row + the preset gallery, both modes) --
	const controlHandlers = {
		onChange: onControlChange,
		onReset: onControlReset,
		onApplyPreset: onApplyPreset,
		getResolvedColor: getResolvedColor,
		onTarget: (targetSelector, opts) => targetHighlighter.notify(targetSelector, opts),
	};

	function onControlChange(id, value) {
		history.record(state, `control:${id}`, Date.now());
		state = setValue(state, id, value);
		scheduleApply(controlsById.get(id)?.group === 'Colors');
	}

	// =============================================================================================
	// `onChangeMany` lets the hex color field commit hue AND (for accent/gray) chroma -
	// two different control ids - as ONE undo step: routing both through `onControlChange` would
	// record two separate history snapshots (different coalescing keys), breaking the "one undo
	// step" contract for a single hex-field commit. Same one-history-step shape `onApplyPreset`/
	// `onResetGroup` already use below.
	//
	// The optional `coalesceKey` parameter is a one-line, backward-compatible addition needed for
	// the color popover's own drag coalescing. Every EXISTING caller (the hex field's Enter/blur
	// commit) omits it and keeps recording a distinct step per call, exactly as before. The
	// popover's `color-changed` event fires continuously during a drag - without a STABLE key
	// repeated across those calls, each one would record its own undo step (unlike a plain slider's
	// `input` events, which already coalesce by the single control id they share) - see
	// controls.js's `buildColorAssistRow`.
	// =============================================================================================
	function onControlChangeMany(entries, coalesceKey) {
		history.record(state, coalesceKey ? `multi:${coalesceKey}` : distinctHistoryKey('multi'), Date.now());
		let colorsChanged = false;
		for (const [id, value] of entries) {
			state = setValue(state, id, value);
			if (controlsById.get(id)?.group === 'Colors') colorsChanged = true;
		}
		scheduleApply(colorsChanged);
	}
	controlHandlers.onChangeMany = onControlChangeMany;

	function onControlReset(id) {
		const control = controlsById.get(id);
		if (!control) return;
		onControlChange(id, control.default);
		controlRows.get(id)?.refresh(state);
	}

	function onApplyPreset(presetId) {
		history.record(state, distinctHistoryKey('preset'), Date.now());
		state = applyPreset(state, presetId);
		scheduleApply(true);
		fullRerenderControls();
	}

	function onResetAll() {
		history.record(state, distinctHistoryKey('reset-all'), Date.now());
		state = { ...state, values: {}, preset: 'starlight-default' };
		scheduleApply(true);
		fullRerenderControls();
	}

	/** The panel column's reset-group button - one undo step. */
	function onResetGroup(groupName) {
		if (groupName === 'Navigation') {
			if (state.ia === null) return;
			history.record(state, distinctHistoryKey('reset-group:Navigation'), Date.now());
			state = { ...state, ia: null };
			renderSidebar(getPageDoc(), state.ia);
			iaEditor.refresh(state);
			notifySubscribers();
			if (studio) refreshStudioChrome();
			return;
		}
		const idsInGroup = controls.filter((c) => c.group === groupName).map((c) => c.id);
		if (!idsInGroup.some((id) => Object.prototype.hasOwnProperty.call(state.values, id))) return;
		history.record(state, distinctHistoryKey(`reset-group:${groupName}`), Date.now());
		const nextValues = { ...state.values };
		for (const id of idsInGroup) delete nextValues[id];
		state = { ...state, values: nextValues };
		scheduleApply(groupName === 'Colors');
		fullRerenderControls();
	}

	function doUndo() {
		const restored = history.undo(state);
		if (restored == null) return;
		state = restored;
		afterHistoryChange();
	}
	function doRedo() {
		const restored = history.redo(state);
		if (restored == null) return;
		state = restored;
		afterHistoryChange();
	}
	function afterHistoryChange() {
		scheduleApply(true);
		fullRerenderControls();
		iaEditor.refresh(state);
		renderSidebar(getPageDoc(), state.ia);
	}

	function getResolvedColor(controlId) {
		const token = RESOLVABLE_COLOR_TOKEN_BY_ID[controlId];
		if (!token) return '#888888';
		const rgb = resolveCssColor('color', `var(${token})`, null);
		try {
			return formatHex(rgb);
		} catch {
			return '#888888';
		}
	}

	/** Persists only genuine user clicks on a group's toggle (overlay's accordion only - studio's
	 * rail persists `activeGroup` instead, see `openGroup` below). */
	function onGroupToggle(groupName, isOpen) {
		if (isOpen) openGroupsSet.add(groupName);
		else openGroupsSet.delete(groupName);
		persistUi({ openGroups: [...openGroupsSet] });
		if (isOpen && groupName === 'Typography') ensureFontPreviewFacesInjected();
	}

	// ---- contrast readout (Colors group, both modes) ------------------------------------------
	const contrastBlock = createContrastBlock();

	// ---- IA editor ("Navigation structure (advanced)"/"Structure (advanced)"), built once so it
	// keeps its own internal state, shared by whichever chrome wraps it. ----------------------------
	const iaEditor = createIaEditor(state, {
		// A Structure (advanced) edit never called `history.record` at all, so
		// Undo silently skipped it and undid whatever OTHER step preceded it instead (repro: apply a
		// preset, drag a row, Undo once - the preset was undone, not the drag). `coalesceKey` (from
		// ia-editor.js's per-item rename key) lets a whole typing+blur gesture coalesce into one step,
		// same "many events, one key, one step" contract `history.js` already gives a slider drag; every
		// other structural edit (move/indent/delete/drag-drop/badge/checkbox/import/...) omits it and
		// always lands as its own distinct step, matching how `onApplyPreset`/`onResetGroup` behave
		// below. The no-op guard (unchanged `ia`) stops a rename's final blur/Enter `change` call from
		// recording a SECOND, redundant step when `input` already committed the identical value -
		// the same class of bug as the hex field's own "no-op unless the text actually changed" guard.
		onIaChange(ia, coalesceKey) {
			if (JSON.stringify(ia) === JSON.stringify(state.ia)) return;
			history.record(state, coalesceKey ? `ia:${coalesceKey}` : distinctHistoryKey('ia'), Date.now());
			state = { ...state, ia };
			lastSaveOk = persistState(state);
			lastSaveAt = Date.now();
			renderSidebar(getPageDoc(), state.ia);
			notifySubscribers();
			if (studio) refreshStudioChrome();
		},
	}, { studio }); // Studio gets the restyled tree; overlay stays exactly as before.

	// ---- export dialog -------------------------------------------------------------------------
	const exportDialog = createExportDialog({
		getState: () => state,
		onImportState: importStateFromJson,
	});
	shadow.appendChild(exportDialog.root);
	// The contrast-warnings dialog (opened from the context line's contrast check) lives here (not in studio.js's light
	// DOM) so it can reuse this shadow root's `.svc-dialog*` CSS - a dialog built in light DOM would
	// have no styling at all (styles.js's stylesheet only applies inside this shadow root).
	const contrastDialog = createContrastDialog();
	if (studio) shadow.appendChild(contrastDialog.root);
	// Opening the shared theme goes through the import path, so it is one undo step and Undo
	// brings the saved theme back.
	const shareDialog = createShareLinkDialog({ onOpenShared: (shared) => importStateFromJson(shared) });
	shadow.appendChild(shareDialog.root);

	function importStateFromJson(parsed) {
		history.record(state, distinctHistoryKey('import'), Date.now());
		const base = defaultState();
		state = {
			v: 1,
			starlight: base.starlight,
			preset: typeof parsed?.preset === 'string' ? parsed.preset : base.preset,
			values:
				parsed?.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)
					? parsed.values
					: {},
			ia: Array.isArray(parsed?.ia) ? parsed.ia : null,
			meta: { name: (parsed?.meta && typeof parsed.meta.name === 'string' && parsed.meta.name) || base.meta.name },
		};
		scheduleApply(true);
		fullRerenderControls();
		iaEditor.refresh(state);
		renderSidebar(getPageDoc(), state.ia);
	}

	// ---- control rows, one shared Map regardless of which chrome built them -----------------------
	/** @type {Map<string, {root: HTMLElement, refresh: Function}>} */
	const controlRows = new Map();
	/** @type {HTMLElement} */
	let presetGalleryBody;

	function fullRerenderControls() {
		presetGalleryBody.replaceChildren(createPresetGallery(presets, state, controlHandlers));
		for (const { refresh } of controlRows.values()) refresh(state);
	}

	/** @type {() => void} Assigned per-branch below. */
	let buildBody;
	/** @type {(collapsed: boolean) => void} Overlay only; a no-op in studio mode. */
	let setCollapsed = () => {};
	/** @type {() => void} Studio only; a no-op in overlay mode. */
	let refreshStudioChrome = () => {};

	if (!studio) {
		// =========================================================================================
		// Overlay mode (S16: byte-identical to B).
		// =========================================================================================
		const drawer = document.createElement('div');
		drawer.className = 'svc-drawer';
		shadow.appendChild(drawer);

		const fab = document.createElement('button');
		fab.type = 'button';
		fab.className = 'svc-fab';
		fab.textContent = '⚙';
		fab.setAttribute('aria-label', 'Open Starlight Visual Customizer');
		fab.addEventListener('click', () => setCollapsed(false));
		drawer.appendChild(fab);

		const panelEl = document.createElement('div');
		panelEl.className = 'svc-panel';
		drawer.appendChild(panelEl);

		const header = document.createElement('div');
		header.className = 'svc-header';
		const heading = document.createElement('h2');
		heading.textContent = 'Customizer';
		header.appendChild(heading);
		const headerActions = document.createElement('div');
		headerActions.className = 'svc-header-actions';
		const followLabel = document.createElement('label');
		followLabel.className = 'svc-follow-toggle';
		const followCheckbox = document.createElement('input');
		followCheckbox.type = 'checkbox';
		followCheckbox.checked = followOnPage;
		followCheckbox.setAttribute('aria-label', 'Follow on page: scroll to and highlight the element a control changes');
		followCheckbox.addEventListener('change', () => {
			followOnPage = followCheckbox.checked;
			targetHighlighter.setEnabled(followOnPage);
			persistUi({ followOnPage });
		});
		followLabel.appendChild(followCheckbox);
		followLabel.appendChild(document.createTextNode('Follow on page'));
		headerActions.appendChild(followLabel);
		const dockToggleBtn = document.createElement('button');
		dockToggleBtn.type = 'button';
		dockToggleBtn.className = 'svc-btn';
		dockToggleBtn.textContent = 'Dock';
		dockToggleBtn.title = 'Open the docked studio layout with this page';
		dockToggleBtn.addEventListener('click', () => {
			// D3a: same base handling as the "Open in Studio" pill above - `?page=` stays base-free.
			location.href = `${withBase('/studio/')}?page=${stripBase(location.pathname)}`;
		});
		headerActions.appendChild(dockToggleBtn);
		var themeToggleBtn = document.createElement('button');
		themeToggleBtn.type = 'button';
		themeToggleBtn.className = 'svc-icon-btn';
		headerActions.appendChild(themeToggleBtn);
		const collapseBtn = document.createElement('button');
		collapseBtn.type = 'button';
		collapseBtn.className = 'svc-icon-btn';
		collapseBtn.textContent = '✕';
		collapseBtn.setAttribute('aria-label', 'Collapse customizer panel');
		collapseBtn.addEventListener('click', () => setCollapsed(true));
		headerActions.appendChild(collapseBtn);
		header.appendChild(headerActions);
		panelEl.appendChild(header);

		const toolbar = document.createElement('div');
		toolbar.className = 'svc-toolbar';
		const filterInput = document.createElement('input');
		filterInput.type = 'search';
		filterInput.className = 'svc-filter';
		filterInput.placeholder = 'Filter controls…';
		filterInput.setAttribute('aria-label', 'Filter controls by label');
		filterInput.value = typeof uiState.filterText === 'string' ? uiState.filterText : '';
		filterInput.addEventListener('input', () => {
			applyControlFilter(bodyEl, filterInput.value, (groupName) => openGroupsSet.has(groupName), isSectionOpenByDefault, isCardOpen);
			persistUi({ filterText: filterInput.value });
		});
		toolbar.appendChild(filterInput);
		const resetAllBtn = document.createElement('button');
		resetAllBtn.type = 'button';
		resetAllBtn.className = 'svc-btn';
		resetAllBtn.textContent = 'Reset all';
		resetAllBtn.addEventListener('click', () => onResetAll());
		toolbar.appendChild(resetAllBtn);
		const exportOpenBtn = document.createElement('button');
		exportOpenBtn.type = 'button';
		exportOpenBtn.className = 'svc-btn svc-btn-primary';
		exportOpenBtn.textContent = 'Export…';
		exportOpenBtn.addEventListener('click', () => exportDialog.open());
		toolbar.appendChild(exportOpenBtn);
		panelEl.appendChild(toolbar);

		var bodyEl = document.createElement('div');
		bodyEl.className = 'svc-body';
		panelEl.appendChild(bodyEl);
		let scrollSaveHandle = null;
		bodyEl.addEventListener(
			'scroll',
			() => {
				pendingScrollTop = bodyEl.scrollTop;
				if (scrollSaveHandle != null) return;
				scrollSaveHandle = requestAnimationFrame(() => {
					scrollSaveHandle = null;
					persistUi({ scrollTop: pendingScrollTop });
				});
			},
			{ passive: true }
		);

		const footer = document.createElement('div');
		footer.className = 'svc-footer';
		const shareBtn = document.createElement('button');
		shareBtn.type = 'button';
		shareBtn.className = 'svc-btn';
		shareBtn.textContent = 'Copy share link';
		shareBtn.addEventListener('click', async () => {
			const url = buildShareUrl(location, encodeState(state));
			try {
				await navigator.clipboard.writeText(url);
				flashText(shareBtn, 'Copied!');
			} catch {
				flashText(shareBtn, 'Copy failed');
			}
		});
		footer.appendChild(shareBtn);
		panelEl.appendChild(footer);

		setCollapsed = (collapsed) => {
			host.dataset.collapsed = String(collapsed);
			persistUi({ collapsed });
			if (!collapsed) bodyEl.scrollTop = pendingScrollTop;
		};

		themeToggleBtn.addEventListener('click', () => {
			const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
			const next = current === 'light' ? 'dark' : 'light';
			const pageDoc = getPageDoc();
			if (pageDoc) pageDoc.documentElement.dataset.theme = next;
			document.documentElement.dataset.theme = next;
			localStorage.setItem('starlight-theme', next);
			const select = pageDoc?.querySelector('starlight-theme-select select');
			if (select) select.value = next;
			getPageWin()?.StarlightThemeProvider?.updatePickers?.(next);
			syncThemeButton();
			for (const id of Object.keys(COLOR_ASSIST)) controlRows.get(id)?.refresh(state);
			for (const id of ROLE_OVERRIDE_IDS) controlRows.get(id)?.refresh(state);
		});

		const navSection = createGroupSection('Navigation', [], state, controlHandlers, {
			open: openGroupsSet.has('Navigation'),
			title: 'Navigation structure (advanced)',
			onToggle: onGroupToggle,
		});
		const navNote = document.createElement('p');
		navNote.className = 'svc-ia-note';
		navNote.textContent = 'Exports sidebar config for this site; most users won’t need this.';
		navSection.body.appendChild(navNote);
		navSection.body.appendChild(iaEditor.root);

		buildBody = function () {
			bodyEl.replaceChildren();
			controlRows.clear();
			firstSectionByGroup.clear();
			sectionDotRefreshers = [];

			const presetsSection = createGroupSection('Presets', [], state, controlHandlers, {
				open: openGroupsSet.has('Presets'),
				onToggle: onGroupToggle,
			});
			presetGalleryBody = presetsSection.body;
			presetGalleryBody.appendChild(createPresetGallery(presets, state, controlHandlers));
			bodyEl.appendChild(presetsSection.root);

			for (const groupName of GROUPS) {
				if (groupName === 'Presets') continue;
				const groupControls = controls.filter((c) => c.group === groupName);
				const section = createGroupSection(groupName, groupControls, state, controlHandlers, {
					open: openGroupsSet.has(groupName),
					onToggle: onGroupToggle,
					isSectionOpen,
					onSectionToggle,
					isCardOpen,
					onCardToggle,
				});
				for (const [id, row] of section.controlRows) controlRows.set(id, row);
				if (section.firstSectionName) firstSectionByGroup.set(groupName, section.firstSectionName);
				sectionDotRefreshers.push(section.refreshSectionDots);
				if (groupName === 'Colors') {
					const contrastSectionBody = section.root.querySelector(".svc-section[data-section='Contrast'] .svc-section-body");
					(contrastSectionBody ?? section.body).appendChild(contrastBlock.root);
				}
				bodyEl.appendChild(section.root);
			}

			bodyEl.appendChild(navSection.root);
			applyControlFilter(bodyEl, filterInput.value, (groupName) => openGroupsSet.has(groupName), isSectionOpenByDefault, isCardOpen);
		};
	} else {
		// =========================================================================================
		// Studio mode (S1-S15): rail + panel column.
		// =========================================================================================
		// The rail is a column: the group tabs (a tablist), then the "Studio sizing" control pinned to
		// its bottom. The control sits outside the tablist on purpose - a tablist may only contain
		// tabs - so `.svc-rail-tabs`, not `.svc-rail`, carries the tablist role and the arrow keys.
		const rail = document.createElement('div');
		rail.className = 'svc-rail';
		shadow.appendChild(rail);
		const railTabs = document.createElement('div');
		railTabs.className = 'svc-rail-tabs';
		railTabs.setAttribute('role', 'tablist');
		railTabs.setAttribute('aria-orientation', 'vertical');
		railTabs.setAttribute('aria-label', 'Customizer groups');
		rail.appendChild(railTabs);

		// =============================================================================================
		// Panel-collapse state. An earlier build let clicking the already-selected rail item collapse
		// the panel column; that affordance was removed (see the rail click handler below) - collapsing
		// now happens ONLY via the panel column's header collapse button and the `\` key, both still
		// wired through `setPanelCollapsed`/`togglePanelCollapse` below. `styles.js` is never touched
		// for this - both the host's own width and the panel column's visibility are set here as plain
		// inline styles/properties, which win over any external stylesheet rule by specificity alone.
		// =============================================================================================
		let panelCollapsed = uiState.panelCollapsed === true;
		/** @param {boolean} next */
		function setPanelCollapsed(next) {
			panelCollapsed = next;
			persistUi({ panelCollapsed: next });
			panelCol.hidden = next;
			// `:host([data-docked='true'])` (styles.js) sets a fixed 412px width (72px rail + 340px
			// panel column) - an inline style on the SAME element beats that external rule regardless
			// of specificity, so this alone reclaims the panel's width for the preview when collapsed.
			host.style.width = next ? '72px' : '';
			host.style.flex = next ? '0 0 72px' : '';
			collapseBtn.setAttribute('aria-expanded', String(!next));
			collapseBtn.title = next ? 'Expand panel (\\)' : 'Collapse panel (\\)';
			collapseBtn.setAttribute('aria-label', next ? 'Expand panel' : 'Collapse panel');
			collapseBtn.innerHTML = next
				? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
				: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
		}
		// A small inline `<style>` (never styles.js) for the collapse button itself, reusing
		// the panel's own already contrast-verified tokens.
		const collapseBtnStyle = document.createElement('style');
		collapseBtnStyle.textContent = `.svc-panel-collapse-btn { border: 1px solid var(--ui-line, #dde1e8); background: var(--ui-panel, #fff); color: var(--ui-text, #343b4a); border-radius: 6px; width: 1.75rem; height: 1.75rem; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; } .svc-panel-collapse-btn:hover { background: var(--ui-bg, #f5f6f8); } .svc-panel-collapse-btn:focus-visible { outline: 2px solid var(--ui-accent, #4453c9); outline-offset: 1px; }`;
		shadow.appendChild(collapseBtnStyle);
		const collapseBtn = document.createElement('button');
		collapseBtn.type = 'button';
		collapseBtn.className = 'svc-panel-collapse-btn';
		// ===== end panel-collapse declarations - the button is wired into the filter row below,
		// and setPanelCollapsed(panelCollapsed) is applied once buildBody has run, further down =====

		/** @type {Map<string, HTMLButtonElement>} */
		const railItems = new Map();
		for (const groupName of RAIL_GROUPS) {
			const displayTitle = RAIL_TITLES[groupName] ?? groupName;
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'svc-rail-item';
			btn.dataset.group = groupName;
			btn.setAttribute('role', 'tab');
			btn.setAttribute('aria-selected', 'false');
			btn.setAttribute('aria-controls', 'svc-panel-col');
			btn.tabIndex = -1;
			btn.title = displayTitle;
			const iconWrap = document.createElement('span');
			iconWrap.className = 'svc-rail-item-icon';
			iconWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GROUP_ICON_PATHS[groupName] ?? '<circle cx="12" cy="12" r="4"/>'}</svg>`;
			const labelEl = document.createElement('span');
			labelEl.className = 'svc-rail-item-label';
			labelEl.textContent = groupName === 'Navigation' ? 'Structure' : displayTitle;
			const dot = document.createElement('span');
			dot.className = 'svc-rail-item-dot';
			dot.hidden = true;
			btn.appendChild(iconWrap);
			btn.appendChild(labelEl);
			btn.appendChild(dot);
			btn.addEventListener('click', () => {
				// =====================================================================================
				// Clicking the ALREADY-selected rail item used to collapse the panel column - that
				// affordance is removed (a re-click is now a plain no-op-on-collapse: it keeps
				// re-selecting the same group,
				// same as any other rail click, so it still re-scrolls to the group's target exactly
				// the way a normal selection already does - no new scroll behavior is added here).
				// Collapsing is still reachable via the panel-header collapse button and the `\` key
				// (`setPanelCollapsed`/`togglePanelCollapse`, unchanged). A collapsed panel's rail item
				// click still needs to OPEN it (kept).
				// =====================================================================================
				if (panelCollapsed) setPanelCollapsed(false);
				filterInput.value = '';
				applyPanelFilter('');
				openGroup(groupName);
			});
			railTabs.appendChild(btn);
			railItems.set(groupName, btn);

			if (RAIL_SEPARATOR_AFTER.has(groupName)) {
				const sep = document.createElement('div');
				sep.className = 'svc-rail-sep';
				railTabs.appendChild(sep);
			}
		}
		// S4 keyboard contract: the rail is a tablist (Up/Down/Home/End move + activate).
		railTabs.addEventListener('keydown', (event) => {
			const order = RAIL_GROUPS;
			const currentIndex = order.indexOf(activeGroupName);
			let nextIndex = null;
			if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % order.length;
			else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + order.length) % order.length;
			else if (event.key === 'Home') nextIndex = 0;
			else if (event.key === 'End') nextIndex = order.length - 1;
			if (nextIndex == null) return;
			event.preventDefault();
			filterInput.value = '';
			applyPanelFilter('');
			openGroup(order[nextIndex]);
			railItems.get(order[nextIndex])?.focus();
		});

		// "Studio sizing": minus, the percentage, plus, and a small label, pinned to the bottom of the
		// rail. It zooms the studio's own chrome, never the preview (studio-sizing.js, core/sizing.js).
		// studio.astro's head script already applied the stored size before the first paint.
		const sizing = document.createElement('div');
		sizing.className = 'svc-rail-sizing';
		sizing.setAttribute('role', 'group');
		sizing.setAttribute('aria-label', 'Studio sizing');
		const sizingRow = document.createElement('div');
		sizingRow.className = 'svc-rail-sizing-row';
		const sizingDown = document.createElement('button');
		sizingDown.type = 'button';
		sizingDown.className = 'svc-rail-sizing-btn';
		sizingDown.textContent = '\u2212';
		sizingDown.setAttribute('aria-label', 'Smaller studio');
		sizingDown.title = 'Smaller studio';
		const sizingValue = document.createElement('output');
		sizingValue.className = 'svc-rail-sizing-value';
		sizingValue.setAttribute('aria-live', 'polite');
		const sizingUp = document.createElement('button');
		sizingUp.type = 'button';
		sizingUp.className = 'svc-rail-sizing-btn';
		sizingUp.textContent = '+';
		sizingUp.setAttribute('aria-label', 'Larger studio');
		sizingUp.title = 'Larger studio';
		const sizingLabel = document.createElement('span');
		sizingLabel.className = 'svc-rail-sizing-label';
		sizingLabel.textContent = 'Studio sizing';
		sizingRow.append(sizingDown, sizingValue, sizingUp);
		sizing.append(sizingRow, sizingLabel);
		rail.appendChild(sizing);
		// The chosen size is stored; the size shown and applied is the effective one, which caps
		// sizes above 100% while the window is narrower than 900px (core/sizing.js explains why).
		let chosenSizing = loadSizing();
		function renderSizing() {
			const narrow = window.innerWidth < SIZING_NARROW_BELOW;
			const shown = effectiveSizing(chosenSizing, window.innerWidth);
			setChromeZoom(shown);
			sizingValue.textContent = formatSizing(shown);
			sizingDown.disabled = shown === SIZING_STEPS[0];
			const capped = narrow && shown >= DEFAULT_SIZING;
			sizingUp.disabled = capped || shown === SIZING_STEPS[SIZING_STEPS.length - 1];
			sizingUp.title = capped ? `Larger sizes need a window at least ${SIZING_NARROW_BELOW}px wide` : 'Larger studio';
		}
		/** @param {number} direction */
		function stepSizing(direction) {
			const shown = effectiveSizing(chosenSizing, window.innerWidth);
			const next = effectiveSizing(nextSizing(shown, direction), window.innerWidth);
			if (next === shown) return;
			chosenSizing = next;
			saveSizing(next);
			renderSizing();
		}
		sizingDown.addEventListener('click', () => stepSizing(-1));
		sizingUp.addEventListener('click', () => stepSizing(1));
		let sizingWasNarrow = window.innerWidth < SIZING_NARROW_BELOW;
		window.addEventListener('resize', () => {
			const narrow = window.innerWidth < SIZING_NARROW_BELOW;
			if (narrow === sizingWasNarrow) return;
			sizingWasNarrow = narrow;
			renderSizing();
		});
		renderSizing();

		const panelCol = document.createElement('div');
		panelCol.className = 'svc-panel-col';
		panelCol.id = 'svc-panel-col';
		panelCol.setAttribute('role', 'tabpanel');
		panelCol.setAttribute('aria-label', 'Customizer controls');
		shadow.appendChild(panelCol);

		const filterRow = document.createElement('div');
		filterRow.className = 'svc-panel-filter-row';
		var filterInput = document.createElement('input');
		filterInput.type = 'search';
		filterInput.className = 'svc-filter';
		filterInput.placeholder = 'Filter controls…';
		filterInput.setAttribute('aria-label', 'Filter controls by label');
		filterInput.value = typeof uiState.filterText === 'string' ? uiState.filterText : '';
		filterInput.addEventListener('input', () => applyPanelFilter(filterInput.value));
		filterRow.appendChild(filterInput);
		// ===== The collapse button sits beside the filter (not in groupHeader, which gets its own
		// Expand/Collapse-all buttons below) - inline layout styles here,
		// never styles.js, since .svc-panel-filter-row's own CSS (that file) only ever laid out one
		// child (the filter input) before this. =====
		filterRow.style.display = 'flex';
		filterRow.style.alignItems = 'center';
		filterRow.style.gap = '0.5rem';
		filterInput.style.flex = '1 1 auto';
		filterInput.style.minWidth = '0';
		collapseBtn.addEventListener('click', () => setPanelCollapsed(!panelCollapsed));
		filterRow.appendChild(collapseBtn);
		// ===== end collapse-button wiring =====
		panelCol.appendChild(filterRow);

		const groupHeader = document.createElement('div');
		groupHeader.className = 'svc-group-header';
		const eyebrow = document.createElement('p');
		eyebrow.className = 'svc-group-eyebrow';
		const groupTitleEl = document.createElement('h2');
		groupTitleEl.className = 'svc-group-title';
		const groupDescEl = document.createElement('p');
		groupDescEl.className = 'svc-group-desc';
		const resetGroupBtn = document.createElement('button');
		resetGroupBtn.type = 'button';
		resetGroupBtn.className = 'svc-reset-group';
		resetGroupBtn.innerHTML = '<span aria-hidden="true">↺</span><span></span>';
		resetGroupBtn.addEventListener('click', () => {
			onResetGroup(activeGroupName);
			refreshStudioChrome();
		});
		// Expand all / Collapse all, beside the
		// existing reset-group button. Button click handlers are wired further below, once
		// `groupPanelsByName` exists - see that block for the two-stage Collapse all logic.
		const groupHeaderActions = document.createElement('div');
		groupHeaderActions.className = 'svc-group-header-actions';
		const expandAllBtn = document.createElement('button');
		expandAllBtn.type = 'button';
		expandAllBtn.className = 'svc-reset-group';
		expandAllBtn.textContent = 'Expand all';
		const collapseAllBtn = document.createElement('button');
		collapseAllBtn.type = 'button';
		collapseAllBtn.className = 'svc-reset-group';
		collapseAllBtn.textContent = 'Collapse all';
		groupHeaderActions.appendChild(resetGroupBtn);
		groupHeaderActions.appendChild(expandAllBtn);
		groupHeaderActions.appendChild(collapseAllBtn);
		groupHeader.appendChild(eyebrow);
		groupHeader.appendChild(groupTitleEl);
		groupHeader.appendChild(groupDescEl);
		groupHeader.appendChild(groupHeaderActions);
		panelCol.appendChild(groupHeader);

		const panelSections = document.createElement('div');
		panelSections.className = 'svc-panel-sections';
		panelSections.dataset.filtering = 'false';
		panelCol.appendChild(panelSections);

		/** @type {Map<string, {root: HTMLElement}>} */
		const groupPanelsByName = new Map();

		// Expand all / Collapse all act
		// on the ACTIVE group's own panel by re-clicking its real section/card toggle buttons (script
		// `.click()` on our own already-built DOM is ordinary production code, not a test - it fires
		// through the exact same onSectionToggle/onCardToggle persistence path a user's own click
		// would, rather than duplicating that logic here).
		function setToggleOpen(toggle, open) {
			if ((toggle.getAttribute('aria-expanded') === 'true') !== open) toggle.click();
		}
		function forEachToggle(groupName, selector, fn) {
			const panel = groupPanelsByName.get(groupName);
			if (!panel) return;
			for (const toggle of panel.root.querySelectorAll(selector)) fn(toggle);
		}
		function anyCardOpen(groupName) {
			const panel = groupPanelsByName.get(groupName);
			if (!panel) return false;
			return Array.from(panel.root.querySelectorAll('.svc-control-toggle')).some((t) => t.getAttribute('aria-expanded') === 'true');
		}
		expandAllBtn.addEventListener('click', () => {
			forEachToggle(activeGroupName, '.svc-section-toggle', (t) => setToggleOpen(t, true));
			forEachToggle(activeGroupName, '.svc-control-toggle', (t) => setToggleOpen(t, true));
		});
		collapseAllBtn.addEventListener('click', () => {
			// Two-stage (P4): first collapse every card (sections stay open - a compact list of labels
			// and values); pressed again once every card is already collapsed, collapse the sections too.
			if (anyCardOpen(activeGroupName)) {
				forEachToggle(activeGroupName, '.svc-control-toggle', (t) => setToggleOpen(t, false));
			} else {
				forEachToggle(activeGroupName, '.svc-section-toggle', (t) => setToggleOpen(t, false));
			}
		});

		buildBody = function () {
			panelSections.replaceChildren();
			controlRows.clear();
			firstSectionByGroup.clear();
			groupPanelsByName.clear();
			sectionDotRefreshers = [];

			const presetsPanel = createStudioGroupPanel('Presets', [], state, controlHandlers, {});
			presetGalleryBody = presetsPanel.body;
			presetGalleryBody.appendChild(createPresetGallery(presets, state, controlHandlers));
			panelSections.appendChild(presetsPanel.root);
			groupPanelsByName.set('Presets', presetsPanel);

			for (const groupName of GROUPS) {
				if (groupName === 'Presets') continue;
				const groupControls = controls.filter((c) => c.group === groupName);
				const panel = createStudioGroupPanel(groupName, groupControls, state, controlHandlers, {
					isSectionOpen,
					onSectionToggle,
					isCardOpen,
					onCardToggle,
				});
				for (const [id, row] of panel.controlRows) controlRows.set(id, row);
				if (panel.firstSectionName) firstSectionByGroup.set(groupName, panel.firstSectionName);
				sectionDotRefreshers.push(panel.refreshSectionDots);
				if (groupName === 'Colors') {
					const contrastSectionBody = panel.root.querySelector(".svc-section[data-section='Contrast'] .svc-section-body");
					(contrastSectionBody ?? panel.body).appendChild(contrastBlock.root);
				}
				panelSections.appendChild(panel.root);
				groupPanelsByName.set(groupName, panel);
			}

			const navPanel = createStudioGroupPanel('Navigation', [], state, controlHandlers, { title: 'Structure (advanced)' });
			// No separate note here (unlike the overlay branch above) - the restyled
			// studio tree (`iaEditor.root`, studio mode) supplies its own note at the top ("Changes the
			// sidebar structure..."), so a second one here would just duplicate it.
			navPanel.body.appendChild(iaEditor.root);
			panelSections.appendChild(navPanel.root);
			groupPanelsByName.set('Navigation', navPanel);

			updatePanelVisibility();
		};

		/** Filter empty -> only the active group's panel shows (single eyebrow/title/desc
		 * above); filter non-empty -> every group searches, matches show under their own group
		 * heading, the single group header above is hidden. */
		function updatePanelVisibility() {
			const filtering = filterInput.value.trim() !== '';
			panelSections.dataset.filtering = String(filtering);
			groupHeader.hidden = filtering;
			if (!filtering) {
				for (const [name, panel] of groupPanelsByName) panel.root.hidden = name !== activeGroupName;
			} else {
				// Presets and Navigation have no filterable control rows - applyControlFilter (below)
				// deliberately skips them (same as the overlay accordion always did), so without this
				// they'd keep whatever `hidden` state they had from BEFORE filtering started (e.g. still
				// visible if they were the active group) instead of dropping out of the search results.
				groupPanelsByName.get('Presets').root.hidden = true;
				groupPanelsByName.get('Navigation').root.hidden = true;
			}
		}

		function applyPanelFilter(text) {
			persistUi({ filterText: text });
			updatePanelVisibility();
			applyControlFilter(panelSections, text, () => true, isSectionOpenByDefault, isCardOpen);
		}

		/** @param {string} groupName @param {import('../core/state.js').ThemeState} st */
		function groupHasOverride(groupName, st) {
			if (groupName === 'Navigation') return st.ia !== null;
			return controls.some((c) => c.group === groupName && Object.prototype.hasOwnProperty.call(st.values, c.id));
		}

		function updateGroupHeader(groupName) {
			const displayTitle = RAIL_TITLES[groupName] ?? groupName;
			eyebrow.textContent = (RAIL_CATEGORY_EYEBROW[groupName] ?? groupName).toUpperCase();
			groupTitleEl.textContent = displayTitle;
			groupDescEl.textContent = GROUP_DESCRIPTIONS[groupName] ?? '';
			// Presets has no controls of its own to reset - the button was always disabled there,
			// but showing a permanently-disabled control is worse than not showing one at all.
			resetGroupBtn.hidden = groupName === 'Presets';
			const hasOverride = groupHasOverride(groupName, state);
			resetGroupBtn.disabled = !hasOverride;
			// Short visible label so Reset / Expand all / Collapse all fit on one row at the panel's
			// width; the full wording stays the tooltip and the accessible name.
			resetGroupBtn.querySelector('span:last-child').textContent = 'Reset';
			resetGroupBtn.title = `Reset ${displayTitle} to Starlight defaults`;
			resetGroupBtn.setAttribute('aria-label', `Reset ${displayTitle} to Starlight defaults`);
			// Presets and Navigation have neither sections nor cards
			// of their own (a preset gallery / the Structure tree, respectively) for these to act on.
			const noSectionsOrCards = groupName === 'Presets' || groupName === 'Navigation';
			expandAllBtn.hidden = noSectionsOrCards;
			collapseAllBtn.hidden = noSectionsOrCards;
		}

		refreshStudioChrome = function () {
			for (const [groupName, btn] of railItems) {
				const dot = btn.querySelector('.svc-rail-item-dot');
				dot.hidden = !groupHasOverride(groupName, state);
			}
			if (railItems.has(activeGroupName)) updateGroupHeader(activeGroupName);
		};

		/** @param {import('../core/manifest.js').Control[]} groupControls @returns {import('../core/manifest.js').Control | null} */
		function findFirstVisibleTargetControl(groupControls) {
			const doc = getPageDoc();
			if (!doc) return null;
			for (const c of groupControls) {
				let nodes;
				try {
					nodes = doc.querySelectorAll(c.target);
				} catch {
					continue;
				}
				for (const el of nodes) if (el.getClientRects().length > 0) return c;
			}
			return null;
		}

		/** @param {string} groupName */
		function scrollToGroupSurface(groupName) {
			const groupControls = controls.filter((c) => c.group === groupName && c.target);
			if (!groupControls.length) return;
			const winner = findFirstVisibleTargetControl(groupControls);
			if (winner) {
				targetHighlighter.notify(winner.target, { scroll: true });
				return;
			}
			// S10: "If the group has targets but none matches on the current page, navigate to
			// /specimen/ first, then scroll."
			const frameEl = getFrameEl();
			if (!frameEl) return;
			const onLoad = () => {
				frameEl.removeEventListener('load', onLoad);
				setTimeout(() => {
					const retry = findFirstVisibleTargetControl(groupControls);
					if (retry) targetHighlighter.notify(retry.target, { scroll: true });
				}, 80);
			};
			frameEl.addEventListener('load', onLoad);
			try {
				frameEl.contentWindow.location.href = withBase('/demo/specimen/');
			} catch {
				frameEl.src = withBase('/demo/specimen/');
			}
		}

		/** Exposed as `host.__svc.openGroup` for Inspect. */
		function openGroup(name, opts = {}) {
			const { scroll = true, focusControlId } = opts;
			if (!RAIL_GROUPS.includes(name)) return;
			activeGroupName = name;
			persistUi({ activeGroup: name });
			for (const [groupName, btn] of railItems) {
				const selected = groupName === name;
				btn.setAttribute('aria-selected', String(selected));
				btn.tabIndex = selected ? 0 : -1;
			}
			updateGroupHeader(name);
			updatePanelVisibility();
			if (scroll && !SCROLL_EXCLUDED_GROUPS.has(name)) scrollToGroupSurface(name);
			if (focusControlId) {
				const row = controlRows.get(focusControlId);
				row?.root.querySelector('input, select, button')?.focus();
			}
		}

		// =========================================================================================
		// Inspect support - additive controller functions ONLY. `ui/inspect.js`
		// drives everything else itself via direct `host.shadowRoot`
		// queries (row elements, sections) - these three exist only for state this closure already
		// owns and inspect.js has no other way to reach: `controlRows` (row DOM per control id) and
		// `targetHighlighter`'s enable flag (see `openGroupForInspect` below).
		// =========================================================================================
		/** @type {string[]} Currently `.svc-control-inspected`-marked control ids, so a later call
		 * can cleanly un-mark exactly those before marking the next selection's. */
		let inspectedIds = [];
		/** @param {string[]} ids */
		function highlightControls(ids) {
			for (const id of inspectedIds) controlRows.get(id)?.root.classList.remove('svc-control-inspected');
			inspectedIds = Array.isArray(ids) ? ids.slice() : [];
			for (const id of inspectedIds) controlRows.get(id)?.root.classList.add('svc-control-inspected');
		}
		function clearInspected() {
			highlightControls([]);
		}
		/**
		 * Opens `groupName` and focuses `focusControlId`'s own input, for an Inspect click/selection
		 * (the page must not scroll on an Inspect click). `openGroup`'s own `focusControlId`
		 * path calls that control row's `.focus()`, and every control's input already wires `focus ->
		 * notifyTarget(true) -> targetHighlighter.notify(target, {scroll:true})` (controls.js, for the
		 * unrelated "focus a control, see what it affects" feature) - left enabled, that would scroll
		 * the frame right back out from under an Inspect selection. Disabling the highlighter for the
		 * duration of this synchronous call (the `focus()` call inside `openGroup` dispatches its
		 * `focus` handler synchronously, before this function returns) suppresses exactly that,
		 * without touching `followOnPage`'s own persisted on/off state.
		 * @param {string} groupName @param {string} [focusControlId]
		 */
		function openGroupForInspect(groupName, focusControlId) {
			filterInput.value = '';
			applyPanelFilter('');
			targetHighlighter.setEnabled(false);
			openGroup(groupName, { scroll: false, focusControlId });
			targetHighlighter.setEnabled(followOnPage);
		}
		// `.svc-control-inspected`'s CSS lives here or gets injected from inspect.js, never in
		// styles.js. An inset accent bar + translucent tint (not accent-as-TEXT, which only reaches
		// ~6.3:1 - short of the panel's 7:1 label floor) keeps every row's own text on an
		// effectively-white background, so the contrast walk sees no change.
		const inspectStyle = document.createElement('style');
		inspectStyle.textContent = `.svc-control-inspected { background: var(--ui-accent-tint, rgba(68, 83, 201, 0.08)); border-radius: 6px; box-shadow: inset 3px 0 0 0 var(--ui-accent, #4453c9); }`;
		shadow.appendChild(inspectStyle);

		host.dataset.drawerOpen = 'true';
		host.__svc = {
			getState: () => state,
			subscribe(fn) {
				subscribers.add(fn);
				return () => subscribers.delete(fn);
			},
			undo: doUndo,
			redo: doRedo,
			canUndo: () => history.canUndo(),
			canRedo: () => history.canRedo(),
			// Studio mode has no visible "Reset all" button (only the overlay
			// does), so tests need a way to exercise it - exposes the same `onResetAll` the overlay's own
			// button already calls, one undo step, unchanged behavior.
			resetAll: onResetAll,
			setName(name) {
				state = setName(state, name);
				lastSaveOk = persistState(state);
				lastSaveAt = Date.now();
				notifySubscribers();
			},
			getName: () => getName(state),
			getSaveStatus: () => ({ ok: lastSaveOk, at: lastSaveAt }),
			openExport: () => exportDialog.open(),
			importState: importStateFromJson,
			getChangeCount: () => computeChangeCount(state),
			getContrastReport: () => computeStatusContrastReport(state),
			openContrastDialog: () => contrastDialog.open(computeStatusContrastReport(state)),
			// For shell.mjs's contrast walk, which cannot arrange a real conflict mid-suite: opens either
			// shape of the share-link dialog against the current theme. Choosing "Open shared theme" here
			// re-imports the current theme, one harmless undo step.
			openShareLinkDialog: (kind) => (kind === 'damaged' ? shareDialog.openDamaged(true) : shareDialog.openConflict(state, state)),
			openGroup,
			// Inspect support - see the block above `host.__svc`.
			highlightControls,
			clearInspected,
			openGroupForInspect,
			setPreviewTheme(mode) {
				const pageDoc = getPageDoc();
				if (pageDoc) pageDoc.documentElement.dataset.theme = mode;
				document.documentElement.dataset.theme = mode;
				try {
					localStorage.setItem('starlight-theme', mode);
				} catch {}
				const select = pageDoc?.querySelector('starlight-theme-select select');
				if (select) select.value = mode;
				getPageWin()?.StarlightThemeProvider?.updatePickers?.(mode);
				for (const id of Object.keys(COLOR_ASSIST)) controlRows.get(id)?.refresh(state);
				for (const id of ROLE_OVERRIDE_IDS) controlRows.get(id)?.refresh(state);
			},
			// See the panel-collapse block above the rail loop. studio.js's
			// own `\` keyboard handler calls togglePanelCollapse(); the rail-click/header-button paths
			// call setPanelCollapsed directly since they already close over it.
			togglePanelCollapse: () => setPanelCollapsed(!panelCollapsed),
			isPanelCollapsed: () => panelCollapsed,
		};

		buildBody();
		openGroup(activeGroupName, { scroll: false });
		setPanelCollapsed(panelCollapsed); // Apply the persisted collapse state (host width, button icon/aria)
	}

	// Studio design doc, item D: triggers (2) and (3) for attachToPageDoc, registered before the
	// synchronous trigger (1) below so a frame that (implausibly fast) already finished loading by
	// then still has somewhere to report to. S9: every lane gets its own `load` listener.
	if (studio) {
		window.__svcAttachPreview = attachToPageDoc;
		for (const el of frameEls) el.addEventListener('load', () => attachToPageDoc(el.contentDocument));
	}
	// Trigger (1): synchronous safety net. In overlay mode `getPageDoc()` is always `document`,
	// always ready, so this is the ONLY trigger that ever fires - byte-identical to the old
	// unconditional "initial paint" block it replaces.
	attachToPageDoc(getPageDoc());
	persistPreviewCss();

	contrastBlock.refresh(computeContrastRows());
	if (!studio) setCollapsed(uiState.collapsed === true);
	syncThemeButton();

	if (initialTheme.pendingShared) shareDialog.openConflict(initialTheme.pendingShared, state);
	else if (initialTheme.damaged) shareDialog.openDamaged(!sameTheme(state, defaultState()));
}

// ---------------------------------------------------------------------------------------------
// module-level helpers (no closure over `state`; take it as a parameter)
// ---------------------------------------------------------------------------------------------

/**
 * @returns {import('../core/share-link.js').InitialTheme} A share link (`#svc=`) wins over the saved
 * theme only when nothing worth keeping is saved; otherwise `pendingShared` asks first. See
 * `resolveInitialTheme` in core/share-link.js for the rules.
 */
function loadInitialState() {
	let stored = null;
	try {
		stored = localStorage.getItem(LOCALSTORAGE_STATE_KEY);
	} catch {
		/* storage blocked: nothing saved to protect */
	}
	const initial = resolveInitialTheme(location.hash, stored);
	// The link has been read; take it out of the address bar, so a reload after later edits never
	// meets it again. The studio's own URL rewrite also drops it, but this holds in every mode.
	if (location.hash.startsWith(SHARE_HASH_PREFIX)) {
		try {
			history.replaceState(history.state, '', `${location.pathname}${location.search}`);
		} catch {
			/* a sandboxed page may refuse; the studio's rewrite still runs */
		}
	}
	return initial;
}

/** @param {import('../core/state.js').ThemeState} state @returns {boolean} True on success - drives
 * the top bar's save status ("Not saved (storage blocked)" when this is false). */
function persistState(state) {
	try {
		localStorage.setItem(LOCALSTORAGE_STATE_KEY, encodeState(state));
		return true;
	} catch {
		return false;
	}
}

/**
 * @returns {{openGroups?: string[], scrollTop?: number, filterText?: string, collapsed?: boolean,
 *   followOnPage?: boolean, activeGroup?: string}} Panel UI state, including the rail's
 *   `activeGroup`. `sessionStorage`, not `localStorage`.
 */
function loadUiState() {
	try {
		const raw = sessionStorage.getItem(SESSIONSTORAGE_UI_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** @param {object} uiState */
function saveUiState(uiState) {
	try {
		sessionStorage.setItem(SESSIONSTORAGE_UI_KEY, JSON.stringify(uiState));
	} catch {}
}

/**
 * @param {import('../core/state.js').ThemeState} state
 * @returns {string}
 */
function buildPreviewCss(state) {
	const fonts = fontFaceCss(state);
	return fonts ? `${emitCss(state, { forPreview: true })}\n${fonts}\n` : emitCss(state, { forPreview: true });
}

/**
 * @param {import('../core/state.js').ThemeState} state
 * @returns {string} One `@font-face` rule per distinct non-'system' `type.font.*` value.
 */
function fontFaceCss(state) {
	const seen = new Set();
	const lines = [];
	for (const id of FONT_CONTROL_IDS) {
		const value = getValue(state, id);
		if (!value || value === 'system' || seen.has(value)) continue;
		const font = FONTS.find((f) => f.id === value);
		if (!font) continue;
		seen.add(value);
		const url = `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}:vf@latest/latin-wght-normal.woff2`;
		lines.push(
			`@font-face { font-family: '${font.family} Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('${url}') format('woff2-variations'); }`
		);
	}
	return lines.join('\n');
}

/**
 * Resolves a CSS color expression against the real document (light DOM, so it inherits the page's
 * actual custom properties) via a throwaway probe element, optionally forcing
 * `document.documentElement.dataset.theme` to read the *other* mode's tokens. The flip + read +
 * restore happens synchronously within one task - no visible flicker.
 * @param {'color'|'backgroundColor'} cssProperty
 * @param {string} cssValue e.g. `"var(--sl-color-text)"`.
 * @param {'dark'|'light'|null} themeOverride
 * @returns {string} A browser-serialized `rgb(...)` (or `rgba(...)`) string.
 */
// Deliberately always `document`, never pageDoc: this probes CSS custom property values, and
// studio.astro's own document is kept cascade-identical to the previewed page for exactly those
// tokens (same base props.css, same emitted theme CSS via `hostSheet`, `data-theme` kept in sync
// with the primary lane's). Reading `document` here is correct in both modes and avoids a
// cross-document computed-style read entirely. The context line's contrast check also uses
// this (with an explicit themeOverride for BOTH modes) rather than re-deriving Starlight's cascade
// by hand - see STATUS_CONTRAST_PAIRS's comment.
function resolveCssColor(cssProperty, cssValue, themeOverride) {
	const html = document.documentElement;
	const original = html.dataset.theme;
	const needsFlip = themeOverride && themeOverride !== original;
	if (needsFlip) html.dataset.theme = themeOverride;
	const probe = document.createElement('div');
	probe.style.position = 'fixed';
	probe.style.top = '-9999px';
	probe.style.left = '-9999px';
	probe.style.pointerEvents = 'none';
	probe.style[cssProperty] = cssValue;
	document.body.appendChild(probe);
	const resolved = getComputedStyle(probe)[cssProperty];
	probe.remove();
	if (needsFlip) html.dataset.theme = original;
	return resolved;
}

/** @returns {{label: string, ratio: number}[]} Text/bg and link/bg ratios, for both dark and light. */
function computeContrastRows() {
	const darkText = resolveCssColor('color', 'var(--sl-color-text)', 'dark');
	const darkBg = resolveCssColor('backgroundColor', 'var(--sl-color-bg)', 'dark');
	const darkLink = resolveCssColor('color', 'var(--sl-color-text-accent)', 'dark');
	const lightText = resolveCssColor('color', 'var(--sl-color-text)', 'light');
	const lightBg = resolveCssColor('backgroundColor', 'var(--sl-color-bg)', 'light');
	const lightLink = resolveCssColor('color', 'var(--sl-color-text-accent)', 'light');
	return [
		{ label: 'Text / background (dark)', ratio: contrastRatio(darkText, darkBg) },
		{ label: 'Link / background (dark)', ratio: contrastRatio(darkLink, darkBg) },
		{ label: 'Text / background (light)', ratio: contrastRatio(lightText, lightBg) },
		{ label: 'Link / background (light)', ratio: contrastRatio(lightLink, lightBg) },
	];
}

/** Status bar left: "N changes from Starlight default" - `state.values` already holds
 * exactly the controls that differ from their manifest default (setValue's own canonicalization
 * drops a value equal to the default instead of storing it), so its key count IS that number
 * directly, with each `color.role.*` override counted individually. Structure edits
 * (`state.ia !== null`) count as one. */
function computeChangeCount(state) {
	return Object.keys(state.values).length + (state.ia !== null ? 1 : 0);
}

/**
 * Status bar middle: contrast for BOTH light and dark, from the palette actually in
 * effect.
 * @param {import('../core/state.js').ThemeState} state
 * @returns {{rows: {label:string, mode:'dark'|'light', ratio:number, target:number, pass:boolean, textColor:string, bgColor:string}[], allPass: boolean, minRatio: number, target: number}}
 */
function computeStatusContrastReport(state) {
	const floorId = getValue(state, 'color.contrastFloor');
	const target = floorId === 'aaa' ? CONTRAST_AAA : CONTRAST_AA;
	const rows = [];
	for (const mode of /** @type {const} */ (['dark', 'light'])) {
		for (const pair of STATUS_CONTRAST_PAIRS) {
			const textColor = resolveCssColor('color', `var(${pair.text})`, mode);
			const bgColor = resolveCssColor('backgroundColor', `var(${pair.bg})`, mode);
			const ratio = contrastRatio(textColor, bgColor);
			rows.push({ label: pair.label, mode, textColor, bgColor, ratio, target, pass: ratio >= target });
		}
	}
	const minRatio = rows.reduce((min, r) => Math.min(min, r.ratio), Infinity);
	return { rows, allPass: rows.every((r) => r.pass), minRatio, target };
}

/**
 * Injects `@font-face` rules for every chosen non-'system' font into a `<style id="svc-fonts">` in
 * `doc`'s `<head>`, from the Fontsource jsdelivr CDN. A pure function of `state` via `fontFaceCss`
 * (overwrites `textContent` wholesale each call) rather than an ever-growing accumulator.
 * @param {Document | null} doc
 * @param {import('../core/state.js').ThemeState} state
 */
function ensureFontsInjectedIn(doc, state) {
	if (!doc) return;
	let styleEl = doc.getElementById('svc-fonts');
	if (!styleEl) {
		styleEl = doc.createElement('style');
		styleEl.id = 'svc-fonts';
		doc.head.appendChild(styleEl);
	}
	styleEl.textContent = fontFaceCss(state);
}

function flashText(el, text, revertMs = 1200) {
	const original = el.textContent;
	el.textContent = text;
	setTimeout(() => {
		el.textContent = original;
	}, revertMs);
}
