/**
 * @file Client-side sidebar re-renderer. "Clone, don't construct" (SPEC.md): every element this
 * module ever inserts is a `cloneNode(true)` of a real element harvested from the page's own
 * server-rendered `.sidebar-content` before any mutation, so Astro's per-component scoped style
 * class (e.g. `astro-rmhv4bp6`) rides along automatically - a hand-built `<li>`/`<a>` would lose
 * `SidebarSublist.astro`'s styling entirely.
 *
 * Structure note (read from `node_modules/@astrojs/starlight/dist/components/{Sidebar,
 * SidebarPersister,PageFrame}.astro`): `.sidebar-content` also contains a
 * `<sl-sidebar-state-persist>` wrapper (holding inline scroll/open-state-restore scripts) and,
 * as a *sibling* of that wrapper, a mobile-only `<div class="md:sl-hidden">` (MobileMenuFooter).
 * Replacing `.sidebar-content`'s children wholesale would silently delete the mobile menu footer.
 * This module therefore only ever touches `ul.top-level` (the actual nav tree), found by querying
 * `.sidebar-content ul.top-level` rather than assuming a fixed parent chain.
 *
 * PAGE-facing, keyed per document (studio.astro's design doc, item C): in plain overlay mode
 * there is exactly one page document for this module's whole lifetime (a full page load re-imports
 * this module fresh), so a single set of module-level template variables was enough. In studio
 * mode the SAME long-lived module instance sees many different frame documents over its life (one
 * per frame navigation), each with its own `.sidebar-content` DOM to harvest from - so harvested
 * state is now keyed by `pageDoc` in a `WeakMap` instead of living in bare module-level variables.
 * Re-harvesting the *same* document a second time (idempotent re-attach, see panel.js) is a cheap
 * no-op via the map lookup below.
 */
import { fixtureSidebar } from '../../fixture-sidebar.mjs';
import { iaFromStarlightConfig } from '../core/ia.js';

const BADGE_VARIANTS = ['default', 'note', 'tip', 'caution', 'danger', 'success'];

/**
 * @typedef {{
 *   topUlLive: HTMLUListElement,
 *   pristineTopUl: HTMLUListElement,
 *   linkTemplate: HTMLLIElement | null,
 *   groupTemplate: HTMLLIElement | null,
 *   badgeTemplate: HTMLElement | null,
 *   autogenerateLinksByDir: Map<string, {href: string, label: string}[]>,
 * }} HarvestState
 */
/** @type {WeakMap<Document, HarvestState>} */
const harvestByDoc = new WeakMap();

function stripDirSlashes(dir) {
	return String(dir).replace(/^\/+|\/+$/g, '');
}

/**
 * Walks the fixture's real SidebarItem tree in parallel with the pristine DOM `<ul>` tree to
 * recover, per `autogenerate` node, the flat list of `<a>` links Starlight actually rendered for
 * it (an autogenerate node occupies exactly one slot in `items` but may expand to 0..N sibling
 * `<li>`s in the DOM - this locates that expansion by counting the explicit siblings before/after
 * it at the same level, which works for both a bare autogenerate array and one mixed with manual
 * items).
 * @param {import('../core/ia.js').SidebarItem[]} items
 * @param {HTMLUListElement} ulEl
 */
function harvestAutogenerate(items, ulEl, autogenerateLinksByDir) {
	const liEls = Array.from(ulEl.children).filter((el) => el.tagName === 'LI');
	let domIndex = 0;
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item.type === 'autogenerate') {
			const explicitAfter = items.length - i - 1;
			const expansionEnd = liEls.length - explicitAfter;
			const expansionLis = liEls.slice(domIndex, Math.max(domIndex, expansionEnd));
			const dir = stripDirSlashes(item.directory);
			autogenerateLinksByDir.set(
				dir,
				expansionLis.map((li) => ({
					href: li.querySelector('a')?.getAttribute('href') ?? '#',
					label: li.querySelector('a > span')?.textContent ?? '',
				}))
			);
			domIndex = expansionEnd;
		} else {
			const li = liEls[domIndex];
			domIndex++;
			if (item.type === 'group' && li) {
				const nestedUl = li.querySelector(':scope > details > ul');
				if (nestedUl) harvestAutogenerate(item.items, nestedUl, autogenerateLinksByDir);
			}
		}
	}
}

