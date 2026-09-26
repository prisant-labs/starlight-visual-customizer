// @ts-check
/**
 * @file Generates APPLY-THEME.md: a deterministic, idempotent, model-agnostic set of
 * instructions an AI coding agent executes against the user's own Starlight repo to apply a
 * theme designed in this tool. Generated from the same `state` as `emit-css.js`'s `theme.css`,
 * so the two documents never drift apart. Pure, DOM-free, no filesystem access: every fact this
 * module states about "Starlight's defaults" comes from `state.js`/`manifest.js`, never from
 * reading `node_modules` at generation time (the *generated document* tells the executing agent
 * to check the installed version itself -- that check has to happen in the target repo, not
 * here).
 */

import { controls, FONTS, GROUPS } from './manifest.js';
import { TOKEN_VAR_NAMES } from './emit-css.js';
import { getValue, defaultState } from './state.js';
import { presets } from './presets.js';
import { iaToConfigSource, iaToFrontmatterTable, titleCase } from './ia.js';
import { STARLIGHT_VERSION as TARGET_STARLIGHT_VERSION } from './version.js';

/**
 * Best-effort Shiki bundled theme id pairs for the curated `code.theme` options. Verify these
 * still exist in the installed Shiki version; adjust if not (noted inline in the generated doc).
 * Neither Nord nor Dracula ship an official light counterpart in Shiki's bundled set, so both are
 * paired with `min-light` for the light mode half.
 */
const CODE_THEME_MAP = {
	github: { dark: 'github-dark', light: 'github-light' },
	catppuccin: { dark: 'catppuccin-mocha', light: 'catppuccin-latte' },
	dracula: { dark: 'dracula', light: 'min-light' },
	nord: { dark: 'nord', light: 'min-light' },
	min: { dark: 'min-dark', light: 'min-light' },
};

const FIXED_BUILD_IDS = new Set([
	'page.toc.minLevel',
	'page.toc.maxLevel',
	'page.pagination',
	'page.lastUpdated',
	'page.headingLinks',
	'page.credits',
	'code.theme',
	'code.wrap',
	'type.font.body',
	'type.font.heading',
	'type.font.mono',
	// SPEC-C E4: build-time, no visual/CSS effect of its own to list in `buildVerification`'s
	// generic changed-controls loop - `configOptionsLines` below adds its own dedicated `title:` line.
	'site.title',
]);

