/**
 * @file Tests `src/demo-site.mjs`, which moves the demo site's sidebar under `/demo/` for Starlight
 * and the preview, while `fixture-sidebar.mjs` (the Structure editor's starting tree, and so the
 * source of every exported sidebar) stays prefix-free.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DEMO_DIR, demoSlug, demoSidebar } from '../../src/demo-site.mjs';
import { fixtureSidebar } from '../../src/fixture-sidebar.mjs';

/** @param {any[]} items @param {(item: any) => void} visit */
function walk(items, visit) {
	for (const item of items) {
		visit(item);
		if (item && Array.isArray(item.items)) walk(item.items, visit);
	}
}

describe('demoSlug', () => {
	test('prefixes a slug with the demo folder', () => {
		assert.equal(DEMO_DIR, 'demo');
		assert.equal(demoSlug('guides/kitchen-sink'), 'demo/guides/kitchen-sink');
		assert.equal(demoSlug('specimen'), 'demo/specimen');
	});

	test('drops a leading slash rather than doubling it', () => {
		assert.equal(demoSlug('/specimen'), 'demo/specimen');
	});
});

describe('demoSidebar', () => {
	test('moves slugs, nested slugs and autogenerate directories under the demo folder', () => {
		const out = demoSidebar([
			{ slug: 'specimen', label: 'Style guide' },
			{ label: 'Guides', collapsed: true, items: [{ slug: 'guides/kitchen-sink', label: 'Kitchen Sink', badge: 'New' }] },
			{ label: 'Reference', items: [{ autogenerate: { directory: 'reference', collapsed: true } }] },
			'guides/getting-started',
		]);
		assert.deepEqual(out, [
			{ slug: 'demo/specimen', label: 'Style guide' },
			{ label: 'Guides', collapsed: true, items: [{ slug: 'demo/guides/kitchen-sink', label: 'Kitchen Sink', badge: 'New' }] },
			{ label: 'Reference', items: [{ autogenerate: { directory: 'demo/reference', collapsed: true } }] },
			'demo/guides/getting-started',
		]);
	});

	test('leaves its input untouched', () => {
		const before = JSON.stringify(fixtureSidebar);
		demoSidebar(fixtureSidebar);
		assert.equal(JSON.stringify(fixtureSidebar), before);
	});

	test('covers every slug in the real fixture sidebar', () => {
		walk(demoSidebar(fixtureSidebar), (item) => {
			if (typeof item === 'string') assert.ok(item.startsWith('demo/'), item);
			if (item && typeof item.slug === 'string') assert.ok(item.slug.startsWith('demo/'), item.slug);
			if (item && item.autogenerate) assert.ok(item.autogenerate.directory.startsWith('demo/'), item.autogenerate.directory);
		});
	});
});

describe('fixture-sidebar.mjs stays prefix-free', () => {
	// The Structure editor starts from this tree and exports it into users' own sites, so a
	// `demo/` slug here would leak into every exported sidebar.
	test('no slug or autogenerate directory starts with the demo folder', () => {
		walk(fixtureSidebar, (item) => {
			const value = typeof item === 'string' ? item : item.slug ?? item.autogenerate?.directory;
			if (typeof value === 'string') assert.ok(!value.startsWith(`${DEMO_DIR}/`), value);
		});
	});
});
