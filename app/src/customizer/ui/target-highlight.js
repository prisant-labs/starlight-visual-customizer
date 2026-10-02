/**
 * @file "What does this control change?" Given a control's `target`
 * CSS selector list (may not exist on every control yet - every call site guards
 * `if (control.target)`, so this module simply never gets invoked for a control without one), draws
 * a fixed-position highlight box inside the customizer's own shadow root - never touches the
 * target element itself (no class/style added to page elements) - and optionally scrolls it into
 * view.
 *
 * The overlay lives in the shadow root so it participates in the host's stacking context: the host
 * (`:host`) sits at z-index 2147483000, above all real page content, while `.svc-drawer` is given
 * `position:relative; z-index:1` and this overlay `z-index:0` (see styles.js) so the overlay always
 * paints *under* the drawer/panel - "if the target is under the drawer, still highlight it (the
 * overlay sits under the drawer)" is an accepted trade-off here.
 *
 * PAGE-facing: `getPageDoc` locates the target element inside
 * whichever document is currently being previewed. In studio mode that element's own
 * `getBoundingClientRect()` is relative to the IFRAME's viewport, not the host window's - `getFrameEl`
 * supplies the `<iframe>` element itself so `position()` can add its own offset (the frame's
 * boundingClientRect within the host) to line the overlay (which lives in the host document's shadow
 * root) up with the element it's pointing at. `scrollIntoView` needs no such adjustment - it always
 * scrolls the target's own nearest scrollable ancestors, which for a frame-internal element is the
 * frame's own document, never the host page.
 */
import { getChromeZoom } from './studio-sizing.js';

const FADE_MS = 1200;

// ---------------------------------------------------------------------------------------------
// `shell.mjs`'s "pagination links are in view after the
// Footer rail click" failed once in a full sequential run (pagination at top 777px in a 681px-tall
// frame, scrollY 2225) but passed run alone - the scroll is computed while the just-navigated page
// is still shifting (web fonts swapping in, images loading), so `scrollIntoView`'s target position
// is stale by the time its own smooth-scroll animation finishes. Fix: after the scroll settles
// (native `scrollend`, raced against a two-rAF scrollY-stable fallback for engines/paths where it
// never fires - e.g. zero actual scroll distance), re-measure and correct if still offscreen, up to
// twice; and if the document is still within its first ~1.5s (`win.performance.now()` - a frame's
// performance timeline starts at its own navigation, so this needs no separate per-document
// timestamp bookkeeping), wait for `document.fonts.ready` FIRST so the very first scroll already
// targets settled layout.
// ---------------------------------------------------------------------------------------------
const FRESH_DOC_WINDOW_MS = 1500;
const MAX_SCROLL_CORRECTIONS = 2;
const FONTS_READY_CAP_MS = 500;
const SCROLL_SETTLE_CAP_MS = 1500;

/** @param {Window} win */
function isDocFresh(win) {
	try {
		return win.performance.now() < FRESH_DOC_WINDOW_MS;
	} catch {
		return false;
	}
}

/** @param {Window} win */
async function waitForFontsReady(win) {
	try {
		const ready = win.document?.fonts?.ready ?? Promise.resolve();
		await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, FONTS_READY_CAP_MS))]);
	} catch {
		/* fonts.ready can reject (e.g. a font failing to load) - must never block a scroll */
	}
}

/**
 * Resolves once `win`'s scroll position looks settled: whichever comes first of (a) a native
 * `scrollend` on `win` (capture phase, so a nested scrolling container - e.g. the sidebar pane -
 * is caught too, same technique `onScrollOrResize` below already relies on for plain `scroll`), or
 * (b) two consecutive animation frames reporting the same `scrollY` (covers engines without
 * `scrollend`, and the "scrollIntoView was a no-op, so scrollend never fires" case). A safety
 * timeout always resolves it regardless, so a correction cycle can never hang the caller.
 * @param {Window} win
 */
