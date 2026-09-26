/**
 * @file Per-control sample markup for live-sample tiles (SPEC.md Round "B" tiles item 2, first
 * bullet). Two sourcing strategies, chosen per control:
 *  - **Clone, don't construct** (mirrors `sidebar-render.js`'s own rule) for anything styled by an
 *    Astro-component-scoped `<style>` block (Header, Search, Sidebar, TOC, Tabs, Pagination): this
 *    build's Astro scoping strategy adds a per-component `astro-XXXXXXXX` class to both the
 *    rendered element AND every selector in that component's compiled stylesheet (confirmed via
 *    `tests/e2e/smoke.mjs`'s sidebar-link assertion), so hand-built markup without that exact class
 *    would render completely unstyled by the component's own rules - only a live clone carries it.
 *  - **Hand-authored** for anything styled by Starlight's global, unscoped stylesheets
 *    (`dist/style/markdown.css`, `dist/style/asides.css`: asides, inline code, links, tables) -
 *    these match on plain classes with no Astro scope hash, so a small hand-built snippet using the
 *    same classes renders identically to the real thing.
 *
 * Every `build()` returns one template `Node` (or `null`); callers `cloneNode(true)` it once per
 * option tile, at a fixed CSS pixel width from `SAMPLE_VIRTUAL_WIDTH` below (a representative
 * desktop-ish layout, not the tile's own ~150-180px) so multi-column layouts (pagination cards, the
 * header's title/search/icons grid) lay out the way they would on a real page, then `tile-grid.js`
 * scales the whole thing down to fit. Clone-based builders fall back to a hand-built approximation
 * when the current page has no live instance of that element (e.g. Tabs/Pagination on a page that
 * doesn't use them, or `.sidebar-content`/`starlight-toc` on a splash page with no sidebar/TOC) - a
 * known fidelity trade-off documented in the build report, not chased further per SPEC.md's
 * screenshot-judged bar.
 *
 * PAGE-facing (studio.astro's design doc, item C): every "clone a live element" lookup below reads
 * from `getPageDoc()` (the previewed document - the frame's, in studio mode) via `pageQuery`, not
 * the module's own `document` - so tiles clone whatever the studio is currently previewing, falling
 * back to the hand-built approximation exactly as they already do for a page missing that element.
 * `document.createElement`/`el()` below stay plain `document` - they build tile-internal fragments
 * (the search-trigger wrapper, a re-parented sidebar `<li>`), not page content.
 */
import { getPageDoc } from '../page-doc.js';

/** @param {string} selector @returns {Element | null} */
function pageQuery(selector) {
	const doc = getPageDoc();
	return doc ? doc.querySelector(selector) : null;
}

function el(html) {
	const wrap = document.createElement('div');
	wrap.innerHTML = html.trim();
	return wrap.firstElementChild;
}

function capListItems(root, max) {
	const items = Array.from(root.querySelectorAll('li'));
	items.slice(max).forEach((li) => li.remove());
}

// ---------------------------------------------------------------------------------------------
// Clone-based (Astro-scoped) samples
// ---------------------------------------------------------------------------------------------

/**
 * `header.header` (PageFrame.astro's outer element) composed with a "page content" block directly
 * beneath/behind it - a heading and a couple of text lines, absolutely positioned so their top edge
 * sits right at the header's own bottom edge (coordinator review, round 2: the four header.style
 * options were indistinguishable with nothing but empty page background under the bar - border and
 * shadow need a content edge to read against, and translucent-blur needs something to actually
 * blur). Used by `header.style` only; `header.searchTriggerStyle` gets its own narrower sample
 * (`buildSearchTriggerSample`) so the full search box fits instead of being cropped by a
 * title+icons-sized canvas.
 */
