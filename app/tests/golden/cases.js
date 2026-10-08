/**
 * @file The golden-file cases, in one place. The `.md` cases cover `APPLY-THEME.md` and the agent
 * message. `tests/core/emit-css.test.js` and
 * `tests/core/emit-apply.test.js` compare emitter output with the files in this folder, and
 * `npm run golden:update` (`scripts/update-golden.mjs`) rewrites those files from this list after an
 * intended change to an emitter. `tests/core/golden-cases.test.js` checks that every file here has
 * exactly one case, so the update script can never skip a file the tests read.
 */
import { emitCss } from '../../src/customizer/core/emit-css.js';
import { emitApplyTheme } from '../../src/customizer/core/emit-apply.js';
import { defaultState, setValue, applyPreset } from '../../src/customizer/core/state.js';
import { iaFromStarlightConfig } from '../../src/customizer/core/ia.js';

/** Builds the "rich" fixture behind `apply-full.md`: web fonts, page options and an IA with autogenerate. */
export function buildRichState() {
	let s = defaultState();
	s = { ...s, preset: 'demo-rich' };
	s = setValue(s, 'color.accent.hue', 200);
	s = setValue(s, 'color.accent.chroma', 0.2);
	s = setValue(s, 'type.font.body', 'lora');
	s = setValue(s, 'type.font.heading', 'playfair-display');
	s = setValue(s, 'type.font.mono', 'fira-code');
	s = setValue(s, 'sidebar.activeStyle', 'left-bar');
	s = setValue(s, 'page.toc.minLevel', 1);
	s = setValue(s, 'page.pagination', false);
	s = setValue(s, 'page.lastUpdated', true);
	s = setValue(s, 'page.credits', true);
	s = setValue(s, 'page.headingLinks', false);
	s = setValue(s, 'code.theme', 'nord');
	s = {
		...s,
		ia: iaFromStarlightConfig([
			{
				label: 'Guides',
				items: [
					{ slug: 'guides/example', label: 'Example Guide' },
					{ autogenerate: { directory: 'guides' } },
				],
			},
			{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
		]),
	};
	return s;
}

/** @type {{ file: string, emit: () => string }[]} */
export const goldenCases = [
	{ file: 'default.css', emit: () => emitCss(defaultState()) },
	{ file: 'ocean.css', emit: () => emitCss(applyPreset(defaultState(), 'ocean')) },
	{ file: 'dense-technical.css', emit: () => emitCss(applyPreset(defaultState(), 'dense-technical')) },
	{ file: 'apply-default.md', emit: () => emitApplyTheme(defaultState()) },
	{ file: 'apply-full.md', emit: () => emitApplyTheme(buildRichState()) },
	// The agent message: the same steps as apply-full.md, with the stylesheet inside.
	{ file: 'agent-message-full.md', emit: () => emitApplyTheme(buildRichState(), { delivery: 'message', css: emitCss(buildRichState()) }) },
];