function waitForScrollSettle(win) {
	return new Promise((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			try {
				win.removeEventListener('scrollend', onScrollEnd, { capture: true });
			} catch {}
			clearTimeout(safety);
			resolve();
		};
		const onScrollEnd = () => finish();
		try {
			win.addEventListener('scrollend', onScrollEnd, { capture: true, once: true });
		} catch {}
		const safety = setTimeout(finish, SCROLL_SETTLE_CAP_MS);
		let lastY = win.scrollY;
		let stableFrames = 0;
		function pollFrame() {
			if (done) return;
			if (win.scrollY === lastY) {
				stableFrames++;
				if (stableFrames >= 2) {
					finish();
					return;
				}
			} else {
				stableFrames = 0;
				lastY = win.scrollY;
			}
			win.requestAnimationFrame(pollFrame);
		}
		win.requestAnimationFrame(pollFrame);
	});
}

// ---------------------------------------------------------------------------------------------
// `Element.scrollIntoView()` on an element inside a same-origin
// iframe doesn't stop at that frame's own document - per the CSSOM View algorithm it continues into
// the PARENT browsing context, trying to bring the <iframe> element itself into view against ITS OWN
// ancestor chain too. Reproduced by focusing a targeted control at a scaled device
// (studio at 1600x1000, Long doc, device 1440), which scrolled `#svc-lane-shell` (a host ancestor of the
// lane iframe) to a nonzero scrollTop, clipping the frame's own fixed header. `overflow: clip` on
// every host ancestor (studio.astro) blocks most of this outright, but `.svc-lane-wrap` also gets a
// deliberate x-axis scroll container for zoom panning that `clip` can't cover - so every scroll that
// targets a frame-internal element goes through `scrollElementIntoView` below instead of the native
// method, which can only ever move `win`'s own document (never a parent's).
// ---------------------------------------------------------------------------------------------

/** @param {Element} ancestor @returns {{x: boolean, y: boolean}} Which axes `ancestor` can actually
 * scroll right now (real overflow, not just an `overflow` keyword that permits it in principle). */
function scrollableAxes(ancestor) {
	const cs = getComputedStyle(ancestor);
	return {
		y: ancestor.scrollHeight - ancestor.clientHeight > 1 && /^(auto|scroll|hidden)$/.test(cs.overflowY),
		x: ancestor.scrollWidth - ancestor.clientWidth > 1 && /^(auto|scroll|hidden)$/.test(cs.overflowX),
	};
}

/** Nudges `ancestor`'s own scroll position (a plain property set - never `Element.scrollIntoView`,
 * so this can never itself trigger the cross-frame bug it exists to avoid) just enough that `elRect`
 * (the target's CURRENT, live `getBoundingClientRect()`) is no longer clipped by `ancestor`'s own
 * viewport - "nearest" semantics, matching what a nested scroll container (e.g. the fixed sidebar
 * pane, S10) would do under native `scrollIntoView`. Instant, not smooth: only the final,
 * outermost/window-level scroll (in `scrollElementIntoView` below) animates. */
function nudgeAncestor(ancestor, elRect) {
	const aRect = ancestor.getBoundingClientRect();
	const axes = scrollableAxes(ancestor);
	if (axes.y) {
		if (elRect.top < aRect.top) ancestor.scrollTop -= aRect.top - elRect.top;
		else if (elRect.bottom > aRect.bottom) ancestor.scrollTop += elRect.bottom - aRect.bottom;
	}
	if (axes.x) {
		if (elRect.left < aRect.left) ancestor.scrollLeft -= aRect.left - elRect.left;
		else if (elRect.right > aRect.right) ancestor.scrollLeft += elRect.right - aRect.right;
	}
}

