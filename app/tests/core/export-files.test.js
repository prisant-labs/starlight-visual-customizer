import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

import { buildExportFiles, buildZip, slugifyThemeName } from '../../src/customizer/core/export-files.js';
import { emitApplyTheme, fenceFor } from '../../src/customizer/core/emit-apply.js';
import { emitCss } from '../../src/customizer/core/emit-css.js';
import { defaultState, setName } from '../../src/customizer/core/state.js';
import { buildRichState } from '../golden/cases.js';
import { TOOL_URL } from '../../src/customizer/core/project.js';

describe('slugifyThemeName', () => {
	test('lowercases and hyphenates a name', () => {
		assert.equal(slugifyThemeName('Acme Docs'), 'acme-docs');
		assert.equal(slugifyThemeName('  Ocean -- Breeze!  '), 'ocean-breeze');
	});

	test('falls back to starlight-theme when nothing usable is left', () => {
		assert.equal(slugifyThemeName(''), 'starlight-theme');
		assert.equal(slugifyThemeName('!!!'), 'starlight-theme');
		assert.equal(slugifyThemeName(undefined), 'starlight-theme');
	});
});

describe('buildExportFiles', () => {
	const files = buildExportFiles(setName(buildRichState(), 'Acme Docs'));

	test('names every file after the theme', () => {
		assert.equal(files.slug, 'acme-docs');
		assert.deepEqual(files.names, {
			zip: 'acme-docs.zip',
			css: 'theme.css',
			apply: 'APPLY-THEME.md',
			message: 'acme-docs.agent-message.md',
			settings: 'acme-docs.customizer.json',
		});
	});

	test('the default theme name gives untitled-theme file names', () => {
		const plain = buildExportFiles(defaultState());
		assert.equal(plain.names.zip, 'untitled-theme.zip');
		assert.equal(plain.names.settings, 'untitled-theme.customizer.json');
	});

	test('the stylesheet and the steps are the emitters\' own output', () => {
		const state = setName(buildRichState(), 'Acme Docs');
		assert.equal(files.css, emitCss(state));
		assert.equal(files.apply, emitApplyTheme(state));
	});

	test('the settings file is the state as indented JSON, and reads back to the same state', () => {
		const state = setName(buildRichState(), 'Acme Docs');
		assert.equal(files.settings, JSON.stringify(state, null, 2));
		assert.deepEqual(JSON.parse(files.settings), JSON.parse(JSON.stringify(state)));
	});

	test('the files are the same every time', () => {
		const again = buildExportFiles(setName(buildRichState(), 'Acme Docs'));
		assert.deepEqual(again, files);
	});
});

describe('the agent message', () => {
	const state = buildRichState();
	const css = emitCss(state);
	const message = emitApplyTheme(state, { delivery: 'message', css });

	test('opens by asking the agent to apply the theme from this one message', () => {
		assert.match(message, /^> \*\*Apply this Starlight theme to the project you have open\. Follow every step below in order\./);
		assert.doesNotMatch(message, /Use these steps with the `theme\.css` file/);
	});

	test('tells the agent to write the CSS from the message, not to copy a file', () => {
		assert.match(message, /Write the CSS from the "theme\.css" section at the end of this message, line for line, to `src\/styles\/theme\.css`/);
		assert.doesNotMatch(message, /exported alongside this document/);
	});

	test('holds the whole stylesheet in a fenced theme.css section, with a line count to check', () => {
		const body = css.trimEnd();
		const lines = body.split('\n').length;
		assert.ok(message.includes(`## theme.css\n\nWrite this to \`src/styles/theme.css\` with these exact lines and LF line endings. Then check it: the file has ${lines} lines`));
		assert.ok(message.includes(`\`\`\`css\n${body}\n\`\`\`\n`));
	});

	test('keeps every step of the files version', () => {
		const apply = emitApplyTheme(state);
		const steps = (text) => [...text.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map((m) => m[1]);
		assert.deepEqual(steps(message), steps(apply));
		assert.ok(steps(apply).length >= 2);
	});

	test('ends with the credit line, after the CSS section', () => {
		const lines = message.trimEnd().split('\n');
		assert.equal(lines.at(-1), `Made with the Starlight Visual Customizer: ${TOOL_URL}`);
		assert.ok(lines.findIndex((l) => l === '## theme.css') < lines.length - 1);
	});

	test('buildExportFiles uses the same message', () => {
		assert.equal(buildExportFiles(state).message, message);
	});
});

describe('fenceFor', () => {
	test('is three backticks when the text has none, or only short runs', () => {
		assert.equal(fenceFor('a { color: red; }'), '```');
		assert.equal(fenceFor('a `b` c ``d``'), '```');
	});

	test('is one longer than the longest run, so no run inside can close it', () => {
		assert.equal(fenceFor('x ``` y'), '````');
		assert.equal(fenceFor('/* ````` */'), '``````');
	});

	test('a stylesheet with a long backtick run still ends up inside the fence', () => {
		const css = '/* ````` */\n:root { --x: 1; }\n';
		const message = emitApplyTheme(defaultState(), { delivery: 'message', css });
		const fence = '``````';
		const start = message.indexOf(`${fence}css\n`);
		const end = message.indexOf(`\n${fence}\n`, start);
		assert.ok(start > 0 && end > start);
		assert.equal(message.slice(start + fence.length + 4, end), css.trimEnd());
	});
});

describe('buildZip', () => {
	test('holds only theme.css and APPLY-THEME.md, in a folder named after the theme, with the dialog\'s text', () => {
		const files = buildExportFiles(setName(buildRichState(), 'Acme Docs'));
		const entries = unzipSync(buildZip(files));
		assert.deepEqual(Object.keys(entries).sort(), ['acme-docs/APPLY-THEME.md', 'acme-docs/theme.css']);
		assert.equal(strFromU8(entries['acme-docs/theme.css']), files.css);
		assert.equal(strFromU8(entries['acme-docs/APPLY-THEME.md']), files.apply);
	});
});