export function buildHeaderSample() {
	const live = pageQuery('header.header');
	const header = live
		? live.cloneNode(true)
		: el(`<div class="header"><div class="title-wrapper sl-flex"><a href="#" class="site-title">Docs</a></div></div>`);
	// Swap in a short placeholder title regardless of the fixture's real (here, fairly long)
	// configured title - this sample's narrow canvas exists to make border/shadow/blur legible
	// (see SAMPLE_VIRTUAL_WIDTH's comment), not to prove the real title renders, and a long title
	// would either overflow or force a wider/blurrier canvas than that goal needs.
	const siteTitle = header.querySelector('.site-title');
	if (siteTitle) siteTitle.textContent = 'Docs';
	const canvas = document.createElement('div');
	canvas.className = 'svc-header-canvas';
	const content = document.createElement('div');
	content.className = 'svc-header-page-content sl-markdown-content';
	// P6 (point 10): trimmed to the least content that still shows the effect - one line of "page
	// content behind the bar" is enough to read border/shadow/blur against; a second line was never
	// load-bearing here (this canvas has an explicit fixed height, SAMPLE_VIRTUAL_HEIGHT, so it isn't
	// filling a box the way the round-3 fillers below were).
	content.innerHTML = '<p>Body text continues right under the bar.</p>';
	canvas.appendChild(content);
	canvas.appendChild(header);
	return canvas;
}

/** `site-search` (Search.astro's custom element) alone, padded, at a width wide enough to show the
 * whole trigger box (real max-width 22rem/352px) - not cropped by a header-sized canvas. */
export function buildSearchTriggerSample() {
	const wrap = document.createElement('div');
	wrap.className = 'svc-search-trigger-wrap';
	const live = pageQuery('site-search');
	// Deliberately keep the (real, cloned) <dialog> rather than removing it: <dialog> renders
	// `display: none` by default until `.showModal()` is called (never happens in this decorative
	// tile - pointer-events are disabled on the whole preview), so it's visually inert either way,
	// but SiteSearch's own constructor does `this.querySelector('dialog')!.addEventListener(...)`
	// unconditionally on connect - removing the dialog first made that throw on every page load.
	const clone = live
		? live.cloneNode(true)
		: el(`<site-search><button data-open-modal><span>Search</span></button><dialog></dialog></site-search>`);
	wrap.appendChild(clone);
	return wrap;
}

/**
 * `.sidebar-content` rebuilt as three shallow rows - a plain top-level link, the real
 * current-page `<a>` (re-parented into a fresh `<li>` so 1-3 levels of its real ancestor
 * `<details>`/`<ul>` nesting don't come along and push it below the fold of a small tile), and one
 * group with a single nested link - used by both sidebar controls. Cloning (not the whole subtree
 * verbatim) is still what carries the Astro scope classes onto the `<a>`/`<li>`/`<details>` tags
 * that Sidebar's own `<style>` block targets; only the *arrangement* is curated.
 */
export function buildSidebarSample() {
	const live = pageQuery('.sidebar-content');
	if (!live) {
		return el(
			`<div class="sidebar-content sl-flex"><ul class="top-level"><li><a href="#"><span>Getting Started</span></a></li><li><a href="#" aria-current="page"><span>Kitchen Sink</span></a></li><li><details open><summary><span class="group-label"><span class="large">Guides</span></span></summary><ul><li><a href="#"><span>Theming</span></a></li></ul></details></li></ul></div>`
		);
	}
	const clone = live.cloneNode(true);
	const topUl = clone.querySelector('ul.top-level');
	if (topUl) {
		const currentAnchor = topUl.querySelector("a[aria-current='page']");
		// Prefer a group that does NOT contain the current page, so the group-label demo doesn't
		// just repeat the same link text as the current-item row above it.
		const allDetails = Array.from(topUl.querySelectorAll('details'));
		const detailsEl =
			allDetails.find((d) => !d.querySelector("a[aria-current='page']")) || allDetails[0];
		const firstPlainLink = Array.from(topUl.children).find(
			(li) => li.tagName === 'LI' && li.querySelector(':scope > a')
		);
		const rows = [];
		if (firstPlainLink) rows.push(firstPlainLink);
		if (currentAnchor) {
			const li = document.createElement('li');
			li.appendChild(currentAnchor.cloneNode(true));
			rows.push(li);
		}
		if (detailsEl) {
			const detailsClone = detailsEl.cloneNode(true);
			detailsClone.open = true;
			const nestedUl = detailsClone.querySelector('ul');
			if (nestedUl) {
				const firstNestedLi = nestedUl.querySelector('li');
				nestedUl.replaceChildren(...(firstNestedLi ? [firstNestedLi] : []));
			}
			rows.push(detailsClone);
		}
		if (rows.length) topUl.replaceChildren(...rows);
	}
	return clone;
}

