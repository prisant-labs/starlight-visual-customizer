// @ts-check
/**
 * @file Every file the Export dialog offers, built from one theme state, with the names it saves
 * them under. The site gets `theme.css` and `APPLY-THEME.md` (alone, or together in a zip), or the
 * agent message, which holds both in one text. The customizer gets its settings file, which is not
 * in the zip, because the site never uses it. DOM-free, like every module in `core/`, so the unit
 * tests can build and unzip each file in Node.
 */

import { zipSync, strToU8 } from 'fflate';
import { emitCss } from './emit-css.js';
import { emitApplyTheme } from './emit-apply.js';
import { getName } from './state.js';

/**
 * A lowercase, hyphenated slug of the theme name, for file names. An empty or unusable name falls
 * back to `starlight-theme`.
 * @param {string} name
 * @returns {string}
 */
export function slugifyThemeName(name) {
	const s = String(name ?? '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return s || 'starlight-theme';
}

/**
 * @typedef {object} ExportFiles
 * @property {string} slug The theme name as a slug, such as `acme-docs`.
 * @property {string} css `theme.css`.
 * @property {string} apply `APPLY-THEME.md`, worded to sit beside `theme.css`.
 * @property {string} message The agent message: the same steps, with the CSS inside.
 * @property {string} settings The customizer settings, as JSON.
 * @property {{zip: string, css: string, apply: string, message: string, settings: string}} names
 *   The name each file downloads under. The zip holds `css` and `apply` in a folder named `slug`.
 */

/**
 * @param {import('./state.js').ThemeState} state
 * @returns {ExportFiles}
 */
export function buildExportFiles(state) {
	const slug = slugifyThemeName(getName(state));
	const css = emitCss(state);
	return {
		slug,
		css,
		apply: emitApplyTheme(state),
		message: emitApplyTheme(state, { delivery: 'message', css }),
		settings: JSON.stringify(state, null, 2),
		names: {
			zip: `${slug}.zip`,
			css: 'theme.css',
			apply: 'APPLY-THEME.md',
			message: `${slug}.agent-message.md`,
			settings: `${slug}.customizer.json`,
		},
	};
}

/**
 * The zip for the site: `theme.css` and `APPLY-THEME.md` in one folder, exactly as the dialog shows
 * them. The settings file stays out, because the site never uses it.
 * @param {ExportFiles} files
 * @returns {Uint8Array}
 */
export function buildZip(files) {
	return zipSync({
		[`${files.slug}/${files.names.css}`]: strToU8(files.css),
		[`${files.slug}/${files.names.apply}`]: strToU8(files.apply),
	});
}