/**
 * Replaces `el.scrollIntoView(...)` for any `el` that might live inside a lane iframe. Walks `el`'s
 * own ancestor chain WITHIN ITS OWN DOCUMENT first (nearest scrollable container first - the sidebar
 * pane, a collapsible section, etc.), nudging each with a plain property set, then finishes with
 * `win.scrollTo` for the document/window itself - an API that, unlike `Element.scrollIntoView`, has
 * no cross-frame propagation at all, so it can never reach a parent document regardless of what's
 * scrollable there.
 * @param {Element} el @param {{block?: 'start'|'center'|'end', behavior?: ScrollBehavior}} [opts]
 */
export function scrollElementIntoView(el, { block = 'center', behavior = 'smooth' } = {}) {
	const doc = el.ownerDocument;
	if (!doc) return;
	const win = doc.defaultView || window;
	let node = el.parentElement;
	while (node && node !== doc.documentElement) {
		try {
			nudgeAncestor(node, el.getBoundingClientRect());
		} catch {
			/* an ancestor mid-navigation/detached - never let this break the outer scroll below */
		}
		node = node.parentElement;
	}
	let rect;
	try {
		rect = el.getBoundingClientRect();
	} catch {
		return;
	}
	const scroller = doc.scrollingElement || doc.documentElement;
	let top = win.scrollY;
	if (block === 'center') top += rect.top - (win.innerHeight - rect.height) / 2;
	else if (block === 'end') top += rect.bottom - win.innerHeight;
	else top += rect.top;
	const maxTop = Math.max(0, (scroller?.scrollHeight || 0) - win.innerHeight);
	top = Math.max(0, Math.min(top, maxTop));
	let left = win.scrollX;
	if (rect.left < 0 || rect.right > win.innerWidth) {
		left += rect.left - (win.innerWidth - rect.width) / 2;
		const maxLeft = Math.max(0, (scroller?.scrollWidth || 0) - win.innerWidth);
		left = Math.max(0, Math.min(left, maxLeft));
	}
	try {
		win.scrollTo({ top, left, behavior });
	} catch {
		try {
			win.scrollTo(left, top);
		} catch {
			/* nothing more we can do - never throw out of a scroll helper */
		}
	}
}

/**
 * @param {ShadowRoot} shadowRoot
 * @param {{getPageDoc?: () => Document | null, getFrameEl?: () => HTMLIFrameElement | null}} [hooks]
 *   Both default to plain-overlay behavior (`document`, no frame) when omitted.
 * @returns {{
 *   setEnabled: (enabled: boolean) => void,
 *   notify: (targetSelector: string | undefined, opts?: {scroll?: boolean}) => void,
 *   bindFrameWindow: (win: Window | null) => void,
 *   destroy: () => void,
 * }}
 */