/** Escapes a value for a single-quoted JS string literal in the generated `astro.config` snippet. */
function jsStringLiteral(value) {
	return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function findControl(id) {
	const control = controls.find((c) => c.id === id);
	if (!control) throw new Error(`emit-apply: unknown control id "${id}"`);
	return control;
}

function changed(state, base, id) {
	return getValue(state, id) !== getValue(base, id);
}

function fontLabel(fontId) {
	if (fontId === 'system') return 'System (no web font)';
	const font = FONTS.find((f) => f.id === fontId);
	return font ? font.family : fontId;
}

/** @param {import('./manifest.js').Control} control @param {any} value */
function formatControlValue(control, value) {
	if (control.type === 'select' || control.type === 'font') {
		const opt = control.options?.find((o) => o.value === value);
		return opt ? opt.label : String(value);
	}
	if (control.type === 'toggle') return value ? 'on' : 'off';
	if (control.type === 'range') return `${value}${control.unit ?? ''}`;
	return String(value);
}

// ---------------------------------------------------------------------------
// header: theme summary
// ---------------------------------------------------------------------------

function presetLabelFor(presetId) {
	const preset = presets.find((p) => p.id === presetId);
	return preset ? preset.label : titleCase(presetId || 'starlight-default');
}

function summarizeTheme(state, base) {
	const presetLabel = presetLabelFor(state.preset);
	const notable = [];

	if (
		changed(state, base, 'color.accent.hue') ||
		changed(state, base, 'color.accent.chroma') ||
		changed(state, base, 'color.gray.hue') ||
		changed(state, base, 'color.gray.chroma')
	) {
		notable.push(
			`an accent color at OKLCH hue ${getValue(state, 'color.accent.hue')}° / chroma ${getValue(
				state,
				'color.accent.chroma'
			)}`
		);
	}

	const bodyFont = getValue(state, 'type.font.body');
	const headingFont = getValue(state, 'type.font.heading');
	const monoFont = getValue(state, 'type.font.mono');
	const fontNotes = [];
	if (bodyFont !== 'system') fontNotes.push(`body: ${fontLabel(bodyFont)}`);
	if (headingFont !== 'system' && headingFont !== bodyFont) fontNotes.push(`headings: ${fontLabel(headingFont)}`);
	if (monoFont !== 'system') fontNotes.push(`code: ${fontLabel(monoFont)}`);
	if (fontNotes.length) notable.push(`custom fonts (${fontNotes.join(', ')})`);

	const changedTreatments = controls.filter(
		(c) => !FIXED_BUILD_IDS.has(c.id) && (c.tier === 2 || c.tier === 1.5) && changed(state, base, c.id)
	);
	if (changedTreatments.length) {
		notable.push(
			`${changedTreatments.length} component treatment${changedTreatments.length === 1 ? '' : 's'} customized (${changedTreatments
				.map((c) => c.label)
				.join(', ')})`
		);
	}

	if (state.ia) notable.push('a restructured sidebar navigation');

	const siteTitle = getValue(state, 'site.title');
	if (siteTitle) notable.push(`a custom site title ("${siteTitle}")`);

	// A state can carry `preset: 'starlight-default'` (the base every custom theme starts from) yet
	// still have real, non-default control values -- a hand-tuned theme built by adjusting
	// individual controls rather than picking a named preset first. Calling that "the 'Starlight
	// default' theme with ..." is misleading (it reads as if the preset itself carries those
	// changes); "a custom theme built on Starlight's defaults" says the same thing without implying
	// a named preset exists for it. Only applies when there ARE changes -- literally no changes at
	// all is exactly what "Starlight default" means, so that phrasing stays for the truly-untouched
	// case just below.
	if (state.preset === 'starlight-default' && notable.length) {
		return `This applies a custom theme built on Starlight’s defaults, with ${notable.join(', ')}.`;
	}
	let summary = `This applies the "${presetLabel}" theme`;
	summary += notable.length ? ` with ${notable.join(', ')}.` : ' with no changes from Starlight’s own defaults.';
	return summary;
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

function buildCssStep(cssFileName) {
	const cssPath = `src/styles/${cssFileName}`;
	return [
		'1. **Add the theme CSS.**',
		`   - Copy the \`${cssFileName}\` file (exported alongside this document) to \`${cssPath}\` in the target repo, creating \`src/styles/\` if it does not exist.`,
		'   - Open `astro.config.mjs` (or `astro.config.ts`) and find the `starlight({ ... })` options object.',
		`   - If \`customCss\` does not exist yet, add \`customCss: ['./${cssPath}']\`.`,
		`   - If \`customCss\` already exists, **keep every entry already there** and add \`'./${cssPath}'\` **as the LAST item in the array** -- only if it is not already present (idempotent: do not add a duplicate entry on a re-run). This theme's CSS is intentionally unlayered, so for any selector another stylesheet also styles, array order decides the tie; adding it last is what makes it win.`,
	].join('\n');
}

/** @returns {{pkgs: string[]}|null} */
function fontStepData(state) {
	const ids = ['type.font.body', 'type.font.heading', 'type.font.mono'];
	const chosen = ids.map((id) => getValue(state, id)).filter((v) => v !== 'system');
	if (chosen.length === 0) return null;
	const pkgs = [...new Set(chosen.map((id) => FONTS.find((f) => f.id === id)?.pkg).filter(Boolean))];
	return { pkgs };
}

function renderFontStep(stepNumber, { pkgs }) {
	const imports = pkgs.map((pkg) => `@import '${pkg}';`);
	return [
		`${stepNumber}. **Install the chosen fonts.**`,
		`   - Run: \`npm i ${pkgs.join(' ')}\``,
		'   - The theme CSS already begins with these `@import` lines (added by the exporter, not by you) -- installing the packages is what makes them resolve:',
		'     ```css',
		...imports.map((l) => `     ${l}`),
		'     ```',
		'   - Nothing else to edit for fonts; re-running `npm i` on an already-installed package is a no-op.',
		'   - **If a package fails to install** (no network access, or it was renamed/removed on the registry), the site still works: an `@import` that fails to resolve is simply dropped by the browser, and every font-family declaration this theme emits already ends in a fallback stack (e.g. a system serif, sans, or monospace font). The page keeps rendering with that fallback instead of the chosen web font -- less distinctive, not broken. To retry, confirm the exact package name first with `npm view <pkg> version`.',
	].join('\n');
}

/** @returns {string[]|null} the config-option bullet lines, or null if none apply */
function configOptionsLines(state, base) {
	const lines = [];

	// SPEC-C E4: `site.title` default is '' ("keep your project's own title"), so a config line is
	// only added when it's genuinely been set to something.
	const siteTitle = getValue(state, 'site.title');
	if (siteTitle) {
		lines.push(`   - \`title: ${jsStringLiteral(siteTitle)}\``);
	}

	const tocMinChanged = changed(state, base, 'page.toc.minLevel');
	const tocMaxChanged = changed(state, base, 'page.toc.maxLevel');
	if (tocMinChanged || tocMaxChanged) {
		lines.push(
			`   - \`tableOfContents: { minHeadingLevel: ${getValue(state, 'page.toc.minLevel')}, maxHeadingLevel: ${getValue(
				state,
				'page.toc.maxLevel'
			)} }\``
		);
	}
	if (changed(state, base, 'page.pagination')) {
		lines.push(`   - \`pagination: ${getValue(state, 'page.pagination')}\``);
	}
	if (changed(state, base, 'page.lastUpdated')) {
		lines.push(`   - \`lastUpdated: ${getValue(state, 'page.lastUpdated')}\``);
	}
	if (changed(state, base, 'page.credits')) {
		lines.push(`   - \`credits: ${getValue(state, 'page.credits')}\``);
	}
	if (changed(state, base, 'page.headingLinks')) {
		lines.push(`   - \`markdown: { headingLinks: ${getValue(state, 'page.headingLinks')} }\``);
	}
	// `code.theme` and `code.wrap` are two different keys on the SAME `expressiveCode: { ... }`
	// options object in the target's astro.config.mjs -- merged into one line so a re-run never
	// produces two separate (and mutually clobbering) `expressiveCode` entries.
	const codeTheme = getValue(state, 'code.theme');
	const themeChanged = changed(state, base, 'code.theme');
	const wrapChanged = changed(state, base, 'code.wrap');
	if (themeChanged || wrapChanged) {
		const parts = [];
		let note = null;
		if (themeChanged) {
			const pair = CODE_THEME_MAP[codeTheme];
			if (pair) {
				parts.push(`themes: ['${pair.dark}', '${pair.light}']`, 'useStarlightUiThemeColors: true');
				note = `     (\`useStarlightUiThemeColors: true\` keeps the code block frame and UI chrome on your Starlight accent/gray palette instead of the Shiki theme's own chrome colors -- only the syntax highlighting comes from \`${codeTheme}\`. Verify \`${pair.dark}\`/\`${pair.light}\` are still valid bundled Shiki theme ids for the installed Expressive Code version; adjust if not.)`;
			}
		}
		if (wrapChanged) {
			parts.push(`defaultProps: { wrap: ${getValue(state, 'code.wrap')} }`);
		}
		if (parts.length) {
			lines.push(`   - \`expressiveCode: { ${parts.join(', ')} }\``);
			if (note) lines.push(note);
		}
	}

	return lines.length ? lines : null;
}

function renderConfigOptionsStep(stepNumber, lines) {
	return [
		`${stepNumber}. **Update Starlight config options.** In the same \`starlight({ ... })\` options object, set (each of these differs from Starlight’s default, so only the ones listed are added -- an already-correct key is left as-is, making this idempotent):`,
		...lines,
	].join('\n');
}

/** Directories covered by an `autogenerate` node anywhere in the tree (slashes trimmed, matching how Starlight's own schema normalizes `directory`). */
function collectAutogenerateDirs(items) {
	const dirs = [];
	(function walk(list) {
		for (const item of list) {
			if (item.type === 'autogenerate') dirs.push(item.directory.replace(/^\/+|\/+$/g, ''));
			else if (item.type === 'group') walk(item.items);
		}
	})(items);
	return dirs;
}

/**
 * A file needs `sidebar.hidden: true` in its frontmatter exactly when it is BOTH an explicit slug
 * link in the exported array AND lives inside a directory an `autogenerate` node also covers:
 * Starlight's autogenerate walks every non-hidden file under that directory (see
 * `dist/utils/navigation.js`'s `treeify`/`entriesFromAutogenerateConfig`), with no awareness that
 * the page is already pinned elsewhere in the array -- so without `hidden: true` it renders twice.
 * `order`/`label`/`badge` frontmatter is never consulted for an explicitly-listed slug link (only
 * for pages an autogenerate group discovers on its own), so those fields are never useful here and
 * are intentionally not surfaced.
 * @param {import('./ia.js').SidebarItem[]} items
 * @returns {{file: string}[]}
 */
function buildPinnedFrontmatterRows(items) {
	const dirs = collectAutogenerateDirs(items);
	if (!dirs.length) return [];
	return iaToFrontmatterTable(items)
		.filter((row) => {
			const slug = row.file.slice('src/content/docs/'.length, -'.md'.length);
			return dirs.some((dir) => slug === dir || slug.startsWith(`${dir}/`));
		})
		.map((row) => ({ file: row.file }));
}

/**
 * @param {import('./state.js').ThemeState} state
 * @param {number} stepNumber
 * @returns {{text: string, frontmatterFiles: string[]}|null}
 */
function buildIaStep(state, stepNumber) {
	if (!state.ia) return null;
	const source = iaToConfigSource(state.ia);
	const parts = [
		`${stepNumber}. **Replace the sidebar navigation.** In the same \`starlight({ ... })\` options object, replace the entire \`sidebar\` array with the one below (a full replacement each time keeps this idempotent -- applying it twice yields the same array):`,
		'   ```js',
		...source.split('\n').map((l) => `   ${l}`),
		'   ```',
	];
	const pinnedRows = buildPinnedFrontmatterRows(state.ia);
	if (pinnedRows.length) {
		parts.push(
			'',
			'   The following pages live inside a directory covered by an `autogenerate` group above but must not appear through it -- either because they are also pinned explicitly elsewhere in the array (their label/badge there already wins) or because they were marked hidden. Without `sidebar.hidden: true` in their frontmatter, autogenerate has no way to know that and will list them anyway (a pinned page would then render twice). Set the flag on each (idempotent: setting `hidden: true` twice is a no-op; merge it into any existing frontmatter without removing unrelated keys like `title`):',
			'',
			'   | file | sidebar.hidden |',
			'   | --- | --- |',
			...pinnedRows.map((r) => `   | \`${r.file}\` | true |`),
			'',
			'   (Note: if a listed file is `.mdx` rather than `.md`, or is a folder’s `index` page living at a different path, edit that actual file instead -- the path above assumes the common case.)'
		);
	}
	return { text: parts.join('\n'), frontmatterFiles: pinnedRows.map((r) => r.file) };
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

function buildVerification(state, base) {
	const lines = [
		'## Verification',
		'',
		'1. Run `npx astro build`. It must succeed (including the Pagefind index step). If `astro preview` is already running against this repo, just refresh the browser tab afterward -- no restart needed. `astro dev` picks up the change on its own; no rebuild required at all.',
		'2. Visual checks. These describe the target site itself, not this tool -- open any page that contains the listed element (most exist on nearly every content page; a few, such as the table of contents, pagination links, or the splash-page hero, only appear on pages that have one). For each line, find an element matching the given CSS selector and confirm it now matches the target value. The exact CSS property/value is whatever the exported `theme.css` sets for that same selector -- read it there, or in a browser console run `getComputedStyle(document.querySelector(SELECTOR))` to check a specific property without eyeballing it.',
	];
	const siteTitle = getValue(state, 'site.title');
	if (siteTitle) {
		lines.push(`   - **Header → Site title text** (\`.site-title\`): the header now reads "${siteTitle}".`);
	}
	const changedControls = controls.filter((c) => !FIXED_BUILD_IDS.has(c.id) && changed(state, base, c.id));
	if (changedControls.length === 0 && !siteTitle) {
		lines.push('   - No visual controls were changed from Starlight’s defaults; the site should look unchanged aside from the (empty) theme CSS being loaded without errors.');
	} else {
		for (const group of GROUPS) {
			const inGroup = changedControls.filter((c) => c.group === group);
			for (const c of inGroup) {
				const value = formatControlValue(c, getValue(state, c.id));
				const tokenVar = TOKEN_VAR_NAMES[c.id];
				// A token-backed control (a single named custom property) can be checked exactly with
				// `getComputedStyle` on the root element, with no need to guess which declaration in
				// `theme.css` corresponds to it - more precise than the general selector-based note above.
				const where = tokenVar
					? `custom property \`${tokenVar}\` on \`:root\``
					: `\`${c.target}\``;
				lines.push(`   - **${c.group} → ${c.label}** (${where}): target value "${value}".`);
			}
		}
	}
	if (state.ia) {
		lines.push('   - The sidebar navigation matches the new structure (labels, order, groups, badges).');
	}
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

/** Joins 1-3 phrases as natural English ("a", "a and b", "a, b, and c"). */
function joinEnglish(parts) {
	if (parts.length <= 1) return parts.join('');
	if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
	return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function buildRollback(cssFileName, fontStepIncluded, configStepIncluded, iaStepIncluded, frontmatterFiles) {
	const configFileParts = ['`customCss` entry'];
	if (configStepIncluded) configFileParts.push('config options');
	if (iaStepIncluded) configFileParts.push('`sidebar`');
	const lines = [
		'## Rollback',
		'',
		'Files touched by these steps (revert with `git checkout -- <file>` or `git diff` review):',
		'',
		`- \`src/styles/${cssFileName}\` (new file -- delete it)`,
		`- \`astro.config.mjs\` (or \`.ts\`): ${joinEnglish(configFileParts)}`,
	];
	if (fontStepIncluded) {
		lines.push('- `package.json` / `package-lock.json`: Fontsource packages added via `npm i` (run `npm uninstall <pkg>` for each to fully roll back)');
	}
	if (frontmatterFiles.length) {
		lines.push(
			`- Frontmatter in ${frontmatterFiles.length} content file${frontmatterFiles.length === 1 ? '' : 's'} under \`src/content/docs/\` (listed in the sidebar step above)`
		);
	}
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * @param {import('./state.js').ThemeState} state
 * @param {{cssFileName?: string}} [options]
 * @returns {string} the full APPLY-THEME.md content
 */
export function emitApplyTheme(state, { cssFileName = 'theme.css' } = {}) {
	const base = defaultState();

	const sections = [];

	sections.push(
		[
			'> **Paste this whole file to your coding agent inside the target Starlight repo, then let it execute every step below in order.**',
			'',
			'# Apply theme',
			'',
			`Target: \`@astrojs/starlight@${TARGET_STARLIGHT_VERSION}\` (this document was generated against that version's config and sidebar schema).`,
			'',
			`**STOP** if the installed \`@astrojs/starlight\` minor version differs from \`${TARGET_STARLIGHT_VERSION.split('.').slice(0, 2).join('.')}\` (check \`node_modules/@astrojs/starlight/package.json\`'s \`"version"\` field). Ask the user how to proceed rather than applying config/CSS shaped for a different minor version.`,
			'',
			summarizeTheme(state, base),
		].join('\n')
	);

	sections.push(
		[
			'## Preconditions',
			'',
			'1. Confirm `@astrojs/starlight` is a dependency (check `package.json` / `node_modules/@astrojs/starlight`). If it is missing, stop -- this is not a Starlight project.',
			'2. Locate the Starlight config file: `astro.config.mjs` or `astro.config.ts` at the project root, containing a `starlight({ ... })` call inside `integrations: [...]`.',
			'3. Note whether a `customCss` array already exists on the `starlight({ ... })` options object (read it now; the CSS step below needs to know).',
		].join('\n')
	);

	// Each step is numbered sequentially by actual inclusion, not by a fixed slot -- a state with
	// no font changes but a config-option change must see that as step 2, not step 3.
	let stepNumber = 1;
	const orderedSteps = [buildCssStep(cssFileName)];

	const fontData = fontStepData(state);
	if (fontData) orderedSteps.push(renderFontStep(++stepNumber, fontData));

	const configLines = configOptionsLines(state, base);
	if (configLines) orderedSteps.push(renderConfigOptionsStep(++stepNumber, configLines));

	const iaStep = buildIaStep(state, stepNumber + 1);
	if (iaStep) {
		stepNumber++;
		orderedSteps.push(iaStep.text);
	}

	sections.push(['## Steps', '', orderedSteps.join('\n\n')].join('\n'));

	sections.push(buildVerification(state, base));
	sections.push(
		buildRollback(cssFileName, !!fontData, !!configLines, !!iaStep, iaStep ? iaStep.frontmatterFiles : [])
	);

	return sections.join('\n\n') + '\n';
}
