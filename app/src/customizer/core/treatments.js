/**
 * @file Tier-2 treatment library: exact CSS per non-default select option, keyed by manifest
 * control id and option value. Selectors are copied from the installed
 * `@astrojs/starlight@0.42.4` source (`node_modules/@astrojs/starlight/dist/components/*.astro`,
 * `dist/style/*.css`, `dist/user-components/*.astro`), not guessed - re-verified for the 0.42.4
 * upgrade: `dist/style/*.css` is byte-identical to 0.42.3, and `dist/components/*.astro` differs
 * only in `SidebarSublist.astro` (an internal `sidebarGroupHasCurrent()` helper swapped in for the
 * same `flattenSidebar(...).some(...)` check - no markup/class change, and unrelated to any
 * selector below). `emit-css.js` is the only
 * consumer; it skips lookup entirely when a control's value equals the manifest default, so the
 * default option for each treatment intentionally has no entry here.
 *
 * Notable selector fidelity notes (this CSS is intentionally unlayered, so an unlayered rule here
 * only wins a tie against another stylesheet if it actually matches the same selector):
 * - `header.header` (not bare `.header`): `PageFrame.astro` renders `<header class="header">`
 *   and `Header.astro` renders an *inner* `<div class="header">`. A bare `.header` selector
 *   would double-apply border/shadow/blur declarations to both.
 * - Content treatments mirror Starlight's own `:not(:where(.not-content *))` guard so they don't
 *   leak into Tabs/Card/LinkCard/LinkButton markup that happens to sit inside
 *   `.sl-markdown-content` (those components self-mark their root `.not-content`).
 * - `header.searchTriggerStyle` options are wrapped in Starlight's own
 *   `@media (min-width: 50rem)` because below that width the trigger is a bare icon with no
 *   border/bg/radius to restyle.
 * - Tabs' underline is a `box-shadow`, not `border-bottom`, and the surrounding `[role='tablist']`
 *   carries its own separate `border-bottom`; both must be addressed for pill/segmented.
 */

/**
 * @typedef {{selector: string, property: string}} Probe A DOM hook + computed CSS property the
 *   verify agent can diff against the default state to confirm this option actually changed
 *   something.
 * @typedef {{css: string, probe: Probe}} TreatmentOption
 */