export function createTargetHighlighter(shadowRoot, hooks = {}) {
	const getPageDoc = hooks.getPageDoc || (() => document);
	const getFrameEl = hooks.getFrameEl || (() => null);

	const overlay = document.createElement('div');
	overlay.className = 'svc-target-overlay';
	overlay.hidden = true;
	shadowRoot.appendChild(overlay);

	let enabled = true;
	/** @type {Element | null} */
	let currentEl = null;
	/** @type {number | null} */
	let fadeTimer = null;
	/** @type {number | null} */
	let rafHandle = null;

	/** First element matching `selectorList` that currently has a layout box (visible, not display:none). */
	function findVisible(selectorList) {
		if (!selectorList) return null;
		const pageDoc = getPageDoc();
		if (!pageDoc) return null; // frame mid-navigation / cross-origin momentarily - see page-doc.js
		let nodes;
		try {
			nodes = pageDoc.querySelectorAll(selectorList);
		} catch {
			return null; // an invalid selector must never throw into a control's event handler
		}
		for (const el of nodes) {
			if (el.getClientRects().length > 0) return el;
		}
		return null;
	}

	function position() {
		// `!currentEl` (tracking already stopped - show()'s own fade timeout cleared it) and
		// `currentEl but disconnected` (the element itself was genuinely removed from the DOM) are NOT
		// the same case: only the second should force-hide. A long scroll-driven animation can queue a
		// `schedulePosition()` rAF callback just before the FADE_MS timeout fires, so that callback's
		// `position()` call can land AFTER `currentEl` was already nulled - discovered via the studio's
		// longer in-frame scroll distances (a multi-second smooth scroll can outlast FADE_MS's 1200ms),
		// but the race exists in plain overlay mode too, just less likely to be hit there. Treating
		// `!currentEl` as "nothing to do" (not "hide it") keeps the CSS fade (`.svc-target-fade`,
		// `transition: opacity`) as the only thing that ever visually dismisses the overlay on a normal
		// timeout, instead of this occasionally snapping it to `hidden` mid-fade.
		if (!currentEl) return;
		if (!currentEl.isConnected) {
			hide();
			return;
		}
		const rect = currentEl.getBoundingClientRect();
		const frameEl = getFrameEl();
		// currentEl's rect is relative to its OWN window's viewport - in studio mode that's the
		// iframe's viewport, not the host's, so the frame's own position within the host is added on
		// top. In overlay mode getFrameEl() returns null and this is a no-op, exactly as before.
		const frameRect = frameEl ? frameEl.getBoundingClientRect() : { left: 0, top: 0 };
		// The frame may be `transform: scale(s)`'d down to fit its lane (studio.js sets
		// `data-svc-scale` on the iframe whenever it recomputes). `currentEl`'s rect is measured in
		// the IFRAME'S OWN (unscaled) viewport coordinates, so it must be scaled by `s` before adding
		// it to `frameRect` (which - because it comes from the SCALED element's own
		// getBoundingClientRect() - is already in host-viewport pixels). No `data-svc-scale` (overlay
		// mode, or Fit at 100%) means `s = 1`, a no-op multiply.
		const scale = frameEl ? Number.parseFloat(frameEl.dataset.svcScale || '1') || 1 : 1;
		// The overlay lives in the panel's shadow root, which "Studio sizing" zooms; the frame does
		// not. Everything above is in on-screen pixels, so divide by the chrome zoom before assigning
		// (studio-sizing.js explains why). Outside the studio the zoom is 1.
		const zoom = getChromeZoom();
		overlay.style.transform = `translate(${(frameRect.left + rect.left * scale) / zoom}px, ${(frameRect.top + rect.top * scale) / zoom}px)`;
		overlay.style.width = `${(rect.width * scale) / zoom}px`;
		overlay.style.height = `${(rect.height * scale) / zoom}px`;
	}

	function schedulePosition() {
		if (rafHandle != null) return;
		rafHandle = requestAnimationFrame(() => {
			rafHandle = null;
			position();
		});
	}

	function show(el) {
		currentEl = el;
		overlay.hidden = false;
		overlay.classList.remove('svc-target-fade');
		position();
		if (fadeTimer != null) clearTimeout(fadeTimer);
		fadeTimer = setTimeout(() => {
			overlay.classList.add('svc-target-fade');
			// Stop tracking once faded: the transitionend-free timeout above is the single source of
			// truth for "done", so scroll/resize listeners can cheaply no-op via `currentEl` below.
			currentEl = null;
		}, FADE_MS);
	}

	function hide() {
		overlay.hidden = true;
		currentEl = null;
		if (fadeTimer != null) {
			clearTimeout(fadeTimer);
			fadeTimer = null;
		}
	}

	/** @param {DOMRect} rect @param {Window} win The rect's own window - in studio mode that's the
	 * frame's window (the element it was measured from lives there), never the host window. */
	function isOffscreen(rect, win) {
		return rect.bottom <= 0 || rect.top >= win.innerHeight || rect.right <= 0 || rect.left >= win.innerWidth;
	}

	/** I0: scroll `el` into view, then re-verify (and correct, up to `MAX_SCROLL_CORRECTIONS` times)
	 * once each scroll settles - see the file-header note above. Fire-and-forget from `notify()`
	 * (never awaited there; every await inside has its own cap, so this always finishes). */
	async function scrollIntoViewWithCorrection(el) {
		const win = el.ownerDocument?.defaultView || window;
		if (isDocFresh(win)) await waitForFontsReady(win);
		if (!el.isConnected) return;
		if (!isOffscreen(el.getBoundingClientRect(), win)) return; // already in view - nothing to do
		// F0: never el.scrollIntoView() here - el lives inside a lane iframe (see this file's F0 note
		// above `scrollElementIntoView`).
		scrollElementIntoView(el, { block: 'center', behavior: 'smooth' });
		await waitForScrollSettle(win);
		for (let correction = 0; correction < MAX_SCROLL_CORRECTIONS; correction++) {
			if (!el.isConnected) return;
			if (!isOffscreen(el.getBoundingClientRect(), win)) return; // settled AND in view - done
			scrollElementIntoView(el, { block: 'center', behavior: 'smooth' });
			await waitForScrollSettle(win);
		}
	}

	/**
	 * @param {string | undefined} targetSelector
	 * @param {{scroll?: boolean}} [opts]
	 */
	function notify(targetSelector, { scroll = false } = {}) {
		if (!enabled || !targetSelector) return;
		const el = findVisible(targetSelector);
		if (!el) return;
		show(el);
		if (scroll) scrollIntoViewWithCorrection(el).catch(() => {});
	}

	/** @param {boolean} value */
	function setEnabled(value) {
		enabled = value;
		if (!value) hide();
	}

	const onScrollOrResize = () => {
		if (currentEl) schedulePosition();
	};
	window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
	window.addEventListener('resize', onScrollOrResize);

	/** @type {Window | null} The frame window scroll/resize is currently bound to, if any. */
	let boundFrameWin = null;
	/**
	 * Studio mode only: the host window's own scroll/resize listeners above never see scroll/resize
	 * events from INSIDE a same-origin iframe (separate document, separate event target) - the frame
	 * needs its own listeners, rebound on every navigation since a new page means a new `Window`
	 * object. Called from panel.js's attach flow. A no-op in overlay mode (never called).
	 * @param {Window | null} win
	 */
	function bindFrameWindow(win) {
		// No `boundFrameWin === win` early-exit: an <iframe>'s `contentWindow` is a WindowProxy that
		// keeps the SAME object identity across a same-frame navigation (confirmed empirically - a
		// naive identity check here silently no-ops on every navigation after the first, since the
		// proxy "looks" unchanged even though the realm underneath it is entirely new). Only
		// `contentDocument` gets a fresh identity per navigation. A real navigation implicitly drops
		// whatever listeners were registered against the OLD realm - the `removeEventListener` below
		// is therefore usually a harmless no-op, kept only so a call with the exact same, still-live
		// window (which does happen - see attachToPageDoc's `getFrameEl` initial calls) doesn't
		// accumulate duplicate listeners. Called once per genuinely new document (attachToPageDoc's
		// own idempotent-per-document guard already prevents redundant calls), so re-adding every
		// time is correct, not wasteful.
		if (boundFrameWin) {
			try {
				boundFrameWin.removeEventListener('scroll', onScrollOrResize, { capture: true });
				boundFrameWin.removeEventListener('resize', onScrollOrResize);
			} catch {
				/* the old frame window may already be gone (navigated away) - nothing to clean up */
			}
		}
		boundFrameWin = win;
		if (win) {
			win.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
			win.addEventListener('resize', onScrollOrResize);
		}
	}

	function destroy() {
		window.removeEventListener('scroll', onScrollOrResize, { capture: true });
		window.removeEventListener('resize', onScrollOrResize);
		bindFrameWindow(null);
		if (fadeTimer != null) clearTimeout(fadeTimer);
		overlay.remove();
	}

	return { setEnabled, notify, bindFrameWindow, destroy };
}