/**
 * Harvests templates and the pristine sidebar tree for `pageDoc`. Must run once per document,
 * before any `renderSidebar` call for that document, and before anything else has a chance to
 * mutate its `.sidebar-content`. No-op (and safe) on a page with no sidebar (e.g. a splash page -
 * `.sidebar-content` is absent there), and a cheap no-op on a document already harvested (studio
 * mode's idempotent re-attach - see panel.js).
 * @param {Document} [pageDoc] Defaults to `document` (plain overlay mode).
 */
export function harvestSidebarTemplates(pageDoc = document) {
	if (harvestByDoc.has(pageDoc)) return;
	const container = pageDoc.querySelector('.sidebar-content');
	if (!container) return; // splash page: nothing to do (not cached - a later attach for the same doc, post-navigation-within-page, may find it)
	const ul = container.querySelector('ul.top-level');
	if (!(ul instanceof pageDoc.defaultView.HTMLUListElement)) return;

	const pristineTopUl = /** @type {HTMLUListElement} */ (ul.cloneNode(true));
	/** @type {HarvestState} */
	const state = {
		topUlLive: ul,
		pristineTopUl,
		linkTemplate: null,
		groupTemplate: null,
		badgeTemplate: null,
		autogenerateLinksByDir: new Map(),
	};

	const linkAnchor = pristineTopUl.querySelector('li > a');
	state.linkTemplate = linkAnchor ? /** @type {HTMLLIElement} */ (linkAnchor.closest('li')) : null;
	const detailsEl = pristineTopUl.querySelector('li > details');
	state.groupTemplate = detailsEl ? /** @type {HTMLLIElement} */ (detailsEl.closest('li')) : null;
	state.badgeTemplate = pristineTopUl.querySelector('.sl-badge');

	try {
		const tree = iaFromStarlightConfig(fixtureSidebar);
		harvestAutogenerate(tree, pristineTopUl, state.autogenerateLinksByDir);
	} catch (err) {
		console.warn('[sl-customizer] could not harvest autogenerate sidebar links:', err);
	}

	harvestByDoc.set(pageDoc, state);
}

function normalizePath(pathname) {
	const stripped = pathname.replace(/\/+$/, '');
	return stripped === '' ? '/' : stripped;
}

/** @param {string} href @param {Window} pageWin The page's own window, for its own `location` - in
 * studio mode that's the frame's window, never the host/top window running this module. */
function isCurrentHref(href, pageWin) {
	if (!href || href === '#') return false;
	try {
		const url = new URL(href, pageWin.location.origin);
		return normalizePath(url.pathname) === normalizePath(pageWin.location.pathname);
	} catch {
		return false;
	}
}

function linkHref(item) {
	if (item.href !== undefined) return item.href;
	if (item.slug !== undefined) return `/${item.slug}/`;
	return '#';
}

/** @param {import('../core/ia.js').Badge} badge @param {HarvestState} h @returns {HTMLElement} */
function buildBadge(badge, h) {
	const el = /** @type {HTMLElement} */ (h.badgeTemplate.cloneNode(true));
	for (const variant of BADGE_VARIANTS) el.classList.remove(variant);
	el.classList.add(badge.variant);
	el.textContent = badge.text;
	return el;
}

/**
 * @param {{href?:string, slug?:string, label:string, badge?: import('../core/ia.js').Badge}} item
 * @param {number} depth @param {HarvestState} h @param {Window} pageWin
 */
function buildLinkLi(item, depth, h, pageWin) {
	const li = /** @type {HTMLLIElement} */ (h.linkTemplate.cloneNode(true));
	const a = li.querySelector('a');
	const href = linkHref(item);
	a.setAttribute('href', href);
	a.classList.toggle('large', depth === 0);
	if (isCurrentHref(href, pageWin)) a.setAttribute('aria-current', 'page');
	else a.removeAttribute('aria-current');
	const existingBadge = a.querySelector('.sl-badge');
	if (existingBadge) existingBadge.remove();
	const span = a.querySelector('span') ?? a;
	span.textContent = item.label;
	if (item.badge) a.appendChild(buildBadge(item.badge, h));
	return li;
}