/**
 * `starlight-toc` pruned to two items with a guaranteed current item (the real one is set by
 * scroll-spy JS and may not exist yet at load) - the SECOND link is marked current so the sample
 * also shows an ordinary (non-current) item for contrast, per option.
 */
export function buildTocSample() {
	const live = pageQuery('starlight-toc');
	if (!live) {
		return el(
			`<starlight-toc><nav><ul><li><a href="#"><span>Overview</span></a></li><li><a href="#" aria-current="true"><span>Text formatting</span></a></li></ul></nav></starlight-toc>`
		);
	}
	const clone = live.cloneNode(true);
	capListItems(clone, 3);
	const links = Array.from(clone.querySelectorAll('a'));
	links.forEach((a) => a.removeAttribute('aria-current'));
	if (links.length) links[Math.min(1, links.length - 1)].setAttribute('aria-current', 'true');
	return clone;
}

/**
 * `starlight-tabs` (from the kitchen-sink guide) - falls back to a hand-built (unscoped)
 * approximation elsewhere. The real tab PANELS (content bodies) are dropped entirely - only the
 * tablist itself is what `components.tabsIndicatorStyle` styles, and panels can be tall (code
 * blocks, prose). P6 (point 10): a round-3 filler line that stood in for panel content, so the
 * sample would have a natural height closer to a real tabs block, is gone - that was filling a fixed
 * 4:3 box P5's "rows" layout no longer has, so the bare tablist (the only thing this control
 * actually changes) is now the whole, least-content sample.
 */
export function buildTabsSample() {
	const live = pageQuery('starlight-tabs');
	if (live) {
		const clone = live.cloneNode(true);
		clone.querySelectorAll("[role='tabpanel']").forEach((p) => p.remove());
		return clone;
	}
	return el(
		`<starlight-tabs><div class="tablist-wrapper not-content"><ul role="tablist"><li role="presentation" class="tab"><a role="tab" href="#" aria-selected="true">One</a></li><li role="presentation" class="tab"><a role="tab" href="#" aria-selected="false" tabindex="-1">Two</a></li></ul></div></starlight-tabs>`
	);
}

/** `.pagination-links` - falls back to a hand-built (unscoped) approximation on pages without both prev/next. */
export function buildPaginationSample() {
	const live = pageQuery('.pagination-links');
	if (live && live.children.length > 0) return live.cloneNode(true);
	return el(
		`<div class="pagination-links"><a href="#" rel="prev"><span>Previous<br /><span class="link-title">Getting Started</span></span></a><a href="#" rel="next"><span>Next<br /><span class="link-title">Kitchen Sink</span></span></a></div>`
	);
}

// ---------------------------------------------------------------------------------------------
// Hand-authored (globally-styled, unscoped) samples - each wrapped in a padded box (coordinator
// review, round 2: these ran text flush to the tile edge with no room to wrap).
// ---------------------------------------------------------------------------------------------

export function buildAsideSample() {
	return el(
		`<div class="svc-sample-pad"><aside aria-label="Note" class="starlight-aside starlight-aside--note"><p class="starlight-aside__title">Note</p><div class="starlight-aside__content"><p>A short callout with a little more text.</p></div></aside></div>`
	);
}

// P6 (point 10): a round-3 second sentence, added purely to fill a fixed 4:3 box P5's "rows" layout
// no longer has, is gone from both - one line is the least content that still shows the difference
// between options.
export function buildInlineCodeSample() {
	return el(`<div class="svc-sample-pad sl-markdown-content"><p>Run <code>npm install</code> to get started.</p></div>`);
}

export function buildLinkSample() {
	return el(`<div class="svc-sample-pad sl-markdown-content"><p>Read the <a href="#">full guide</a> for setup.</p></div>`);
}

