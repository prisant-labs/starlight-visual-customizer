/**
 * @file Build-time approximation helper that needs the live DOM: stamps `data-svc-level="N"` on
 * every `starlight-toc li` / `mobile-starlight-toc li` so `emit-css.js`'s `forPreview` TOC-level
 * filtering (`[data-svc-level='N']` selectors) has something to match. Heading level is read
 * directly off `pageDoc.getElementById(<toc link's hash>).tagName` - the anchor's `id` lives on
 * the actual `h1..h6` element (`AnchorHeading.astro` puts `{id}` on `HeadingElement`, not on the
 * wrapping `.sl-heading-wrapper` div), so this is simpler and just as accurate as parsing the
 * `.sl-heading-wrapper.level-hN` class.
 *
 * PAGE-facing (studio.astro's design doc, item C): operates on `pageDoc`, not the module's own
 * `document` - in studio mode that's the preview iframe's current document, so TOC stamping
 * happens on the page actually being previewed, not the host document.
 */

/** Stamps every desktop + mobile TOC `<li>` with the heading level its link targets. Idempotent.
 * @param {Document} [pageDoc] Defaults to `document` (plain overlay mode). */
export function stampTocLevels(pageDoc = document) {
	const items = pageDoc.querySelectorAll('starlight-toc li, mobile-starlight-toc li');
	for (const li of items) {
		const anchor = li.querySelector(':scope > a');
		const href = anchor?.getAttribute('href') ?? '';
		// '#_top' is Starlight's "Overview" entry for the page title (h1). Starlight always renders
		// it regardless of min/maxHeadingLevel, so it must never be level-filtered.
		if (!href.startsWith('#') || href === '#_top') continue;
		const heading = pageDoc.getElementById(href.slice(1));
		if (!heading) continue;
		const match = /^H([1-6])$/.exec(heading.tagName);
		if (match) li.dataset.svcLevel = match[1];
	}
}

/**
 * `site.title` is build-time (no CSS token exists for it - `SiteTitle.astro` prints
 * `Astro.locals.starlightRoute.siteTitle` straight from config), so the live preview instead sets
 * `.site-title`'s text span directly. Idempotent and safe to call on every apply tick and on every
 * frame attach/navigation: the project's OWN title is captured into `dataset.svcOriginalTitle` the
 * first time this runs on a given span (a fresh element after every navigation, since Starlight
 * does full page loads), and an empty `title` restores it - "keep any logo" holds automatically
 * since only the trailing `<span>` (never the `<img>` logo siblings) is touched.
 * @param {Document | null} pageDoc
 * @param {string} title
 */
export function applySiteTitle(pageDoc, title) {
	if (!pageDoc) return;
	const spans = pageDoc.querySelectorAll('.site-title span');
	for (const span of spans) {
		if (span.dataset.svcOriginalTitle === undefined) span.dataset.svcOriginalTitle = span.textContent ?? '';
		const next = title ? title : span.dataset.svcOriginalTitle;
		if (span.textContent !== next) span.textContent = next;
	}
}
