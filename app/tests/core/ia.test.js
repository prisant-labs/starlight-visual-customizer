import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	iaFromStarlightConfig,
	iaToStarlightConfig,
	iaToConfigSource,
	parseSidebarSource,
	iaFromFileListing,
	iaToFrontmatterTable,
	titleCase,
} from '../../src/customizer/core/ia.js';

// ---------------------------------------------------------------------------
// fixture config: representative of everything ia.js must handle, per
// node_modules/@astrojs/starlight/dist/schemas/sidebar.d.ts.
// ---------------------------------------------------------------------------
const fixtureConfig = [
	{
		label: 'Guides',
		items: [
			{ label: 'Example Guide', slug: 'guides/example' },
			{ slug: 'guides/advanced' }, // no label: falls back to titleCase
			'guides/shorthand', // bare string shorthand for {slug}
			{
				label: 'Nested',
				collapsed: true,
				badge: { text: 'New', variant: 'tip' },
				items: [{ label: 'Deep', slug: 'guides/nested/deep' }],
			},
		],
	},
	{
		label: 'Reference',
		items: [{ autogenerate: { directory: 'reference' } }],
	},
	{ label: 'External', link: 'https://example.com', badge: 'External' },
	{ label: 'Hashed Badge', slug: 'guides/example', badge: { text: 'Beta', variant: 'caution', class: 'my-class' } },
];

describe('titleCase', () => {
	test('kebab-case and snake_case to Title Case', () => {
		assert.equal(titleCase('getting-started'), 'Getting Started');
		assert.equal(titleCase('some_file_name'), 'Some File Name');
	});
	test('strips numeric ordering prefixes', () => {
		assert.equal(titleCase('01-intro'), 'Intro');
		assert.equal(titleCase('02.setup'), 'Setup');
	});
});

describe('iaFromStarlightConfig', () => {
	const items = iaFromStarlightConfig(fixtureConfig);

	test('produces one top-level item per config entry', () => {
		assert.equal(items.length, fixtureConfig.length);
	});

	test('link items get a synthesized label when omitted', () => {
		const guides = items[0];
		const advanced = guides.items.find((i) => i.slug === 'guides/advanced');
		assert.equal(advanced.label, 'Advanced');
	});

	test('shorthand string item becomes a slug link', () => {
		const guides = items[0];
		const shorthand = guides.items.find((i) => i.slug === 'guides/shorthand');
		assert.ok(shorthand);
		assert.equal(shorthand.type, 'link');
		assert.equal(shorthand.label, 'Shorthand');
	});

	test('nested groups, collapsed, and object badges are preserved', () => {
		const guides = items[0];
		const nested = guides.items.find((i) => i.type === 'group' && i.label === 'Nested');
		assert.ok(nested);
		assert.equal(nested.collapsed, true);
		assert.deepEqual(nested.badge, { text: 'New', variant: 'tip' });
		assert.equal(nested.items[0].slug, 'guides/nested/deep');
	});

	test('autogenerate entries are parsed with their directory', () => {
		const reference = items[1];
		const auto = reference.items[0];
		assert.equal(auto.type, 'autogenerate');
		assert.equal(auto.directory, 'reference');
		assert.equal(auto.label, undefined);
	});

	test('href-based links keep their explicit label and string badge normalizes to an object', () => {
		const external = items[2];
		assert.equal(external.type, 'link');
		assert.equal(external.href, 'https://example.com');
		assert.equal(external.label, 'External');
		assert.deepEqual(external.badge, { text: 'External', variant: 'default' });
	});

	test('badge object with class is preserved', () => {
		const hashed = items[3];
		assert.deepEqual(hashed.badge, { text: 'Beta', variant: 'caution', class: 'my-class' });
	});

	test('every item gets a stable, unique id', () => {
		const ids = new Set();
		(function walk(list) {
			for (const item of list) {
				assert.ok(item.id, `missing id on ${JSON.stringify(item)}`);
				assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
				ids.add(item.id);
				if (item.type === 'group') walk(item.items);
			}
		})(items);
	});

	test('ids are deterministic across repeated parses', () => {
		const a = iaFromStarlightConfig(fixtureConfig);
		const b = iaFromStarlightConfig(fixtureConfig);
		assert.deepEqual(
			a.map((i) => i.id),
			b.map((i) => i.id)
		);
	});

	test('rejects non-array input', () => {
		assert.throws(() => iaFromStarlightConfig({}), /array/);
	});

	test('throws a readable error on an unrecognized item shape', () => {
		assert.throws(() => iaFromStarlightConfig([{ foo: 'bar' }]), /Unrecognized sidebar item/);
	});
});