export function buildTableSample() {
	return el(
		`<div class="svc-sample-pad sl-markdown-content"><table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody><tr><td>id</td><td>string</td></tr><tr><td>label</td><td>string</td></tr></tbody></table></div>`
	);
}

export function buildShadowSample() {
	return el(
		`<div class="svc-sample-pad"><div class="svc-shadow-card"><strong>Card</strong><span>A little supporting text.</span></div></div>`
	);
}

export function buildHeadingCaseSample() {
	return el(
		`<div class="svc-sample-pad sl-markdown-content"><h3>Section heading</h3><p>Body text follows the heading.</p></div>`
	);
}

export function buildBlockquoteSample() {
	return el(
		`<div class="svc-sample-pad sl-markdown-content"><blockquote><p>Good design is as little design as possible.</p></blockquote></div>`
	);
}

/**
 * `article.card` (Card.astro, workstream K) - Astro-scoped like the header/sidebar/TOC samples
 * above, so cloned from the page when a `<Card>` is present (specimen.mdx and kitchen-sink.mdx
 * both use one inside a `<CardGrid>`).
 */
export function buildCardSample() {
	const wrap = document.createElement('div');
	wrap.className = 'svc-sample-pad';
	const live = pageQuery('article.card');
	const card = live
		? live.cloneNode(true)
		: el(
				`<article class="card sl-flex"><p class="title sl-flex"><span>Card title</span></p><div class="body">A short line of body copy.</div></article>`
			);
	wrap.appendChild(card);
	return wrap;
}

/** `.sl-link-button` (LinkButton.astro, workstream K) - prefers the real "primary" variant
 * (specimen.mdx and kitchen-sink.mdx both render one) since it's the only variant with a filled
 * background, which is what makes a corner-radius change actually visible in a small tile. */
export function buildLinkButtonSample() {
	const wrap = document.createElement('div');
	wrap.className = 'svc-sample-pad';
	const live = pageQuery('.sl-link-button.primary') || pageQuery('.sl-link-button');
	const button = live
		? live.cloneNode(true)
		: el(`<a href="#" class="sl-link-button not-content primary">Get started</a>`);
	wrap.appendChild(button);
	return wrap;
}

/** `.sl-badge` (Badge.astro, workstream K) - the "default" variant specifically, so the sample's
 * own color never depends on which semantic hue happens to be selected. */
export function buildBadgeSample() {
	const wrap = document.createElement('div');
	wrap.className = 'svc-sample-pad';
	const live = pageQuery('.sl-badge.default');
	const badge = live ? live.cloneNode(true) : el(`<span class="sl-badge default">Default</span>`);
	wrap.appendChild(badge);
	return wrap;
}

/** @type {Record<string, () => Element|null>} */
export const SAMPLE_BUILDERS = {
	'header.style': buildHeaderSample,
	'header.searchTriggerStyle': buildSearchTriggerSample,
	'sidebar.activeStyle': buildSidebarSample,
	'sidebar.groupLabelStyle': buildSidebarSample,
	'toc.currentItemStyle': buildTocSample,
	'content.asideStyle': buildAsideSample,
	'content.inlineCodeStyle': buildInlineCodeSample,
	'content.linkStyle': buildLinkSample,
	'content.tableStyle': buildTableSample,
	'components.tabsIndicatorStyle': buildTabsSample,
	'footer.paginationStyle': buildPaginationSample,
	'layout.shadowElevation': buildShadowSample,
	'type.headingCase': buildHeadingCaseSample,
	'content.blockquoteStyle': buildBlockquoteSample,
	'components.cardStyle': buildCardSample,
	'components.linkButtonStyle': buildLinkButtonSample,
	'components.badgeStyle': buildBadgeSample,
};

/**
 * Extra CSS (scoped the same way as treatment CSS - see `tile-grid.js`) applied to EVERY tile of a
 * control, before the option-specific treatment CSS: escapes `position: fixed` (the real
 * `header.header` is fixed to the viewport; inside a tile it must lay out inline instead), pads the
 * hand-authored content samples, and gives a couple of samples a sensible backdrop so they read as
 * a small card rather than a bare fragment.
 * @type {Record<string, string>}
 */