/** @param {import('../core/ia.js').SidebarItem} item @param {HarvestState} h @param {Window} pageWin @returns {boolean} */
function containsCurrent(item, h, pageWin) {
	if (item.type === 'link') return !item.hidden && isCurrentHref(linkHref(item), pageWin);
	if (item.type === 'group') return item.items.some((it) => containsCurrent(it, h, pageWin));
	if (item.type === 'autogenerate') {
		const links = h.autogenerateLinksByDir.get(stripDirSlashes(item.directory)) ?? [];
		return links.some((l) => isCurrentHref(l.href, pageWin));
	}
	return false;
}

/** @param {import('../core/ia.js').SidebarGroup} item @param {number} depth @param {HarvestState} h @param {Window} pageWin */
function buildGroupLi(item, depth, h, pageWin) {
	const li = /** @type {HTMLLIElement} */ (h.groupTemplate.cloneNode(true));
	li.querySelectorAll('sl-sidebar-restore').forEach((el) => el.remove());
	const details = li.querySelector('details');
	details.open = containsCurrent(item, h, pageWin) || !item.collapsed;
	const labelSpan = li.querySelector('.group-label .large');
	if (labelSpan) labelSpan.textContent = item.label;
	const existingBadge = li.querySelector('.group-label .sl-badge');
	if (existingBadge) existingBadge.remove();
	if (item.badge) li.querySelector('.group-label')?.appendChild(buildBadge(item.badge, h));
	const nestedUl = details.querySelector(':scope > ul');
	nestedUl.replaceChildren(...buildItems(item.items, depth + 1, h, pageWin));
	return li;
}

/** @param {import('../core/ia.js').SidebarAutogenerate} item @param {number} depth @param {HarvestState} h @param {Window} pageWin */
function buildAutogenerateLis(item, depth, h, pageWin) {
	const dir = stripDirSlashes(item.directory);
	const links = h.autogenerateLinksByDir.get(dir);
	if (links && links.length) {
		return links.map(({ href, label }) => buildLinkLi({ href, label }, depth, h, pageWin));
	}
	return [buildLinkLi({ href: '#', label: `(autogenerated: ${dir})` }, depth, h, pageWin)];
}

/** @param {import('../core/ia.js').SidebarItem[]} items @param {number} depth @param {HarvestState} h @param {Window} pageWin @returns {HTMLLIElement[]} */
function buildItems(items, depth, h, pageWin) {
	/** @type {HTMLLIElement[]} */
	const out = [];
	for (const item of items) {
		if (item.type === 'link') {
			if (item.hidden) continue;
			out.push(buildLinkLi(item, depth, h, pageWin));
		} else if (item.type === 'group') {
			out.push(buildGroupLi(item, depth, h, pageWin));
		} else if (item.type === 'autogenerate') {
			out.push(...buildAutogenerateLis(item, depth, h, pageWin));
		}
	}
	return out;
}

/**
 * @param {Document} pageDoc Defaults to `document` (plain overlay mode); pass the harvested
 *   document explicitly (studio mode: the frame's current document - must have already been
 *   through `harvestSidebarTemplates`, see panel.js's attach flow).
 * @param {import('../core/ia.js').SidebarItem[] | null} ia `state.ia`. `null` restores the
 *   pristine, server-rendered sidebar exactly (harvested at load, before any mutation).
 */
export function renderSidebar(pageDoc, ia) {
	const h = harvestByDoc.get(pageDoc);
	if (!h) return; // no sidebar on this page, or harvest failed/hasn't run yet
	if (!ia) {
		h.topUlLive.replaceChildren(...Array.from(h.pristineTopUl.cloneNode(true).children));
		return;
	}
	if (!h.linkTemplate || !h.groupTemplate) {
		console.warn('[sl-customizer] sidebar templates missing; leaving sidebar untouched.');
		return;
	}
	const pageWin = pageDoc.defaultView ?? window;
	h.topUlLive.replaceChildren(...buildItems(ia, 0, h, pageWin));
}
