import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { emitApplyTheme } from '../../src/customizer/core/emit-apply.js';
import { defaultState, setValue } from '../../src/customizer/core/state.js';
import { iaFromStarlightConfig } from '../../src/customizer/core/ia.js';
import { computeGeneratedPalette } from '../../src/customizer/core/emit-css.js';
import { goldenCases, buildRichState } from '../golden/cases.js';
import { TOOL_URL } from '../../src/customizer/core/project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Read a golden file, normalizing CRLF -> LF so this passes regardless of git autocrlf. */
function readGolden(name) {
	return readFileSync(path.join(__dirname, '..', 'golden', name), 'utf8').replace(/\r\n/g, '\n');
}

function normalize(text) {
	return text.replace(/\r\n/g, '\n');
}

// The cases live in tests/golden/cases.js, shared with `npm run golden:update`: the default state,
// and the "rich" fixture (web fonts, page options, and an IA with autogenerate).
describe('emitApplyTheme: golden files', () => {
	for (const c of goldenCases.filter((g) => g.file.endsWith('.md'))) {
		test(`emitApplyTheme matches tests/golden/${c.file}`, () => {
			assert.equal(normalize(c.emit()), readGolden(c.file));
		});
	}
});

describe('emitApplyTheme: determinism', () => {
	test('same state produces byte-identical output', () => {
		const state = buildRichState();
		assert.equal(emitApplyTheme(state), emitApplyTheme(state));
		assert.equal(emitApplyTheme(defaultState()), emitApplyTheme(defaultState()));
	});

	test('two independently-built equal states produce the same output', () => {
		assert.equal(emitApplyTheme(buildRichState()), emitApplyTheme(buildRichState()));
	});
});