export const SAMPLE_CONTAIN_CSS = {
	// Coordinator review, round 2, three fixes landed here together:
	//  1. Small, close-to-1:1 canvas (~0.7-0.8x scale - see SAMPLE_VIRTUAL_WIDTH/HEIGHT) instead of a
	//     wide "show everything" one (~820px, ~0.2x scale): at that aggressive a scale-down a 1px
	//     border and 14px text both shrank below a device pixel and all four options looked identical.
	//  2. `header.header`'s own responsive layout (Header.astro's <style>) is a 3-column CSS grid
	//     (title | search | icons) at >=50rem, with each column's width formula baked in regardless of
	//     whether that column's content is display:none - so hiding .right-group/site-search (to
	//     leave room for the title) still left the title stuck in its narrow original grid column.
	//     Overriding to a plain flex row (higher specificity than the cloned stylesheet's `.header`
	//     selector - see tile-grid.js's optionCssFor) lets the title actually use the freed-up space.
	//  3. Content sits flush with the bar's real bottom edge (no overlap) for border/shadow/no-border -
	//     an overlapping "ghost" text line right at the seam read as visual noise that made the
	//     (already subtle) hairline harder to compare, not easier. `translucent-blur`'s own option CSS
	//     (see tile-grid.js's optionCssFor) additionally pulls content up to genuinely overlap the bar,
	//     since blur specifically needs something behind it to blur.
	'header.style': `.svc-header-canvas { position: relative; width: 100%; height: 100%; background: var(--sl-color-bg); overflow: hidden; } .svc-header-page-content { position: absolute; top: 0; left: 0; right: 0; padding: var(--sl-nav-height, 3.5rem) 0.85rem 0; } .svc-header-page-content p { margin: 0 0 0.35rem; } header.header { position: absolute; top: 0; left: 0; width: 100%; display: flex; align-items: center; } .right-group, site-search { display: none; } .title-wrapper { min-width: 0; flex: 1 1 auto; overflow: hidden; } .site-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; max-width: 100%; }`,
	// `'rows'` layout (SAMPLE_LAYOUT, coordinator review round 3) gives this a full-panel-width row
	// instead of a 2-column tile, so the real `width: 100%; max-width: 22rem` box just fills it
	// naturally - the earlier `width: auto` override (needed when this shared a cramped 2-column
	// tile) would now just shrink-wrap it smaller than it needs to be.
	'header.searchTriggerStyle': `.svc-search-trigger-wrap { padding: 0.65rem 1rem; background: var(--sl-color-bg); }`,
	'sidebar.activeStyle': `.sidebar-content { position: relative; height: auto; padding: 0.5rem; background: var(--sl-color-bg-sidebar); }`,
	'sidebar.groupLabelStyle': `.sidebar-content { position: relative; height: auto; padding: 0.5rem; background: var(--sl-color-bg-sidebar); }`,
	// `text-decoration: none` mimics PageSidebar.astro's `.right-sidebar-panel :global(:where(a))`
	// rule, which the real page applies to these links via an ANCESTOR we deliberately don't clone
	// (it also carries `sl-hidden lg:sl-block` viewport-breakpoint utility classes that would risk
	// hiding the whole sample if the panel happens to render at a narrower width than that
	// breakpoint) - so it's restated by hand here instead.
	'toc.currentItemStyle': `starlight-toc, starlight-toc nav { display: block; } starlight-toc h2 { display: none; } starlight-toc a { text-decoration: none; color: var(--sl-color-gray-3); } starlight-toc a[aria-current='true'] { color: var(--sl-color-text-accent); }`,
	// P6 (point 10): the round-3 `.svc-tabs-panel-filler` rule (styling for the now-removed filler
	// element - see buildTabsSample) is gone; nothing left to style here beyond making the tablist
	// itself block-level.
	'components.tabsIndicatorStyle': `starlight-tabs { display: block; }`,
	'content.asideStyle': `.svc-sample-pad { padding: 0.65rem; }`,
	'content.inlineCodeStyle': `.svc-sample-pad { padding: 0.65rem; }`,
	'content.linkStyle': `.svc-sample-pad { padding: 0.65rem; }`,
	'content.tableStyle': `.svc-sample-pad { padding: 0.65rem; }`,
	// P6 (point 10): the round-3 padding here was inflated to fill a fixed 4:3 box P5's "rows" layout
	// no longer has - trimmed back to the same modest padding every other hand-authored sample uses.
	'type.headingCase': `.svc-sample-pad { padding: 0.65rem 0.75rem; } .svc-sample-pad p { margin: 0.4rem 0 0; font-size: 0.85rem; color: var(--sl-color-gray-2); }`,
	// `layout.shadowElevation` has no real Starlight element of its own (it's a bare `--sl-shadow-*`
	// token) - a small raised card, distinct in background from the tile's own `--sl-color-bg`, is
	// the whole sample; margin/padding leave room for the shadow to render without the tile's
	// `overflow: hidden` clipping it away. P6 (point 10): the round-3 extra padding (added to fill a
	// fixed 4:3 box, since gone) is trimmed back down.
	'layout.shadowElevation': `.svc-sample-pad { padding: 0.85rem; } .svc-shadow-card { display: flex; flex-direction: column; gap: 0.3rem; padding: 0.75rem 0.85rem; background: var(--sl-color-bg-nav); color: var(--sl-color-white); border-radius: 0.4rem; font-size: 0.8rem; box-shadow: var(--sl-shadow-md); } .svc-shadow-card span { color: var(--sl-color-gray-2); font-size: 0.75rem; }`,
	'content.blockquoteStyle': `.svc-sample-pad { padding: 0.75rem; } .svc-sample-pad blockquote { margin: 0; }`,
	// Card.astro's own padding is `clamp(1rem, calc(0.125rem + 3vw), 2.5rem)` - the `vw` term resolves
	// against the real page viewport, not this tile's own (much narrower) virtual canvas, so inside a
	// tile it always clamps to its 2.5rem ceiling regardless of the canvas width, making the sample
	// far taller than the card ever looks on the real page. Fixed at 1rem here (the clamp's own floor)
	// so the tile shows the card at a viewport-independent, representative height instead.
	// `.title`/its `<span>` also need `min-width: 0` (+`overflow-wrap`): `.title` is itself a flex row
	// (icon + text) nested inside `.card`'s own flex column, so without it a real cloned card title
	// (a single long word, e.g. "Deterministic") sets the flex item's intrinsic min-width to its own
	// unwrapped content width instead of wrapping - the real page never hits this because its column
	// is far wider than this tile's 190px virtual canvas.
	'components.cardStyle': `article.card { width: 100%; box-sizing: border-box; padding: 1rem; min-width: 0; } article.card .title { min-width: 0; } article.card .title span { min-width: 0; overflow-wrap: anywhere; }`,
	// P6 (point 10): trimmed from the round-3 box-filling padding down to the same modest padding
	// every other single-element sample (aside/inline-code/link/table) already uses.
	'components.linkButtonStyle': `.svc-sample-pad { padding: 0.65rem 0.85rem; display: flex; justify-content: center; }`,
	'components.badgeStyle': `.svc-sample-pad { padding: 0.65rem 0.85rem; display: flex; justify-content: center; }`,
};

