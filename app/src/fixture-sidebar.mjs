// @ts-check

/**
 * The fixture's sidebar navigation tree.
 *
 * This is the single source of truth for the kitchen-sink site's Starlight
 * `sidebar` config. It is imported by `astro.config.mjs` (as the live
 * sidebar) and is also the shape the customizer's IA editor (`ia.js` /
 * `sidebar-render.js`) will use as its starting tree via
 * `iaFromStarlightConfig(fixtureSidebar)`.
 *
 * Shape notes (see Starlight's `schemas/sidebar.js`):
 *  - `{ slug, label }` is an internal link item.
 *  - `{ label, items: [...] }` is a manual group; add `collapsed: true` to
 *    start it collapsed.
 *  - `{ label, items: [{ autogenerate: { directory } }] }` renders every
 *    docs page under that directory as a flat group.
 *  - `badge` on a link accepts either a bare string (variant 'default') or
 *    `{ text, variant }` where variant is one of
 *    'note' | 'tip' | 'caution' | 'danger' | 'success' | 'default'.
 *
 * Intentional exercise points for the customizer preview:
 *  - A top-level link (Getting Started) alongside 4 top-level groups, so the
 *    UI's sidebar-render.js has a real top-level `<li>` link to clone as a
 *    template, not just group `<li>`s.
 *  - 3 levels of group nesting: Guides > Advanced Guides > Power User.
 *  - `Product` starts `collapsed: true`.
 *  - Two badge variants in use: 'success' (Changelog) and 'caution' (the
 *    long-label FAQ page).
 *  - A very long sidebar label on the billing FAQ link, to check wrapping.
 *  - `guides/kitchen-sink` sits two levels deep (Guides > Kitchen Sink) and
 *    is the main preview page.
 *  - `Reference` is a pure `autogenerate` group over `src/content/docs/reference/`.
 */
export const fixtureSidebar = [
	{ slug: 'specimen', label: 'Style guide' },
	{ slug: 'guides/getting-started', label: 'Getting Started' },
	{
		label: 'Guides',
		items: [
			{ slug: 'guides/kitchen-sink', label: 'Kitchen Sink' },
			{
				label: 'Advanced Guides',
				items: [
					{ slug: 'guides/advanced/theming', label: 'Theming Deep Dive' },
					{
						label: 'Power User',
						items: [
							{ slug: 'guides/advanced/power/automation', label: 'Automation Recipes' },
							{ slug: 'guides/advanced/power/scripting', label: 'Scripting API' },
						],
					},
				],
			},
		],
	},
	{
		label: 'Product',
		collapsed: true,
		items: [
			{ slug: 'product/overview', label: 'Overview' },
			{ slug: 'product/pricing', label: 'Pricing & Plans' },
			{
				label: 'Integrations',
				items: [
					{ slug: 'product/integrations/webhooks', label: 'Webhooks' },
					{ slug: 'product/integrations/api-keys', label: 'API Keys' },
				],
			},
		],
	},
	{
		label: 'Resources',
		items: [
			{
				slug: 'resources/changelog',
				label: 'Changelog',
				badge: { text: 'Updated', variant: 'success' },
			},
			{ slug: 'resources/faq', label: 'FAQ' },
			{
				slug: 'resources/billing-faq',
				label:
					'Frequently Asked Questions About Billing, Invoicing, Refunds, and Enterprise Contract Renewals',
				badge: { text: 'Beta', variant: 'caution' },
			},
		],
	},
	{
		label: 'Reference',
		items: [{ autogenerate: { directory: 'reference' } }],
	},
];