describe('emitApplyTheme: structure', () => {
	test('always includes header, preconditions, CSS step, verification, and rollback', () => {
		const out = emitApplyTheme(defaultState());
		assert.match(out, /^> \*\*Use these steps with the `theme\.css` file in this folder\./);
		assert.match(out, /## Preconditions/);
		assert.match(out, /\*\*Add the theme CSS\.\*\*/);
		assert.match(out, /## Verification/);
		assert.match(out, /## Rollback/);
	});

	test('ends with one credit line linking to TOOL_URL, after the rollback section', () => {
		for (const state of [defaultState(), buildRichState()]) {
			const lines = emitApplyTheme(state).trimEnd().split('\n');
			assert.equal(lines.at(-1), `Made with the Starlight Visual Customizer: ${TOOL_URL}`);
			assert.ok(lines.findIndex((l) => l.startsWith('## Rollback')) < lines.length - 1);
			assert.equal(lines.filter((l) => l.includes(TOOL_URL)).length, 1);
		}
	});

	test('omits the font step when every font is "system"', () => {
		const out = emitApplyTheme(defaultState());
		assert.doesNotMatch(out, /Install the chosen fonts/);
	});

	test('omits the config options step when nothing differs from Starlight defaults', () => {
		let s = defaultState();
		s = { ...s, ia: iaFromStarlightConfig([{ label: 'G', items: [{ slug: 'g/a', label: 'A' }] }]) };
		const out = emitApplyTheme(s);
		assert.doesNotMatch(out, /Update Starlight config options/);
		assert.match(out, /Replace the sidebar navigation/);
	});

	test('omits the IA step entirely when state.ia is null', () => {
		const out = emitApplyTheme(defaultState());
		assert.doesNotMatch(out, /Replace the sidebar navigation/);
	});

	test('the STOP line names the correct target minor version', () => {
		const out = emitApplyTheme(defaultState());
		assert.match(out, /differs from `0\.42`/);
		assert.match(out, /@astrojs\/starlight@0\.42\.6/);
	});

	test('respects a custom cssFileName throughout', () => {
		const out = emitApplyTheme(defaultState(), { cssFileName: 'my-theme.css' });
		assert.match(out, /src\/styles\/my-theme\.css/);
		assert.doesNotMatch(out, /styles\/theme\.css/); // the default filename never leaks in
	});
});

// site.title is build-time (no CSS token) - emitApplyTheme is the only place its value
// is ever surfaced, so it needs its own direct coverage rather than relying on the golden files
// (whose fixtures deliberately leave it at its default, empty value).
describe('emitApplyTheme: site.title', () => {
	test('empty (default) value adds no config-options step and no title line', () => {
		const out = emitApplyTheme(defaultState());
		assert.doesNotMatch(out, /title:/);
		assert.doesNotMatch(out, /Update Starlight config options/);
	});

	test('a non-empty value adds a `title:` config line, quoted and escaped', () => {
		const s = setValue(defaultState(), 'site.title', "My Docs 'n Stuff");
		const out = emitApplyTheme(s);
		assert.match(out, /Update Starlight config options/);
		assert.match(out, /title: 'My Docs \\'n Stuff'/);
	});

	test('is summarized and listed under Verification, but never as a generic changed control', () => {
		const s = setValue(defaultState(), 'site.title', 'Acme Docs');
		const out = emitApplyTheme(s);
		assert.match(out, /a custom site title \("Acme Docs"\)/);
		assert.match(out, /Header → Site title text\*\* \(`\.site-title`\): the header now reads "Acme Docs"/);
		assert.doesNotMatch(out, /Header → Site title text.*target value/);
	});

	test('same state produces byte-identical output (determinism holds for site.title too)', () => {
		const s = setValue(defaultState(), 'site.title', 'Acme Docs');
		assert.equal(emitApplyTheme(s), emitApplyTheme(s));
	});
});

describe('emitApplyTheme: alignment controls', () => {
	test('a changed alignment control appears in the Verification checklist as a treatment-derived selector+property check (round 2), not a bare "target value" label', () => {
		let s = defaultState();
		s = setValue(s, 'toc.position', 'left');
		const out = emitApplyTheme(s);
		assert.match(
			out,
			/\*\*TOC → TOC placement\*\* \(now "Left"\): on `\.right-sidebar-container`, the computed `order` should compute to `-1` \(`theme\.css` declares `order: -1` for this selector\)/
		);
	});

	test('an alignment control at its default value does not appear anywhere in the checklist', () => {
		const out = emitApplyTheme(defaultState());
		assert.doesNotMatch(out, /TOC placement/);
		assert.doesNotMatch(out, /Search box alignment/);
	});

	test('a changed alignment control is counted among the "component treatments customized" in the summary line', () => {
		let s = defaultState();
		s = setValue(s, 'footer.paginationAlign', 'center');
		const out = emitApplyTheme(s);
		assert.match(out, /1 component treatment customized \(Pagination alignment\)/);
	});
});

describe('emitApplyTheme: fonts', () => {
	test('deduplicates a package shared by body and heading fonts', () => {
		let s = defaultState();
		s = setValue(s, 'type.font.body', 'inter');
		s = setValue(s, 'type.font.heading', 'inter');
		const out = emitApplyTheme(s);
		const installLine = out.split('\n').find((l) => l.includes('npm i @fontsource'));
		const occurrences = (installLine.match(/@fontsource-variable\/inter/g) || []).length;
		assert.equal(occurrences, 1);
	});

	test('gap 4: notes the fallback font stack and a way to verify the package name if npm i fails', () => {
		const s = setValue(defaultState(), 'type.font.body', 'inter');
		const out = emitApplyTheme(s);
		assert.match(out, /If a package fails to install/);
		assert.match(out, /fallback/i);
		assert.match(out, /npm view <pkg> version/);
	});

	test('gap 4 (round 2 correction): a failed font install FAILS the build - not "dropped by the browser"', () => {
		// Verified against a real Starlight 0.42.4/Astro 7.3.5 site: an unresolved
		// @import makes `npx astro build` fail (Vite resolves @import at build time), not degrade
		// silently. The fix is to remove that package's @import line from theme.css, not wait for a
		// browser to ignore it.
		const s = setValue(defaultState(), 'type.font.body', 'inter');
		const out = emitApplyTheme(s);
		assert.doesNotMatch(out, /dropped by the browser/);
		assert.match(out, /npx astro build.*will FAIL/);
		assert.match(out, /Unable to resolve @import/);
		assert.match(out, /remove that package.s `@import` line from `src\/styles\/theme\.css`/);
		assert.match(out, /npm view <pkg> version/);
	});
});

// W1 instruction-gap follow-up: closes gaps 1-5 found by following an earlier generated
// APPLY-THEME.md literally against a real, fresh Starlight site with no foreknowledge of the
// customizer's own vocabulary.
describe('emitApplyTheme: instruction gaps (W1 follow-up)', () => {
	test('gap 1: a changed control names its CSS selector and a target value, not the studio\'s "should now read as" phrasing', () => {
		const s = setValue(defaultState(), 'type.baseSize', 18);
		const out = emitApplyTheme(s);
		assert.doesNotMatch(out, /should now read as/);
		assert.match(out, /\*\*Typography → Base text size\*\* \(`[^`]+`\): target value "18px"/);
	});

	test('gap 1: the Verification intro explains where to look (element + page) and how to check a computed value', () => {
		const out = emitApplyTheme(defaultState());
		assert.match(out, /find an element matching the given CSS selector/);
		assert.match(out, /getComputedStyle/);
	});

	test('gap 1: a token-backed control (a single named custom property) names that property instead of a selector', () => {
		const s = setValue(defaultState(), 'color.hue.orange', 100);
		const out = emitApplyTheme(s);
		assert.match(out, /\*\*Colors → Caution hue \(orange\)\*\* \(custom property `--sl-hue-orange` on `:root`\): target value "100"/);
		// Not ALSO shown as a bare selector - the two are mutually exclusive per control.
		assert.doesNotMatch(out, /Caution hue \(orange\)\*\* \(`\.starlight-aside--caution`\)/);
	});

	test('gap 1: a non-token, non-treatment control still names its CSS selector, not a custom property', () => {
		let s = defaultState();
		s = setValue(s, 'layout.contentWidth', 50);
		const out = emitApplyTheme(s);
		assert.match(out, /\*\*Layout → Content width\*\* \(`\.main-pane \.sl-container`\): target value "50rem"/);
	});

	test('gap 1: the jointly-generated accent/gray palette (PALETTE_IDS) is NOT claimed as a single custom property or a bare hue/chroma number (superseded by the round 2 palette-hex lines below)', () => {
		const s = setValue(defaultState(), 'color.accent.hue', 200);
		const out = emitApplyTheme(s);
		assert.doesNotMatch(out, /Accent hue\*\* \(custom property/);
		assert.doesNotMatch(out, /Accent hue.*target value/);
		assert.doesNotMatch(out, /Accent chroma.*target value/);
	});

	test('gap 2: the build step notes that a running astro preview only needs a refresh, and astro dev hot-reloads', () => {
		const out = emitApplyTheme(defaultState());
		assert.match(out, /astro preview.*refresh the browser tab/);
		assert.match(out, /astro dev.*picks up the change on its own/);
	});

	test('gap 3: an existing customCss array is told to keep its entries and add this theme LAST', () => {
		const out = emitApplyTheme(defaultState());
		assert.match(out, /keep every entry already there/);
		assert.match(out, /as the LAST item in the array/);
		assert.match(out, /unlayered.*array order decides the tie/);
	});

	test('gap 5: a hand-tuned theme still carrying preset "starlight-default" reads as a custom theme, not as "the Starlight default theme"', () => {
		let s = defaultState();
		s = setValue(s, 'color.accent.hue', 200);
		s = setValue(s, 'color.accent.chroma', 0.2);
		assert.equal(s.preset, 'starlight-default');
		const out = emitApplyTheme(s);
		assert.match(out, /This applies a custom theme built on Starlight’s defaults, with/);
		assert.doesNotMatch(out, /This applies the "Starlight default" theme with/);
	});

	test('gap 5: an actually-untouched starlight-default state keeps the literal "no changes" phrasing', () => {
		const out = emitApplyTheme(defaultState());
		assert.match(out, /This applies the "Starlight default" theme with no changes from Starlight’s own defaults\./);
	});
});

// An earlier round only half-closed this gap - the palette (accent/gray hue+chroma) and
// treatment/select controls still spoke the studio's own vocabulary ("Accent hue: target value
// 200", "Active item style: target value Left bar"), neither checkable on a real site.
describe('emitApplyTheme: round 2 - palette hex checks and treatment-derived checks', () => {
	test('an accent-only change gets one Colors → Accent color line with hex values FROM THE SAME generated palette emit-css.js uses, both modes, and no gray line', () => {
		const s = setValue(defaultState(), 'color.accent.hue', 200);
		const out = emitApplyTheme(s);
		const palette = computeGeneratedPalette(s);
		assert.match(out, /\*\*Colors → Accent color\*\* \(custom properties on `:root`, from the generated palette\)/);
		for (const key of ['accent-low', 'accent', 'accent-high']) {
			assert.match(out, new RegExp(`--sl-color-${key}\`\\s*=\\s*\`${palette.dark[key]}\`.*in dark mode.*\`${palette.light[key]}\`.*in light mode`));
		}
		assert.doesNotMatch(out, /Gray tone/);
		// Never a bare hue/chroma number standing in for a computed check.
		assert.doesNotMatch(out, /Accent hue.*"200"/);
	});

	test('a gray-only change gets one Colors → Gray tone line (gray-1..6 both modes, gray-7 light-only) and no accent line', () => {
		const s = setValue(defaultState(), 'color.gray.hue', 40);
		const out = emitApplyTheme(s);
		const palette = computeGeneratedPalette(s);
		assert.match(out, /\*\*Colors → Gray tone\*\*/);
		assert.match(out, new RegExp(`--sl-color-gray-1\`\\s*=\\s*\`${palette.dark['gray-1']}\`.*\`${palette.light['gray-1']}\``));
		assert.match(out, new RegExp(`--sl-color-gray-7\`\\s*=\\s*\`${palette.light['gray-7']}\``));
		assert.doesNotMatch(out, /Accent color/);
	});

	test('both accent and gray changed produces both lines, in the Colors group', () => {
		let s = setValue(defaultState(), 'color.accent.hue', 200);
		s = setValue(s, 'color.gray.chroma', 0.05);
		const out = emitApplyTheme(s);
		assert.match(out, /Accent color/);
		assert.match(out, /Gray tone/);
	});

	test('a resolvable treatment control (Active item style: Left bar) names a real selector+property+value from its own CSS, never a bare option label', () => {
		const s = setValue(defaultState(), 'sidebar.activeStyle', 'left-bar');
		const out = emitApplyTheme(s);
		assert.match(
			out,
			/\*\*Sidebar → Active item style\*\* \(now "Left bar"\): on `\.sidebar-content a\[aria-current='page'\]`, the computed `border-left-width` should compute to `2px` \(`theme\.css` declares `border-inline-start: 2px solid var\(--sl-color-text-accent\)` for this selector\)/
		);
		// The bare label alone, unqualified, must never be the entire line.
		assert.doesNotMatch(out, /Active item style\*\*: "Left bar"\./);
		assert.doesNotMatch(out, /Active item style.*target value/);
	});

	test('an unresolvable treatment control (Content column alignment) still names a selector+property, not a bare label, even with no extractable value', () => {
		const s = setValue(defaultState(), 'layout.contentAlign', 'start');
		const out = emitApplyTheme(s);
		assert.match(
			out,
			/\*\*Layout → Content column alignment\*\* \(now "Hug the sidebar"\): on `\.main-pane \.sl-container`, the computed `margin-left` should differ from Starlight's own default/
		);
		assert.doesNotMatch(out, /Content column alignment\*\*: "Hug the sidebar"\.$/m);
	});
});

describe('emitApplyTheme: rollback / IA consistency', () => {
	test('a manual (non-autogenerate) IA never mentions frontmatter files in rollback or steps', () => {
		let s = defaultState();
		s = { ...s, ia: iaFromStarlightConfig([{ label: 'G', items: [{ slug: 'g/a', label: 'A' }] }]) };
		const out = emitApplyTheme(s);
		assert.doesNotMatch(out, /Frontmatter in/);
		assert.doesNotMatch(out, /autogenerate` groups/);
	});

	test('an autogenerate-only group (no pinned siblings) has nothing to enumerate: no frontmatter table', () => {
		let s = defaultState();
		s = { ...s, ia: iaFromStarlightConfig([{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] }]) };
		const out = emitApplyTheme(s);
		assert.doesNotMatch(out, /Frontmatter in/);
	});

	test('a mixed group (pinned slug link + autogenerate sibling covering it) requires sidebar.hidden: true, not order/label', () => {
		let s = defaultState();
		s = {
			...s,
			ia: iaFromStarlightConfig([
				{
					label: 'Reference',
					items: [{ slug: 'reference/pinned', label: 'Pinned' }, { autogenerate: { directory: 'reference' } }],
				},
			]),
		};
		const out = emitApplyTheme(s);
		assert.match(out, /Frontmatter in 1 content file/);
		assert.match(out, /\| `src\/content\/docs\/reference\/pinned\.md` \| true \|/);
		// order/label frontmatter is inert for an explicitly-listed slug link; must not be suggested.
		assert.doesNotMatch(out, /sidebar\.order/);
		assert.doesNotMatch(out, /\| file \| order \| label \| hidden \| badge \|/);
	});

	test('a pinned link OUTSIDE any autogenerate-covered directory produces no rows (nothing to reconcile)', () => {
		let s = defaultState();
		s = {
			...s,
			ia: iaFromStarlightConfig([
				{
					label: 'Mixed',
					items: [{ slug: 'elsewhere/page', label: 'Elsewhere' }, { autogenerate: { directory: 'reference' } }],
				},
			]),
		};
		const out = emitApplyTheme(s);
		assert.doesNotMatch(out, /Frontmatter in/);
	});
});

/** The "## Steps" section only, so numbering checks can't false-match Preconditions/Verification. */
function stepsSection(out) {
	return out.split('## Steps')[1].split(/\n## /)[0];
}

describe('emitApplyTheme: step numbering', () => {
	test('numbers steps by actual inclusion, not by a fixed slot (config step without a font step is step 2)', () => {
		let s = defaultState();
		s = setValue(s, 'page.pagination', false); // config-options step applies; fonts do not
		const steps = stepsSection(emitApplyTheme(s));
		assert.doesNotMatch(steps, /Install the chosen fonts/);
		assert.match(steps, /\n2\. \*\*Update Starlight config options\.\*\*/);
		assert.doesNotMatch(steps, /\n3\./);
	});

	test('IA step number accounts for whichever earlier steps were actually included', () => {
		let s = defaultState();
		s = { ...s, ia: iaFromStarlightConfig([{ label: 'G', items: [{ slug: 'g/a', label: 'A' }] }]) };
		// No font step, no config-options step -> css is 1, sidebar replacement is 2.
		const steps = stepsSection(emitApplyTheme(s));
		assert.match(steps, /\n2\. \*\*Replace the sidebar navigation\.\*\*/);
	});
});