/**
 * Fixed CSS-pixel width each control's sample is laid out at BEFORE `tile-grid.js` scales the whole
 * canvas down to the tile's real (much smaller) rendered width - a representative desktop-ish size
 * so multi-column/wide layouts (pagination cards side by side, the header's title+search+icons
 * grid) resolve the way they would on a real page, not the way they'd collapse at ~150-180px.
 * @type {Record<string, number>}
 */
export const SAMPLE_VIRTUAL_WIDTH = {
	// Deliberately NOT wide enough to show the full title+search+icons row (that's
	// header.searchTriggerStyle's job, with its own dedicated sample): a gentler scale factor here
	// keeps the border/shadow/blur difference - and the page-content text behind the bar - legible.
	// At the original 820px-wide "show everything" canvas, a 1px border and 14px body text both
	// scaled down to a fraction of a device pixel and effectively vanished (coordinator review,
	// round 2: "all four look identical").
	'header.style': 220,
	'header.searchTriggerStyle': 360,
	'sidebar.activeStyle': 220,
	'sidebar.groupLabelStyle': 220,
	// Narrowed from 200 (coordinator review, round 3: 3 short TOC lines left a "grid"-layout tile's
	// fixed 4:3 box mostly empty at that scale) - a gentler scale (narrower canvas -> bigger scale
	// factor) makes the same content taller, at the minor cost of the longest line ("Long-form
	// paragraphs") wrapping to two lines, which if anything helps fill the box further.
	'toc.currentItemStyle': 160,
	// These four are short (one sentence / one small card) hand-authored samples - a wide virtual
	// canvas just forced an aggressive scale-down that shrank the whole thing into a small,
	// hard-to-read blob in the tile's top-left corner. A canvas close to the tile's own real width
	// keeps the scale gentle (~0.7-0.85x) so the text stays legible, matching the fix already applied
	// to header.style (coordinator review, round 2); narrowed further for asideStyle in round 3
	// alongside its own extra content, to close the rest of the empty band.
	'content.asideStyle': 190,
	'content.inlineCodeStyle': 220,
	'content.linkStyle': 220,
	'content.tableStyle': 240,
	'components.tabsIndicatorStyle': 190,
	'footer.paginationStyle': 640,
	'layout.shadowElevation': 185,
	'type.headingCase': 220,
	'content.blockquoteStyle': 220,
	'components.cardStyle': 190,
	'components.linkButtonStyle': 160,
	'components.badgeStyle': 140,
};