describe('round trip: config -> items -> config', () => {
	test('deep-equals the input modulo documented normalizations', () => {
		const items = iaFromStarlightConfig(fixtureConfig);
		const roundTripped = iaToStarlightConfig(items);

		// Expected output applies the documented normalizations by hand:
		//  - the omitted label on `guides/advanced` is NOT re-added (still omitted,
		//    since titleCase('advanced') === 'Advanced' round-trips to "no label").
		//  - the shorthand string item re-serializes as an object with `slug`
		//    (shorthand-in, object-out is a documented, acceptable normalization
		//    since both are valid Starlight config and mean the same thing).
		//  - `collapsed: true` survives; a `collapsed: false`/absent group would
		//    not carry the key at all.
		//  - the string badge 'External' round-trips as the string 'External'.
		const expected = [
			{
				label: 'Guides',
				items: [
					{ slug: 'guides/example', label: 'Example Guide' },
					{ slug: 'guides/advanced' },
					{ slug: 'guides/shorthand' },
					{
						label: 'Nested',
						collapsed: true,
						badge: { text: 'New', variant: 'tip' },
						// 'Deep' is omitted: it equals titleCase(lastSlugSegment('guides/nested/deep')),
						// so it is indistinguishable from "no label given" and normalizes away.
						items: [{ slug: 'guides/nested/deep' }],
					},
				],
			},
			{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
			{ link: 'https://example.com', label: 'External', badge: 'External' },
			{ slug: 'guides/example', label: 'Hashed Badge', badge: { text: 'Beta', variant: 'caution', class: 'my-class' } },
		];
		assert.deepEqual(roundTripped, expected);
	});

	test('a hidden link is omitted entirely from output (only way to "hide" a manual entry)', () => {
		const items = iaFromStarlightConfig([{ label: 'Guides', items: [{ slug: 'guides/example', label: 'Example' }] }]);
		items[0].items[0].hidden = true;
		const out = iaToStarlightConfig(items);
		assert.deepEqual(out[0].items, []);
	});

	test('a labeled autogenerate leaf (only possible via the IA editor, not a real parse) wraps in a group', () => {
		/** @type {any} */
		const items = [{ type: 'autogenerate', id: 'auto:x', label: 'Auto Section', directory: 'x' }];
		const out = iaToStarlightConfig(items);
		assert.deepEqual(out, [{ label: 'Auto Section', items: [{ autogenerate: { directory: 'x' } }] }]);
	});

	test('iaToConfigSource output re-parses to an equivalent tree (source round trip)', () => {
		const items = iaFromStarlightConfig(fixtureConfig);
		const source = iaToConfigSource(items);
		assert.match(source, /^\[/);
		const reparsed = parseSidebarSource(`sidebar: ${source},`);
		assert.deepEqual(iaToStarlightConfig(reparsed), iaToStarlightConfig(items));
	});
});

describe('parseSidebarSource: tolerant parsing of messy pasted text', () => {
	test('parses a full `sidebar: [...]` snippet with comments, trailing commas, single quotes, unquoted keys', () => {
		const text = `
			// Sidebar config, pasted from astro.config.mjs
			sidebar: [
				{
					label: 'Guides', // guides section
					items: [
						{ label: 'Example Guide', slug: 'guides/example', }, // trailing comma
						/* block comment */
						{ autogenerate: { directory: 'guides/auto' } },
					],
				},
			],
		`;
		const items = parseSidebarSource(text);
		assert.equal(items.length, 1);
		assert.equal(items[0].label, 'Guides');
		assert.equal(items[0].items[0].slug, 'guides/example');
		assert.equal(items[0].items[1].type, 'autogenerate');
	});

	test('parses a bare array with no `sidebar:` key', () => {
		const text = `[ { label: 'Solo', slug: 'solo' } ]`;
		const items = parseSidebarSource(text);
		assert.equal(items.length, 1);
		assert.equal(items[0].slug, 'solo');
	});

	test('parses nested groups and both badge forms', () => {
		const text = `
			[
				{
					label: "Top",
					badge: "New",
					items: [
						{ label: "Child", slug: 'a/b', badge: { text: 'Beta', variant: 'caution' } },
					]
				}
			]
		`;
		const items = parseSidebarSource(text);
		assert.deepEqual(items[0].badge, { text: 'New', variant: 'default' });
		assert.deepEqual(items[0].items[0].badge, { text: 'Beta', variant: 'caution' });
	});

	test('tolerates being nested inside a full starlight({...}) call', () => {
		const text = `
			export default defineConfig({
				integrations: [
					starlight({
						title: 'Docs',
						sidebar: [
							{ label: 'Guides', items: [{ slug: 'guides/example', label: 'Example' }] },
						],
					}),
				],
			});
		`;
		const items = parseSidebarSource(text);
		assert.equal(items.length, 1);
		assert.equal(items[0].items[0].slug, 'guides/example');
	});

	test('throws a readable error on an unsupported expression (variable reference)', () => {
		const text = `sidebar: [ { label: someVar, slug: 'x' } ]`;
		assert.throws(() => parseSidebarSource(text), /Unsupported expression "someVar"/);
	});

	test('throws a readable error when no sidebar array can be found', () => {
		assert.throws(() => parseSidebarSource('title: "Docs"'), /Could not find a sidebar array/);
	});

	test('throws on empty input', () => {
		assert.throws(() => parseSidebarSource(''), /no text provided/);
	});

	test('throws a readable error on malformed syntax', () => {
		assert.throws(() => parseSidebarSource('sidebar: [ { label: '), /Could not parse sidebar source/);
	});
});

describe('iaFromFileListing', () => {
	const expectedGroupsAndLinks = (items) => {
		const guides = items.find((i) => i.label === 'Guides');
		const reference = items.find((i) => i.label === 'Reference');
		assert.ok(guides, 'expected a Guides group');
		assert.ok(reference, 'expected a Reference group');
		const guideSlugs = guides.items.map((i) => i.slug).sort();
		assert.deepEqual(guideSlugs, ['guides', 'guides/example', 'guides/getting-started']);
		// index.md under guides/ becomes the group's own link, labeled after the folder
		const guidesIndex = guides.items.find((i) => i.slug === 'guides');
		assert.equal(guidesIndex.label, 'Guides');
		assert.deepEqual(
			reference.items.map((i) => i.slug),
			['reference/example']
		);
	};

	test('plain newline path list', () => {
		const text = [
			'src/content/docs/index.mdx',
			'src/content/docs/guides/index.md',
			'src/content/docs/guides/example.md',
			'src/content/docs/guides/getting-started.md',
			'src/content/docs/reference/example.md',
		].join('\n');
		expectedGroupsAndLinks(iaFromFileListing(text));
	});

	test('ls -R output', () => {
		const text = [
			'.:',
			'guides',
			'index.mdx',
			'reference',
			'',
			'./guides:',
			'index.md',
			'example.md',
			'getting-started.md',
			'',
			'./reference:',
			'example.md',
			'',
		].join('\n');
		expectedGroupsAndLinks(iaFromFileListing(text));
	});

	test('tree output with Unicode box-drawing characters', () => {
		const text = [
			'docs',
			'├── guides',
			'│   ├── example.md',
			'│   ├── getting-started.md',
			'│   └── index.md',
			'├── index.mdx',
			'└── reference',
			'    └── example.md',
			'',
			'2 directories, 5 files',
		].join('\n');
		expectedGroupsAndLinks(iaFromFileListing(text));
	});

	test('a root-level index file is dropped (it is the splash page, not a sidebar entry)', () => {
		const items = iaFromFileListing('src/content/docs/index.mdx\nsrc/content/docs/about.md');
		assert.equal(items.length, 1);
		assert.equal(items[0].slug, 'about');
	});

	test('labels are derived from filenames (kebab -> Title Case)', () => {
		const items = iaFromFileListing('src/content/docs/getting-started.md');
		assert.equal(items[0].label, 'Getting Started');
	});

	test('files/folders starting with an underscore are excluded', () => {
		const items = iaFromFileListing('src/content/docs/_drafts/secret.md\nsrc/content/docs/about.md');
		assert.equal(items.length, 1);
		assert.equal(items[0].slug, 'about');
	});

	test('empty input returns an empty tree', () => {
		assert.deepEqual(iaFromFileListing(''), []);
		assert.deepEqual(iaFromFileListing('   '), []);
	});

	test('ids are stable and unique across a real listing', () => {
		const items = iaFromFileListing(
			'src/content/docs/guides/example.md\nsrc/content/docs/guides/getting-started.md\nsrc/content/docs/reference/example.md'
		);
		const ids = new Set();
		(function walk(list) {
			for (const item of list) {
				assert.ok(!ids.has(item.id));
				ids.add(item.id);
				if (item.type === 'group') walk(item.items);
			}
		})(items);
	});
});

describe('iaToFrontmatterTable', () => {
	test('emits one row per slug link, with 1-based order and only non-default fields', () => {
		const items = iaFromStarlightConfig([
			{
				label: 'Guides',
				items: [
					{ slug: 'guides/example', label: 'Example Guide' }, // custom label -> included
					{ slug: 'guides/advanced' }, // default label -> omitted
				],
			},
		]);
		const table = iaToFrontmatterTable(items);
		assert.deepEqual(table, [
			{ file: 'src/content/docs/guides/example.md', sidebar: { order: 1, label: 'Example Guide' } },
			{ file: 'src/content/docs/guides/advanced.md', sidebar: { order: 2 } },
		]);
	});

	test('includes hidden and badge when set', () => {
		const items = iaFromStarlightConfig([
			{ label: 'G', items: [{ slug: 'g/a', label: 'Awesome A', badge: 'New' }] },
		]);
		items[0].items[0].hidden = true;
		const table = iaToFrontmatterTable(items);
		assert.deepEqual(table[0].sidebar, {
			order: 1,
			label: 'Awesome A',
			hidden: true,
			badge: { text: 'New', variant: 'default' },
		});
	});

	test('recurses into nested groups', () => {
		const items = iaFromStarlightConfig([
			{ label: 'G', items: [{ label: 'Sub', items: [{ slug: 'g/sub/a', label: 'X' }] }] },
		]);
		const table = iaToFrontmatterTable(items);
		assert.equal(table.length, 1);
		assert.equal(table[0].file, 'src/content/docs/g/sub/a.md');
	});

	test('href-based links (no slug) never produce a row', () => {
		const items = iaFromStarlightConfig([{ label: 'Ext', link: 'https://example.com' }]);
		assert.deepEqual(iaToFrontmatterTable(items), []);
	});

	test('autogenerate leaves contribute no rows on their own (no enumerable files)', () => {
		const items = iaFromStarlightConfig([{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] }]);
		assert.deepEqual(iaToFrontmatterTable(items), []);
	});

	test('empty tree yields an empty table', () => {
		assert.deepEqual(iaToFrontmatterTable([]), []);
	});
});