/** @type {Record<string, Record<string, TreatmentOption>>} */
export const treatments = {
	'header.style': {
		'no-border': {
			css: `header.header {
	border-bottom: none;
}`,
			probe: { selector: 'header.header', property: 'border-bottom-width' },
		},
		shadow: {
			css: `header.header {
	border-bottom: none;
	box-shadow: var(--sl-shadow-sm);
}`,
			probe: { selector: 'header.header', property: 'box-shadow' },
		},
		'translucent-blur': {
			css: `header.header {
	background-color: color-mix(in srgb, var(--sl-color-bg-nav) 70%, transparent);
	backdrop-filter: blur(0.5rem);
	-webkit-backdrop-filter: blur(0.5rem);
}`,
			probe: { selector: 'header.header', property: 'backdrop-filter' },
		},
	},

	'header.searchAlign': {
		center: {
			css: `@media (min-width: 50rem) {
	.header > div:has(> site-search) {
		justify-content: center;
	}
}`,
			probe: { selector: '.header > div:has(> site-search)', property: 'justify-content' },
		},
		end: {
			css: `@media (min-width: 50rem) {
	.header > div:has(> site-search) {
		justify-content: flex-end;
	}
}`,
			probe: { selector: '.header > div:has(> site-search)', property: 'justify-content' },
		},
		stretch: {
			css: `@media (min-width: 50rem) {
	button[data-open-modal] {
		max-width: none;
	}
}`,
			// The cell's own justify-content is irrelevant once the button's own 22rem cap (see
			// Search.astro) is lifted: width:100% (already set by Starlight) then fills the column
			// on its own, so the cap removal is the real, option-specific diff.
			probe: { selector: 'button[data-open-modal]', property: 'max-width' },
		},
	},

	'header.searchTriggerStyle': {
		pill: {
			css: `@media (min-width: 50rem) {
	button[data-open-modal] {
		border-radius: 999px;
	}
}`,
			probe: { selector: "button[data-open-modal]", property: 'border-radius' },
		},
		underline: {
			css: `@media (min-width: 50rem) {
	button[data-open-modal] {
		border: none;
		border-bottom: 1px solid var(--sl-color-gray-5);
		border-radius: 0;
		background-color: transparent;
	}
}`,
			// NOT border-bottom-width: the default (all-sides `border: 1px solid`, see
			// Search.astro) is already 1px there, so that property is unchanged by this option
			// even though it visibly removes the top/left/right border. border-top-width goes
			// from 1px (default) to 0px (this option resets to `border: none` before reapplying
			// only the bottom side), which is a real, option-specific diff.
			probe: { selector: "button[data-open-modal]", property: 'border-top-width' },
		},
		ghost: {
			css: `@media (min-width: 50rem) {
	button[data-open-modal] {
		border-color: transparent;
		background-color: transparent;
	}
	button[data-open-modal]:hover {
		border-color: var(--sl-color-gray-5);
	}
}`,
			probe: { selector: "button[data-open-modal]", property: 'border-color' },
		},
	},

	'sidebar.activeStyle': {
		tinted: {
			css: `.sidebar-content a[aria-current='page'],
.sidebar-content a[aria-current='page']:hover,
.sidebar-content a[aria-current='page']:focus {
	background-color: var(--sl-color-accent-low);
	color: var(--sl-color-text-accent);
	border-radius: var(--svc-radius, 0.25rem);
}`,
			probe: { selector: ".sidebar-content a[aria-current='page']", property: 'background-color' },
		},
		'left-bar': {
			css: `.sidebar-content a[aria-current='page'],
.sidebar-content a[aria-current='page']:hover,
.sidebar-content a[aria-current='page']:focus {
	background-color: transparent;
	color: var(--sl-color-text-accent);
	border-inline-start: 2px solid var(--sl-color-text-accent);
	border-radius: 0;
	padding-inline-start: calc(var(--sl-sidebar-item-padding-inline, 0.5rem) - 2px);
}`,
			probe: { selector: ".sidebar-content a[aria-current='page']", property: 'border-left-width' },
		},
		'text-only': {
			css: `.sidebar-content a[aria-current='page'],
.sidebar-content a[aria-current='page']:hover,
.sidebar-content a[aria-current='page']:focus {
	background-color: transparent;
	color: var(--sl-color-text-accent);
}`,
			probe: { selector: ".sidebar-content a[aria-current='page']", property: 'background-color' },
		},
	},

	'sidebar.groupLabelStyle': {
		'small-caps': {
			css: `.sidebar-content .group-label .large {
	font-variant: small-caps;
	letter-spacing: 0.02em;
}`,
			probe: { selector: '.sidebar-content .group-label .large', property: 'font-variant-caps' },
		},
		'muted-uppercase': {
			css: `.sidebar-content .group-label .large {
	text-transform: uppercase;
	font-size: var(--sl-text-xs);
	color: var(--sl-color-gray-3);
	letter-spacing: 0.05em;
}`,
			probe: { selector: '.sidebar-content .group-label .large', property: 'text-transform' },
		},
		divider: {
			css: `.sidebar-content li > details > summary {
	border-top: 1px solid var(--sl-color-hairline);
	padding-top: 0.5rem;
}`,
			probe: { selector: '.sidebar-content li > details > summary', property: 'border-top-width' },
		},
	},

	'toc.currentItemStyle': {
		'left-bar': {
			css: `starlight-toc a[aria-current='true'] {
	color: var(--sl-color-white);
	background-color: transparent;
	border-inline-start: 2px solid var(--sl-color-text-accent);
}`,
			probe: { selector: "starlight-toc a[aria-current='true']", property: 'border-left-width' },
		},
		tint: {
			css: `starlight-toc a[aria-current='true'] {
	color: var(--sl-color-white);
	background-color: var(--sl-color-accent-low);
	border-radius: var(--svc-radius, 0.25rem);
}`,
			probe: { selector: "starlight-toc a[aria-current='true']", property: 'background-color' },
		},
		dot: {
			css: `starlight-toc a[aria-current='true'] {
	position: relative;
	padding-inline-start: calc(1rem * var(--depth, 0) + 1.25rem);
}
starlight-toc a[aria-current='true']::before {
	content: '';
	position: absolute;
	inset-inline-start: calc(1rem * var(--depth, 0) + 0.35rem);
	top: 50%;
	transform: translateY(-50%);
	width: 0.35rem;
	height: 0.35rem;
	border-radius: 50%;
	background-color: var(--sl-color-text-accent);
}`,
			probe: { selector: "starlight-toc a[aria-current='true']", property: 'padding-left' },
		},
	},

	'toc.position': {
		// Only at the TOC breakpoint (>=72rem, TwoColumnContent.astro): below it the rail renders
		// via <mobile-starlight-toc> instead, so this is a genuine no-op on mobile, not just a
		// visual coincidence.
		//
		// `.right-sidebar` is `position: fixed; width: 100%` in Starlight's own CSS - that "100%"
		// resolves against the *viewport* (its containing block for a fixed element), and the trick
		// only looks right for the default right-hand placement because the rail's intended right
		// edge already coincides with the viewport's right edge. Moving the rail to the left with
		// only an `order` swap would keep that `width: 100%` computation and paint a
		// viewport-width, mostly-transparent box starting at the rail's new (left) position -
		// silently overlapping and eating clicks on the content column. Switching to
		// `position: sticky` sidesteps this entirely: percentages then resolve against the normal
		// in-flow containing block (`.right-sidebar-container`, which is already sized correctly by
		// Starlight's own width formula) regardless of which side the flex `order` puts it on.
		left: {
			css: `@media (min-width: 72rem) {
	.right-sidebar-container {
		order: -1;
	}
	.right-sidebar {
		position: sticky;
		top: var(--sl-nav-height);
		border-inline-start: none;
		border-inline-end: 1px solid var(--sl-color-hairline);
	}
	.main-pane {
		--sl-content-margin-inline: 0 auto;
	}
}`,
			probe: { selector: '.right-sidebar-container', property: 'order' },
		},

		// `.right-sidebar` is `position: fixed; width: 100%` in
		// Starlight's own CSS, with `left`/`right` both `auto` - per the CSS2.1 abs-pos algorithm, an
		// `auto` inline-start resolves to the box's own STATIC position (roughly where
		// `.right-sidebar-container`, its non-positioned flex-item parent, sits in the row), and a
		// non-auto `width` then resolves against the FIXED box's real containing block, the viewport -
		// not the container's own (narrower) box. Measured empirically at 1920px:
		// `.right-sidebar` rendered `left: 1320px; width: 1920px`, i.e. a 1920px-wide box
		// starting at x=1320 and extending to x=3240 - only its LEFT portion (1320 to 1920) was ever
		// visible, clipped by the viewport edge, and the actual TOC content inside it is left-aligned
		// within that oversized, mostly off-screen box - nowhere near the window's real right edge. The
		// container itself already reaches the true window edge (no outer max-width wraps the two-column
		// row), so the fix only needs to stop `.right-sidebar` computing its own left/width from that
		// container at all: an explicit `right: 0` (flush to the window, same edge the container's own
		// box already touches) and a real, fixed `width` kill the runaway 100vw box outright.
		// `.right-sidebar-container`'s own flex width (and therefore `.main-pane`'s complementary width
		// formula) is untouched - the content keeps its own alignment rules - so a big gap
		// can appear between the content column and a window-docked TOC on very wide screens; that's the
		// accepted trade-off of pinning to the window rather than the content. `--sl-sidebar-pad-x`
		// (`.right-sidebar-panel`'s own existing padding, PageSidebar.astro) already insets the visible
		// text from this box's edge, so "the window's right edge minus its padding" needs no separate,
		// invented gutter here.
		'window-right': {
			css: `@media (min-width: 72rem) {
	.right-sidebar {
		left: auto;
		right: 0;
		width: var(--sl-sidebar-width);
	}
}`,
			probe: { selector: '.right-sidebar', property: 'right' },
		},
	},

	'layout.contentAlign': {
		// Only at the TOC/sidebar breakpoint (>=72rem, ContentPanel.astro): below it Starlight
		// never sets `margin-inline` on `.sl-container` at all, so this is a genuine no-op there.
		start: {
			css: `@media (min-width: 72rem) {
	.main-pane {
		--sl-content-margin-inline: 0 auto;
	}
}`,
			probe: { selector: '.main-pane .sl-container', property: 'margin-left' },
		},
		center: {
			css: `@media (min-width: 72rem) {
	.main-pane {
		--sl-content-margin-inline: auto;
	}
}`,
			probe: { selector: '.main-pane .sl-container', property: 'margin-left' },
		},
	},

	'content.asideStyle': {
		'full-border': {
			css: `.starlight-aside {
	border: 1px solid var(--sl-color-asides-border);
	border-inline-start-width: 1px;
	border-radius: var(--svc-radius, 0.25rem);
}`,
			probe: { selector: '.starlight-aside', property: 'border-top-width' },
		},
		filled: {
			css: `.starlight-aside {
	border-inline-start-width: 0;
	border-radius: var(--svc-radius, 0.5rem);
}`,
			probe: { selector: '.starlight-aside', property: 'border-left-width' },
		},
		minimal: {
			css: `.starlight-aside {
	border-inline-start-width: 0;
	background-color: transparent;
	padding-inline-start: 0;
}`,
			probe: { selector: '.starlight-aside', property: 'background-color' },
		},
	},

	'content.inlineCodeStyle': {
		rounded: {
			css: `.sl-markdown-content code:not(:where(.not-content *)):not(pre code) {
	border-radius: var(--svc-radius, 0.25rem);
}`,
			probe: {
				selector: '.sl-markdown-content code:not(:where(.not-content *)):not(pre code)',
				property: 'border-radius',
			},
		},
		outlined: {
			css: `.sl-markdown-content code:not(:where(.not-content *)):not(pre code) {
	background-color: transparent;
	border: 1px solid var(--sl-color-gray-5);
}`,
			probe: {
				selector: '.sl-markdown-content code:not(:where(.not-content *)):not(pre code)',
				property: 'border-top-width',
			},
		},
		'accent-tinted': {
			css: `.sl-markdown-content code:not(:where(.not-content *)):not(pre code) {
	background-color: var(--sl-color-accent-low);
	color: var(--sl-color-text-accent);
}`,
			probe: {
				selector: '.sl-markdown-content code:not(:where(.not-content *)):not(pre code)',
				property: 'background-color',
			},
		},
	},

	'content.linkStyle': {
		'no-underline': {
			css: `.sl-markdown-content a:not(:where(.not-content *)) {
	text-decoration: none;
}
.sl-markdown-content a:not(:where(.not-content *)):hover {
	text-decoration: underline;
}`,
			probe: {
				selector: '.sl-markdown-content a:not(:where(.not-content *))',
				property: 'text-decoration-line',
			},
		},
		'thick-offset': {
			css: `.sl-markdown-content a:not(:where(.not-content *)) {
	text-decoration: underline;
	text-decoration-thickness: 2px;
	text-underline-offset: 3px;
}`,
			probe: {
				selector: '.sl-markdown-content a:not(:where(.not-content *))',
				property: 'text-decoration-thickness',
			},
		},
		'accent-bg-hover': {
			css: `.sl-markdown-content a:not(:where(.not-content *)) {
	text-decoration: none;
	border-radius: var(--svc-radius, 0.2rem);
}
.sl-markdown-content a:not(:where(.not-content *)):hover {
	background-color: var(--sl-color-accent-low);
	color: var(--sl-color-text-accent);
}`,
			probe: {
				selector: '.sl-markdown-content a:not(:where(.not-content *))',
				property: 'text-decoration-line',
			},
		},
	},

	'content.tableStyle': {
		striped: {
			css: `.sl-markdown-content table:not(:where(.not-content *)) tr:nth-child(even) {
	background-color: var(--sl-color-gray-6);
}`,
			probe: {
				selector: '.sl-markdown-content table:not(:where(.not-content *)) tr:nth-child(even)',
				property: 'background-color',
			},
		},
		bordered: {
			css: `.sl-markdown-content :is(th, td):not(:where(.not-content *)) {
	border: 1px solid var(--sl-color-gray-5);
}`,
			probe: {
				selector: '.sl-markdown-content td:not(:where(.not-content *))',
				property: 'border-top-width',
			},
		},
		'header-fill': {
			css: `.sl-markdown-content th:not(:where(.not-content *)) {
	background-color: var(--sl-color-gray-6);
	padding-inline: 0.75rem;
}`,
			probe: {
				selector: '.sl-markdown-content th:not(:where(.not-content *))',
				property: 'background-color',
			},
		},
	},

	'content.titleAlign': {
		// `.sl-container > h1#_top` (not the bare `h1#_top` id, which PAGE_TITLE_ID also puts on
		// the splash Hero's own title) - PageTitle.astro's <h1> is a direct slotted child of
		// ContentPanel's `.sl-container`; Hero's <h1> sits several levels deeper inside `.hero
		// .stack .copy`, so this selector reaches the regular page title only and never fights
		// with `content.heroAlign` on a splash page.
		center: {
			css: `.sl-container > h1#_top {
	text-align: center;
}`,
			probe: { selector: '.sl-container > h1#_top', property: 'text-align' },
		},
	},

	'content.heroAlign': {
		// Hero.astro's own responsive rule only reflows text-left/image-right at >=50rem; below
		// that everything stacks and centers already, so `center` (forcing the stacked look
		// upward into desktop) is scoped to that breakpoint and is a no-op on mobile by
		// construction. `start` (forcing the desktop look downward onto mobile) is the one option
		// that's intentionally NOT breakpoint-scoped - that unconditional application is the whole
		// point of the option - verified at 390px not to overlap or overflow.
		center: {
			css: `@media (min-width: 50rem) {
	.hero {
		grid-template-columns: 100%;
		gap: 1rem;
		padding-top: 0;
		padding-bottom: 1rem;
	}
	.hero > img,
	.hero > .hero-html {
		order: 0;
		width: min(70%, 20rem);
	}
	.hero .stack {
		text-align: center;
	}
	.hero .copy {
		align-items: center;
	}
	.hero .actions {
		justify-content: center;
	}
}`,
			probe: { selector: '.hero', property: 'grid-template-columns' },
		},
		start: {
			css: `.hero {
	grid-template-columns: 7fr 4fr;
	gap: 3%;
}
.hero > img,
.hero > .hero-html {
	order: 2;
	width: min(100%, 25rem);
}
.hero .stack {
	text-align: start;
}
.hero .copy {
	align-items: flex-start;
}
.hero .actions {
	justify-content: flex-start;
}`,
			probe: { selector: '.hero .stack', property: 'text-align' },
		},
	},

	'components.tabsIndicatorStyle': {
		pill: {
			css: `starlight-tabs [role='tablist'] {
	border-bottom: none;
	gap: 0.25rem;
}
starlight-tabs .tab > [role='tab'] {
	box-shadow: none;
	border-radius: 999px;
	background-color: var(--sl-color-gray-6);
}
starlight-tabs .tab > [role='tab'][aria-selected='true'] {
	background-color: var(--sl-color-accent);
	color: var(--sl-color-text-invert);
}`,
			probe: { selector: "starlight-tabs .tab > [role='tab']", property: 'border-radius' },
		},
		segmented: {
			css: `starlight-tabs [role='tablist'] {
	border-bottom: none;
	border: 1px solid var(--sl-color-gray-5);
	border-radius: var(--svc-radius, 0.5rem);
	padding: 0.2rem;
	gap: 0;
}
starlight-tabs .tab > [role='tab'] {
	box-shadow: none;
	border-radius: var(--svc-radius, 0.4rem);
}
starlight-tabs .tab > [role='tab'][aria-selected='true'] {
	background-color: var(--sl-color-accent);
	color: var(--sl-color-text-invert);
}`,
			probe: { selector: "starlight-tabs [role='tablist']", property: 'border-top-width' },
		},
	},

	'footer.paginationStyle': {
		'minimal-links': {
			css: `.pagination-links a {
	border: none;
	box-shadow: none;
	padding: 0.25rem 0;
	background: transparent;
}`,
			probe: { selector: '.pagination-links a', property: 'border-top-width' },
		},
		'full-width-bar': {
			css: `.pagination-links {
	grid-template-columns: 1fr;
}
.pagination-links a {
	border-radius: var(--svc-radius, 0px);
	justify-content: space-between;
}`,
			probe: { selector: '.pagination-links', property: 'grid-template-columns' },
		},
	},

	'content.blockquoteStyle': {
		// Starlight's own default already draws a 1px left bar (markdown.css) - these three read as
		// genuinely different treatments, not variations on the same idea.
		'soft-fill': {
			css: `.sl-markdown-content blockquote:not(:where(.not-content *)) {
	background-color: var(--sl-color-gray-6);
	border-inline-start: none;
	padding: 0.75rem 1rem;
	border-radius: var(--svc-radius, 0.35rem);
}`,
			probe: {
				selector: '.sl-markdown-content blockquote:not(:where(.not-content *))',
				property: 'background-color',
			},
		},
		editorial: {
			css: `.sl-markdown-content blockquote:not(:where(.not-content *)) {
	font-style: italic;
	border-inline-start: 3px solid var(--sl-color-text-accent);
	padding-inline-start: 1.25rem;
	color: var(--sl-color-gray-1);
}`,
			probe: {
				selector: '.sl-markdown-content blockquote:not(:where(.not-content *))',
				property: 'font-style',
			},
		},
		minimal: {
			css: `.sl-markdown-content blockquote:not(:where(.not-content *)) {
	border-inline-start: none;
	padding-inline-start: 0;
	color: var(--sl-color-gray-3);
}`,
			probe: {
				selector: '.sl-markdown-content blockquote:not(:where(.not-content *))',
				property: 'border-left-width',
			},
		},
	},

	'components.cardStyle': {
		elevated: {
			css: `article.card {
	border-color: transparent;
	box-shadow: var(--sl-shadow-md);
	border-radius: var(--svc-radius, 0.5rem);
}`,
			probe: { selector: 'article.card', property: 'box-shadow' },
		},
		flat: {
			css: `article.card {
	border: none;
	background-color: var(--sl-color-gray-6);
}`,
			probe: { selector: 'article.card', property: 'border-top-width' },
		},
	},

	// Starlight's own <LinkButton> is already `border-radius: 999rem` (a full pill) by default -
	// "soft"/"square" are the two genuinely distinguishable alternatives; a third "pill" option
	// would just repeat the default and fail tiles.mjs's no-two-tiles-identical guard.
	'components.linkButtonStyle': {
		soft: {
			css: `.sl-link-button {
	border-radius: var(--svc-radius, 0.5rem);
}`,
			probe: { selector: '.sl-link-button', property: 'border-radius' },
		},
		square: {
			css: `.sl-link-button {
	border-radius: 0;
}`,
			probe: { selector: '.sl-link-button', property: 'border-radius' },
		},
	},

	'components.badgeStyle': {
		pill: {
			css: `.sl-badge {
	border-radius: 999px;
}`,
			probe: { selector: '.sl-badge.default', property: 'border-radius' },
		},
		square: {
			css: `.sl-badge {
	border-radius: 0;
}`,
			probe: { selector: '.sl-badge.default', property: 'border-radius' },
		},
		// Overriding the final `background-color` (not the per-variant `--sl-color-bg-badge` custom
		// property each variant sets) works for every color variant at once and leaves each
		// variant's own border/text color - which stay on their own custom properties - untouched.
		outline: {
			css: `.sl-badge {
	background-color: transparent;
}`,
			probe: { selector: '.sl-badge.default', property: 'background-color' },
		},
	},

	'footer.paginationAlign': {
		center: {
			css: `.pagination-links {
	grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), max-content));
	justify-content: center;
}`,
			probe: { selector: '.pagination-links', property: 'justify-content' },
		},
		stretch: {
			// Not a duplicate of `footer.paginationStyle: full-width-bar` (which restructures the
			// grid to a single stacked column): this keeps the default side-by-side card grid and
			// only spreads each card's own icon+text apart to its edges.
			css: `.pagination-links a {
	justify-content: space-between;
}`,
			probe: { selector: '.pagination-links a', property: 'justify-content' },
		},
	},
};

/**
 * Fixed set of stable Tier-2 radius hooks driven by the `layout.radius` control's `--svc-radius`
 * custom property, applied independently of which treatment option (if any) is currently
 * selected for that surface. Emitted before the per-control treatment CSS above so an explicit,
 * shape-defining treatment declaration (e.g. tabs "pill" using a fixed 999px) that follows it in
 * source order still wins for that property on that selector (last-declaration-wins, same layer
 * and specificity).
 * @type {{selector: string, mediaQuery?: string}[]}
 */
export const globalRadiusHooks = [
	{ selector: ".sidebar-content a[aria-current='page']" },
	{ selector: 'button[data-open-modal]', mediaQuery: '(min-width: 50rem)' },
	{ selector: '.pagination-links a' },
	{ selector: 'mobile-starlight-toc .toggle' },
	{ selector: '.starlight-aside' },
];