/** Explicit canvas height (px), only for samples whose children are absolutely positioned (so the
 * canvas can't derive a height from normal-flow content). Every other control's canvas height is
 * `auto`, driven by its (normal-flow) content at `SAMPLE_VIRTUAL_WIDTH`.
 * @type {Record<string, number>}
 */
export const SAMPLE_VIRTUAL_HEIGHT = {
	'header.style': 120,
};

/**
 * Item 5: each sample's intended (natural) content height at its `SAMPLE_VIRTUAL_WIDTH`, in CSS
 * pixels - the "encoded aspect" data `tiles/index.js`'s `computeTileLayout` reads to decide grid vs
 * rows (aspect = width / height, over ~2:1 -> rows). These are MEASURED values (the tallest
 * option's real `.svc-tile-canvas.offsetHeight` at its virtual width, read from the running dev
 * server), not estimates - `header.style`'s matches its explicit `SAMPLE_VIRTUAL_HEIGHT` above
 * exactly (120), which cross-checks the measurement. Grid vs rows is decided BEFORE a tile's own
 * canvas exists (it picks the grid's `grid-template-columns` up front), so this can't be measured
 * live at decision time the way `observePreviewScale`'s ResizeObserver measures the real thing
 * afterward for scaling.
 * @type {Record<string, number>}
 */
export const SAMPLE_INTENDED_HEIGHT = {
	'header.style': 120,
	'header.searchTriggerStyle': 61,
	'sidebar.activeStyle': 150,
	'sidebar.groupLabelStyle': 150,
	'toc.currentItemStyle': 104,
	'content.asideStyle': 147,
	'content.inlineCodeStyle': 121,
	'content.linkStyle': 121,
	'content.tableStyle': 138,
	'components.tabsIndicatorStyle': 110,
	'footer.paginationStyle': 184,
	'layout.shadowElevation': 103,
	'type.headingCase': 158,
	// Measured (not estimated) against the running preview at these controls' own SAMPLE_VIRTUAL_WIDTH,
	// same method as every value above - the tallest option's real `.svc-tile-canvas.offsetHeight`.
	'content.blockquoteStyle': 90,
	'components.cardStyle': 253,
	'components.linkButtonStyle': 105,
	'components.badgeStyle': 63,
};
