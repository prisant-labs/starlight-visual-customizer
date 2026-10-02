// @ts-check

/**
 * The demo site ("Orbit Docs") lives in one folder, `src/content/docs/demo/`, so Starlight serves
 * every demo page under `/demo/` and the site root stays free for the product page.
 *
 * `fixture-sidebar.mjs` deliberately stays prefix-free. It is also the Structure editor's starting
 * tree, and that editor exports a sidebar a user pastes into their OWN site, where pages have no
 * `demo/` folder. So the prefix is added only where the demo itself is built or previewed:
 *  - `astro.config.mjs`, and the round-trip test's fresh site, give Starlight
 *    `demoSidebar(fixtureSidebar)`;
 *  - `sidebar-render.js` builds the preview's hrefs for slug items with `demoSlug()`.
 */

/** The folder under `src/content/docs/`, and the first URL segment, of every demo page. */
export const DEMO_DIR = 'demo';

/**
 * @param {string} slug A prefix-free slug, e.g. `guides/kitchen-sink`.
 * @returns {string} The same slug inside the demo folder, e.g. `demo/guides/kitchen-sink`.
 */
export function demoSlug(slug) {
	return `${DEMO_DIR}/${String(slug).replace(/^\/+/, '')}`;
}

/**
 * Copies a Starlight `sidebar` array with every slug and every `autogenerate.directory` moved into
 * the demo folder. Labels, badges, `collapsed` and every other field are copied unchanged, and the
 * input is never mutated.
 * @param {any[]} items A Starlight sidebar array (or a group's `items`).
 * @returns {any[]}
 */
export function demoSidebar(items) {
	return items.map((item) => {
		if (typeof item === 'string') return demoSlug(item);
		const out = { ...item };
		if (typeof item.slug === 'string') out.slug = demoSlug(item.slug);
		if (item.autogenerate) out.autogenerate = { ...item.autogenerate, directory: demoSlug(item.autogenerate.directory) };
		if (Array.isArray(item.items)) out.items = demoSidebar(item.items);
		return out;
	});
}
