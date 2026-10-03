// @ts-check
/**
 * Sidebar IA (information architecture) module. Pure, DOM-free, plain ESM.
 *
 * Converts between three representations:
 *  1. Starlight's own `sidebar` config shape (plain objects matching
 *     `node_modules/@astrojs/starlight/dist/schemas/sidebar.d.ts`).
 *  2. Our own `SidebarItem` tree (see typedef below) that the IA editor UI
 *     mutates (add/remove/rename/move/indent/collapse/badge/hide).
 *  3. Pasted, "messy" text (JS-object-ish source, or an `ls -R` / `tree` /
 *     plain-newline file listing).
 *
 * ## SidebarItem shape
 * @typedef {{text: string, variant: 'note'|'tip'|'caution'|'danger'|'success'|'default', class?: string}} Badge
 * @typedef {{
 *   type: 'link',
 *   id: string,
 *   label: string,
 *   slug?: string,
 *   href?: string,
 *   badge?: Badge,
 *   hidden?: boolean,
 *   attrs?: Record<string, any>,
 *   translations?: Record<string, string>,
 * }} SidebarLink
 * @typedef {{
 *   type: 'group',
 *   id: string,
 *   label: string,
 *   collapsed?: boolean,
 *   badge?: Badge,
 *   items: SidebarItem[],
 *   translations?: Record<string, string>,
 * }} SidebarGroup
 * @typedef {{
 *   type: 'autogenerate',
 *   id: string,
 *   label?: string,
 *   directory: string,
 *   collapsed?: boolean,
 *   attrs?: Record<string, any>,
 * }} SidebarAutogenerate
 * @typedef {SidebarLink | SidebarGroup | SidebarAutogenerate} SidebarItem
 *
 * `attrs` and `translations` are extensions beyond Starlight's own sidebar-config typedef, carried
 * through so a real config's HTML attributes / i18n label overrides are never
 * silently dropped on a config -> items -> config round trip. They are never
 * synthesized; they only appear when the source config had them.
 *
 * ## Round-trip normalization (config -> items -> config is NOT always
 * byte-identical; these are the documented, deliberate normalizations):
 *  - `collapsed: false` (the schema default) is omitted from output, whether
 *    or not the input specified it explicitly.
 *  - A badge given as `{text, variant:'default'}` with no `class` is
 *    re-emitted as the plain string shorthand `text` (Starlight accepts
 *    both; this is the natural round trip for the common case: a plain
 *    string badge always round-trips exactly).
 *  - i18n badge text (`Record<string,string>`) is not supported; parsing
 *    throws a readable error.
 *  - `hidden` is an IA-editor-only concept with no equivalent in a manual
 *    Starlight sidebar array entry. `iaFromStarlightConfig` /
 *    `parseSidebarSource` never set it (so it never appears from a real
 *    parse). `iaToStarlightConfig` omits any link with `hidden: true`
 *    entirely, since omission is the only way to "hide" a manual entry.
 *  - A slug-based link's `label` is omitted from output when it equals
 *    `titleCase(lastSlugSegment)` (the same formula used to synthesize a
 *    label when the input omitted one), since that is indistinguishable
 *    from "no label was given". An href-based link's `label` is always
 *    emitted (Starlight requires it; there is no fallback).
 *  - A bare `{autogenerate: {...}}` config entry never carries a `label`
 *    (enforced by Starlight's schema), so parsed autogenerate items always
 *    have `label: undefined`. If the IA editor later sets a `label` on an
 *    autogenerate item directly (not possible from a real parse), output
 *    wraps it as `{label, items: [{autogenerate: {...}}]}` so the exported
 *    config stays valid for Starlight 0.42.4 (re-verified for the upgrade: Starlight 0.42.4's
 *    changelog touches only sidebar *rendering* (`SidebarSublist.astro`) and FileTree icons,
 *    neither of which is the sidebar config schema this module parses/emits).
 */

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

const DOC_EXT_RE = /\.(mdx?|mdoc)$/i;

/** Strip a leading `\d+[-._]` ordering prefix some doc trees use (`01-intro` -> `intro`). */
function stripOrderPrefix(name) {
	return name.replace(/^\d+[-._]+/, '');
}

/** URL schemes a sidebar link may use. Others, such as `javascript:` or `data:`, can run script. */
const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

/** Line breaks, other control characters, and the Unicode line and paragraph separators. */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * `value` as one line of plain text at most `maxLength` characters long: every control character,
 * line break included, becomes a space. Text from a theme ends up in `APPLY-THEME.md`, where a line
 * break could start a new Markdown step for a coding agent to follow.
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
export function toSingleLine(value, maxLength) {
	return String(value).replace(CONTROL_CHARS_RE, ' ').slice(0, maxLength);
}

/**
 * `safeLinkHref` for text that is also flattened to one line. The scheme is checked on the
 * original text and again on the flattened text: flattening turns a hidden character such as
 * U+0085 into a space, and a browser skips a leading space, so ` javascript:` would run.
 * @param {string} href
 * @returns {string}
 */
export function safeSingleLineHref(href) {
	return safeLinkHref(href) === '#' ? '#' : safeLinkHref(toSingleLine(href, 2000));
}

/** One path segment of a docs slug or directory: letters, digits, marks, `.`, `_` and `-`. */
const DOC_PATH_SEGMENT_RE = /^[\p{L}\p{N}\p{M}._-]+$/u;

/** An HTML attribute name, as Starlight's `attrs` puts it on the link element. */
const ATTR_NAME_RE = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

/**
 * Returns `href` unchanged when it is relative, root-relative or a fragment, or uses http, https
 * or mailto, and `'#'` for any other scheme. Browsers skip leading control characters and spaces
 * and drop tabs and newlines inside a URL, so the scheme is read the same way.
 *
 * Sidebar structure can arrive in someone else's share link, and a share link with nothing saved
 * to protect applies at once. Every place that turns an IA link into a real link goes through
 * this: the preview's sidebar (`ui/sidebar-render.js`) and the exported Starlight config.
 * @param {unknown} href
 * @returns {string}
 */
export function safeLinkHref(href) {
	const raw = String(href ?? '');
	const compact = raw.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '');
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
	if (scheme && !SAFE_LINK_SCHEMES.has(scheme[1].toLowerCase())) return '#';
	return raw;
}

/**
 * True when `path` is safe to use as a docs path: a slug, or an `autogenerate` directory.
 * `APPLY-THEME.md` turns a slug into a file path that a coding agent edits
 * (`src/content/docs/<slug>.md`) inside a Markdown code span, and sidebar structure can arrive in
 * someone else's share link. So the path must stay relative and inside the docs folder, and it
 * may hold only what a slug is made of: every segment is letters, digits, marks, `.`, `_` or `-`
 * (`DOC_PATH_SEGMENT_RE`), and none is `.` or `..`. An allowlist, not a denylist, so nothing such
 * as `$(...)` reaches a path an agent may put in a shell command. Empty is allowed; Starlight uses
 * it for a site's root page.
 * @param {unknown} path
 * @returns {boolean}
 */
export function isSafeDocPath(path) {
	if (typeof path !== 'string' || path.length > 200) return false;
	if (path === '') return true;
	return path.split('/').every((segment) => DOC_PATH_SEGMENT_RE.test(segment) && segment !== '.' && segment !== '..');
}

/**
 * A link's `attrs` as the exported config may carry them: no event-handler (`on...`) attributes,
 * and URL-valued attributes passed through `safeLinkHref`. Starlight puts `attrs` on the link
 * element, so an unfiltered `onclick` from a shared theme would run in the site that applies it.
 * @param {unknown} attrs
 * @returns {Record<string, any>}
 */
export function safeLinkAttrs(attrs) {
	/** @type {Record<string, any>} */
	const out = {};
	if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return out;
	for (const [key, value] of Object.entries(attrs)) {
		// `__proto__` from parsed JSON is an own key; assigning it would swap `out`'s prototype.
		if (!ATTR_NAME_RE.test(key) || key.length > 100 || /^on/i.test(key) || key === '__proto__') continue;
		// Starlight's schema takes a string, number or boolean per attribute. Anything else, such as
		// a nested object, is dropped, and text becomes one line: the config source lands inside a
		// code fence in APPLY-THEME.md, where a line break could close the fence.
		if (typeof value === 'string') {
			out[key] = /^(href|src|ping|action|formaction|xlink:href)$/i.test(key) ? safeSingleLineHref(value) : toSingleLine(value, 2000);
		} else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
			out[key] = value;
		}
	}
	return out;
}

/** kebab-case / snake_case filename -> Title Case label. Exported for reuse/testing. */
export function titleCase(name) {
	const stripped = stripOrderPrefix(String(name ?? ''));
	const words = stripped.split(/[-_\s]+/).filter(Boolean);
	if (words.length === 0) return stripped;
	return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function lastSlugSegment(slug) {
	const parts = String(slug ?? '').split('/').filter(Boolean);
	return parts.length ? parts[parts.length - 1] : '';
}

function slugify(label) {
	return String(label ?? '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'item';
}

/** Stable-id factory: deterministic path-based ids, deduped with a numeric suffix. */
function makeIdFactory() {
	const used = new Set();
	return function next(base) {
		let id = base;
		let n = 2;
		while (used.has(id)) {
			id = `${base}-${n++}`;
		}
		used.add(id);
		return id;
	};
}

/**
 * @param {string|{text:string, variant?:string, class?:string}|Record<string,string>|undefined} raw
 * @returns {Badge|undefined}
 */
function normalizeBadge(raw) {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw === 'string') return { text: raw, variant: 'default' };
	if (typeof raw === 'object') {
		const text = raw.text;
		if (typeof text !== 'string') {
			throw new Error(
				'Unsupported badge: i18n badge text maps (Record<locale,string>) are not supported, only a string or {text, variant, class?}.'
			);
		}
		const variant = raw.variant ?? 'default';
		/** @type {Badge} */
		const badge = { text, variant };
		if (raw.class !== undefined) badge.class = raw.class;
		return badge;
	}
	throw new Error(`Unsupported badge value: ${JSON.stringify(raw)}`);
}

/** Inverse of normalizeBadge for config output: prefers the plain-string shorthand. */
function badgeToRaw(badge) {
	if (!badge) return undefined;
	if (badge.variant === 'default' && badge.class === undefined) return badge.text;
	const raw = { text: badge.text, variant: badge.variant };
	if (badge.class !== undefined) raw.class = badge.class;
	return raw;
}

// ---------------------------------------------------------------------------
// config (plain objects) -> SidebarItem[]
// ---------------------------------------------------------------------------

/**
 * @param {any} raw one entry of a Starlight `sidebar` array
 * @param {string} parentPath dotted path used to build stable group/autogenerate ids
 * @param {(base:string)=>string} idFactory
 * @returns {SidebarItem}
 */
function itemFromRaw(raw, parentPath, idFactory) {
	if (typeof raw === 'string') {
		// InternalSidebarLinkItemShorthandUserConfig: a bare string is a slug.
		return itemFromRaw({ slug: raw }, parentPath, idFactory);
	}
	if (!raw || typeof raw !== 'object') {
		throw new Error(`Unrecognized sidebar item: ${JSON.stringify(raw)}`);
	}
	if ('autogenerate' in raw && raw.autogenerate) {
		const auto = raw.autogenerate;
		if (!auto || typeof auto.directory !== 'string') {
			throw new Error('Sidebar autogenerate entry is missing a string "directory".');
		}
		/** @type {SidebarAutogenerate} */
		const item = {
			type: 'autogenerate',
			id: idFactory(`auto:${parentPath ? parentPath + '/' : ''}${auto.directory}`),
			directory: auto.directory,
		};
		if (raw.label !== undefined) item.label = raw.label; // never true from a real Starlight config
		if (auto.collapsed !== undefined) item.collapsed = !!auto.collapsed;
		if (auto.attrs && Object.keys(auto.attrs).length) item.attrs = auto.attrs;
		return item;
	}
	if ('items' in raw) {
		if (typeof raw.label !== 'string') {
			throw new Error('Sidebar group is missing a string "label".');
		}
		if (!Array.isArray(raw.items)) {
			throw new Error(`Sidebar group "${raw.label}" is missing an "items" array.`);
		}
		const path = `${parentPath ? parentPath + '/' : ''}${slugify(raw.label)}`;
		/** @type {SidebarGroup} */
		const item = {
			type: 'group',
			id: idFactory(`group:${path}`),
			label: raw.label,
			items: raw.items.map((child) => itemFromRaw(child, path, idFactory)),
		};
		if (raw.collapsed) item.collapsed = true;
		const badge = normalizeBadge(raw.badge);
		if (badge) item.badge = badge;
		if (raw.translations && Object.keys(raw.translations).length) item.translations = raw.translations;
		return item;
	}
	if ('link' in raw) {
		if (typeof raw.link !== 'string') throw new Error('Sidebar link item is missing a string "link".');
		if (typeof raw.label !== 'string') throw new Error(`Sidebar link "${raw.link}" is missing a required "label".`);
		/** @type {SidebarLink} */
		const item = {
			type: 'link',
			id: idFactory(`link:${raw.link}`),
			label: raw.label,
			href: raw.link,
		};
		const badge = normalizeBadge(raw.badge);
		if (badge) item.badge = badge;
		if (raw.attrs && Object.keys(raw.attrs).length) item.attrs = raw.attrs;
		if (raw.translations && Object.keys(raw.translations).length) item.translations = raw.translations;
		return item;
	}
	if ('slug' in raw) {
		if (typeof raw.slug !== 'string') throw new Error('Sidebar link item is missing a string "slug".');
		const label = typeof raw.label === 'string' ? raw.label : titleCase(lastSlugSegment(raw.slug) || raw.slug);
		/** @type {SidebarLink} */
		const item = {
			type: 'link',
			id: idFactory(`link:${raw.slug}`),
			label,
			slug: raw.slug,
		};
		const badge = normalizeBadge(raw.badge);
		if (badge) item.badge = badge;
		if (raw.attrs && Object.keys(raw.attrs).length) item.attrs = raw.attrs;
		if (raw.translations && Object.keys(raw.translations).length) item.translations = raw.translations;
		return item;
	}
	throw new Error(`Unrecognized sidebar item shape: ${JSON.stringify(raw)}`);
}

/**
 * Accepts the astro.config `sidebar` array (already-real JS objects, e.g.
 * imported from a config module) and returns the SidebarItem tree.
 * @param {any[]} sidebarArray
 * @returns {SidebarItem[]}
 */
export function iaFromStarlightConfig(sidebarArray) {
	if (!Array.isArray(sidebarArray)) {
		throw new Error('iaFromStarlightConfig expects an array.');
	}
	const idFactory = makeIdFactory();
	return sidebarArray.map((raw) => itemFromRaw(raw, '', idFactory));
}

// ---------------------------------------------------------------------------
// SidebarItem[] -> config (plain objects)
// ---------------------------------------------------------------------------

/** @param {SidebarItem} item @returns {any|null} null means "omit this item" */
function itemToRaw(item) {
	if (item.type === 'link') {
		if (item.hidden) return null;
		const raw = {};
		if (item.slug !== undefined) {
			raw.slug = item.slug;
			const derived = titleCase(lastSlugSegment(item.slug) || item.slug);
			if (item.label !== derived) raw.label = item.label;
		} else {
			raw.link = safeLinkHref(item.href);
			raw.label = item.label; // required for href-based links, no fallback
		}
		const badge = badgeToRaw(item.badge);
		if (badge !== undefined) raw.badge = badge;
		const attrs = safeLinkAttrs(item.attrs);
		if (Object.keys(attrs).length) raw.attrs = attrs;
		if (item.translations && Object.keys(item.translations).length) raw.translations = item.translations;
		return raw;
	}
	if (item.type === 'group') {
		const raw = { label: item.label };
		if (item.collapsed) raw.collapsed = true;
		const badge = badgeToRaw(item.badge);
		if (badge !== undefined) raw.badge = badge;
		if (item.translations && Object.keys(item.translations).length) raw.translations = item.translations;
		raw.items = item.items.map(itemToRaw).filter((x) => x !== null);
		return raw;
	}
	if (item.type === 'autogenerate') {
		const auto = { directory: item.directory };
		if (item.collapsed) auto.collapsed = true;
		const attrs = safeLinkAttrs(item.attrs);
		if (Object.keys(attrs).length) auto.attrs = attrs;
		const bare = { autogenerate: auto };
		if (item.label) {
			// Not producible by a real Starlight config (label must be undefined
			// there); wrap so the export stays schema-valid.
			return { label: item.label, items: [bare] };
		}
		return bare;
	}
	throw new Error(`Unrecognized SidebarItem type: ${JSON.stringify(item)}`);
}

/**
 * @param {SidebarItem[]} items
 * @returns {object[]} plain objects matching Starlight's sidebar config schema
 */
export function iaToStarlightConfig(items) {
	if (!Array.isArray(items)) throw new Error('iaToStarlightConfig expects an array.');
	return items.map(itemToRaw).filter((x) => x !== null);
}

// ---------------------------------------------------------------------------
// pretty-printer: SidebarItem[] -> JS source text
// ---------------------------------------------------------------------------

function isSafeIdentifier(key) {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

/**
 * A single-quoted JS string literal. The sidebar source sits inside a code fence in
 * APPLY-THEME.md, so line breaks and backticks are escaped as well: a raw line break could close
 * the fence, and JS reads `\x60` as a backtick.
 */
function formatStringLiteral(s) {
	const escaped = String(s)
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029')
		.replace(/`/g, '\\x60');
	return `'${escaped}'`;
}

function formatJsValue(value, indent) {
	const pad = '  '.repeat(indent);
	const padIn = '  '.repeat(indent + 1);
	if (value === undefined) return 'undefined';
	if (value === null) return 'null';
	if (typeof value === 'boolean' || typeof value === 'number') return String(value);
	if (typeof value === 'string') return formatStringLiteral(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		const lines = value.map((v) => padIn + formatJsValue(v, indent + 1));
		return `[\n${lines.join(',\n')},\n${pad}]`;
	}
	if (typeof value === 'object') {
		const keys = Object.keys(value).filter((k) => value[k] !== undefined);
		if (keys.length === 0) return '{}';
		const lines = keys.map((k) => {
			const keyText = isSafeIdentifier(k) ? k : formatStringLiteral(k);
			return `${padIn}${keyText}: ${formatJsValue(value[k], indent + 1)}`;
		});
		return `{\n${lines.join(',\n')},\n${pad}}`;
	}
	return JSON.stringify(value);
}

/**
 * Pretty JS source for the `sidebar:` array (just the array literal; the
 * caller supplies the `sidebar: ` key and any wrapping config source).
 * @param {SidebarItem[]} items
 * @returns {string}
 */
export function iaToConfigSource(items) {
	return formatJsValue(iaToStarlightConfig(items), 0);
}

// ---------------------------------------------------------------------------
// tolerant tokenizer / parser for pasted sidebar source
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {{type:string, value:any, line:number, col:number}[]}
 */
function tokenize(text) {
	const tokens = [];
	let i = 0;
	let line = 1;
	let col = 1;
	const n = text.length;

	function advance(count = 1) {
		for (let k = 0; k < count; k++) {
			if (text[i] === '\n') {
				line++;
				col = 1;
			} else {
				col++;
			}
			i++;
		}
	}

	while (i < n) {
		const ch = text[i];

		// whitespace
		if (/\s/.test(ch)) {
			advance();
			continue;
		}
		// line comment
		if (ch === '/' && text[i + 1] === '/') {
			while (i < n && text[i] !== '\n') advance();
			continue;
		}
		// block comment
		if (ch === '/' && text[i + 1] === '*') {
			advance(2);
			while (i < n && !(text[i] === '*' && text[i + 1] === '/')) advance();
			advance(2);
			continue;
		}
		// strings
		if (ch === '"' || ch === "'" || ch === '`') {
			const quote = ch;
			const startLine = line;
			const startCol = col;
			advance();
			let value = '';
			while (i < n && text[i] !== quote) {
				if (text[i] === '\\') {
					const next = text[i + 1];
					const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`' };
					value += next in map ? map[next] : next;
					advance(2);
				} else if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
					throw new SyntaxError(
						`Unsupported expression: template-literal interpolation at line ${line}:${col}`
					);
				} else {
					value += text[i];
					advance();
				}
			}
			if (i >= n) throw new SyntaxError(`Unterminated string starting at line ${startLine}:${startCol}`);
			advance(); // closing quote
			tokens.push({ type: 'string', value, line: startLine, col: startCol });
			continue;
		}
		// punctuation
		if ('{}[]:,()'.includes(ch)) {
			tokens.push({ type: 'punct', value: ch, line, col });
			advance();
			continue;
		}
		// number
		if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(text[i + 1] ?? ''))) {
			const startLine = line;
			const startCol = col;
			let j = i + 1;
			while (j < n && /[0-9.]/.test(text[j])) j++;
			const raw = text.slice(i, j);
			advance(j - i);
			tokens.push({ type: 'number', value: Number(raw), line: startLine, col: startCol });
			continue;
		}
		// identifier / keyword
		if (/[A-Za-z_$]/.test(ch)) {
			const startLine = line;
			const startCol = col;
			let j = i + 1;
			while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
			const name = text.slice(i, j);
			advance(j - i);
			tokens.push({ type: 'ident', value: name, line: startLine, col: startCol });
			continue;
		}
		// Anything else (arbitrary surrounding JS: `;`, `.`, `=>`, `+`, ...) is
		// accepted as an inert punctuation token rather than a hard failure, so
		// pasting a whole astro.config.mjs / starlight({...}) call around the
		// sidebar array doesn't blow up tokenizing code we never need to
		// understand. Only tokens that actually end up inside the parsed
		// sidebar value can still produce a parse error.
		tokens.push({ type: 'punct', value: ch, line, col });
		advance();
	}
	return tokens;
}

class TokenParser {
	constructor(tokens) {
		this.tokens = tokens;
		this.pos = 0;
	}
	peek() {
		return this.tokens[this.pos];
	}
	next() {
		return this.tokens[this.pos++];
	}
	expectPunct(ch) {
		const t = this.next();
		if (!t || t.type !== 'punct' || t.value !== ch) {
			throw new SyntaxError(
				`Expected "${ch}" but found ${t ? JSON.stringify(t.value) : 'end of input'} at ${
					t ? `line ${t.line}:${t.col}` : 'end of input'
				}`
			);
		}
		return t;
	}
	parseValue() {
		const t = this.peek();
		if (!t) throw new SyntaxError('Unexpected end of input while parsing a value.');
		if (t.type === 'punct' && t.value === '{') return this.parseObject();
		if (t.type === 'punct' && t.value === '[') return this.parseArray();
		if (t.type === 'string' || t.type === 'number') {
			this.next();
			return t.value;
		}
		if (t.type === 'ident') {
			if (t.value === 'true') {
				this.next();
				return true;
			}
			if (t.value === 'false') {
				this.next();
				return false;
			}
			if (t.value === 'null') {
				this.next();
				return null;
			}
			if (t.value === 'undefined') {
				this.next();
				return undefined;
			}
			throw new SyntaxError(`Unsupported expression "${t.value}" at line ${t.line}:${t.col} (only literal values are supported, not variables or function calls).`);
		}
		throw new SyntaxError(`Unexpected token "${t.value}" at line ${t.line}:${t.col}`);
	}
	parseArray() {
		this.expectPunct('[');
		const arr = [];
		while (true) {
			const t = this.peek();
			if (!t) throw new SyntaxError('Unterminated array (missing "]").');
			if (t.type === 'punct' && t.value === ']') {
				this.next();
				break;
			}
			arr.push(this.parseValue());
			const sep = this.peek();
			if (sep && sep.type === 'punct' && sep.value === ',') {
				this.next();
				continue;
			}
			this.expectPunct(']');
			break;
		}
		return arr;
	}
	parseObject() {
		this.expectPunct('{');
		const obj = {};
		while (true) {
			const t = this.peek();
			if (!t) throw new SyntaxError('Unterminated object (missing "}").');
			if (t.type === 'punct' && t.value === '}') {
				this.next();
				break;
			}
			if (t.type !== 'string' && t.type !== 'ident') {
				throw new SyntaxError(`Expected an object key at line ${t.line}:${t.col}, found "${t.value}".`);
			}
			const key = t.value;
			this.next();
			this.expectPunct(':');
			const value = this.parseValue();
			obj[key] = value;
			const sep = this.peek();
			if (sep && sep.type === 'punct' && sep.value === ',') {
				this.next();
				continue;
			}
			this.expectPunct('}');
			break;
		}
		return obj;
	}
}

/**
 * Accepts pasted JS/JSON-ish text of the sidebar array: a full
 * `sidebar: [ ... ]` snippet (optionally nested inside a larger config
 * object) or just the bare `[ ... ]` array. Tolerates unquoted keys, single
 * quotes, trailing commas, and `//` / `/* *\/` comments. Never uses
 * `eval`/`Function`.
 * @param {string} text
 * @returns {SidebarItem[]}
 */
export function parseSidebarSource(text) {
	if (typeof text !== 'string' || !text.trim()) {
		throw new Error('parseSidebarSource: no text provided.');
	}
	let tokens;
	try {
		tokens = tokenize(text);
	} catch (err) {
		throw new Error(`Could not parse sidebar source: ${err.message}`);
	}

	// Find `sidebar` `:` anywhere in the stream (tolerates being nested inside
	// a full astro.config.mjs / starlight({...}) call), else fall back to the
	// first top-level array literal.
	let valueTokens = null;
	for (let i = 0; i < tokens.length - 1; i++) {
		const t = tokens[i];
		if ((t.type === 'ident' || t.type === 'string') && t.value === 'sidebar') {
			const colon = tokens[i + 1];
			if (colon && colon.type === 'punct' && colon.value === ':') {
				valueTokens = tokens.slice(i + 2);
				break;
			}
		}
	}
	if (!valueTokens) {
		const idx = tokens.findIndex((t) => t.type === 'punct' && t.value === '[');
		if (idx === -1) {
			throw new Error(
				'Could not find a sidebar array in the pasted text (expected `sidebar: [...]` or a bare `[...]`).'
			);
		}
		valueTokens = tokens.slice(idx);
	}

	const parser = new TokenParser(valueTokens);
	let rawArray;
	try {
		rawArray = parser.parseValue();
	} catch (err) {
		throw new Error(`Could not parse sidebar source: ${err.message}`);
	}
	if (!Array.isArray(rawArray)) {
		throw new Error('Could not parse sidebar source: expected the sidebar value to be an array.');
	}
	return iaFromStarlightConfig(rawArray);
}

// ---------------------------------------------------------------------------
// file listing (ls -R / tree / plain) -> SidebarItem[]
// ---------------------------------------------------------------------------

function isLsRHeaderLine(line) {
	return /^(\.|\.\/[^\s:]+|[\w][\w./-]*)\:$/.test(line.trim());
}

function detectListingFormat(text) {
	if (/[│├└]/.test(text) || /^[ \t]*(\+---|\\---)/m.test(text)) return 'tree';
	const lines = text.split(/\r?\n/);
	if (lines.some((l) => l.trim() && isLsRHeaderLine(l))) return 'ls-r';
	return 'plain';
}

/** `ls -R` output -> flat list of file paths (directories excluded). */
function parseLsR(text) {
	const blocks = text.split(/\r?\n[ \t]*\r?\n/);
	const dirEntries = new Map();
	for (const block of blocks) {
		const bLines = block.split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
		const headerIdx = bLines.findIndex((l) => l.trim().length > 0);
		if (headerIdx === -1) continue;
		const headerLine = bLines[headerIdx].trim();
		if (!isLsRHeaderLine(headerLine)) continue;
		let dir = headerLine.replace(/:$/, '');
		dir = dir.replace(/^\.\/?/, '');
		if (dir === '.') dir = '';
		const entries = [];
		for (const line of bLines.slice(headerIdx + 1)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parts = trimmed.split(/\s{2,}|\t+/).map((s) => s.trim()).filter(Boolean);
			entries.push(...(parts.length ? parts : [trimmed]));
		}
		dirEntries.set(dir, entries);
	}
	const dirSet = new Set(dirEntries.keys());
	const files = [];
	for (const [dir, entries] of dirEntries) {
		for (const name of entries) {
			const full = dir ? `${dir}/${name}` : name;
			if (dirSet.has(full)) continue; // it's a directory (listed as its own block)
			files.push(full);
		}
	}
	return files;
}

/** `tree` output (Unicode box-drawing, best-effort ASCII) -> flat list of paths (dirs + files mixed). */
function parseTreeOutput(text) {
	let lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length && /^\d+\s+director(y|ies)\b/i.test(lines[lines.length - 1].trim())) {
		lines.pop();
	}
	if (lines.length && !/^[\s│|+\\]/.test(lines[0])) {
		lines.shift(); // root label line (e.g. "docs" or ".")
	}
	const stack = [];
	const paths = [];
	for (const raw of lines) {
		const m = raw.match(/^((?:[│|]\s{3}|\s{4})*)(?:[├└][─-]{1,4}\s?|[+\\]-{1,4}\s?)?(.*)$/);
		if (!m) continue;
		const prefix = m[1] || '';
		const depth = Math.floor(prefix.length / 4);
		const name = (m[2] || '').trim();
		if (!name) continue;
		stack[depth] = name;
		stack.length = depth + 1;
		paths.push(stack.slice(0, depth + 1).join('/'));
	}
	return paths;
}

/** Normalize raw candidate paths from any listing format into bare, extension-stripped doc slugs. */
function normalizeCandidatePaths(rawPaths) {
	const cleaned = rawPaths
		.map((p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').trim())
		.filter(Boolean)
		.map((p) => p.replace(/^src\/content\/docs\//, ''))
		.filter((p) => p && !p.startsWith('#'));
	const withExt = cleaned.filter((p) => DOC_EXT_RE.test(p));
	const list = withExt.length ? withExt : cleaned;
	const filtered = list.filter((p) => {
		const segments = p.split('/');
		return segments.length > 0 && segments.every((seg) => seg && !seg.startsWith('_') && !seg.startsWith('.'));
	});
	const slugs = filtered.map((p) => p.replace(DOC_EXT_RE, ''));
	const seen = new Set();
	const out = [];
	for (const s of slugs) {
		if (s === 'index') continue; // top-level splash/home page: not a sidebar entry
		if (!seen.has(s)) {
			seen.add(s);
			out.push(s);
		}
	}
	return out;
}

/** Build the SidebarItem[] tree (groups by folder, index -> the folder's link) from bare slugs. */
function buildGroupsFromSlugs(slugs, idFactory) {
	const root = { files: [], dirs: new Map() };
	for (const slug of slugs) {
		const parts = slug.split('/');
		let node = root;
		for (let i = 0; i < parts.length - 1; i++) {
			const seg = parts[i];
			if (!node.dirs.has(seg)) node.dirs.set(seg, { files: [], dirs: new Map() });
			node = node.dirs.get(seg);
		}
		node.files.push(parts[parts.length - 1]);
	}

	function nodeToItems(node, dirPathParts) {
		const items = [];
		const fileNames = [...node.files].sort((a, b) => a.localeCompare(b));
		const indexPos = fileNames.indexOf('index');
		const ordered = [];
		if (indexPos !== -1) {
			ordered.push('index');
			fileNames.splice(indexPos, 1);
		}
		ordered.push(...fileNames);
		for (const fname of ordered) {
			const isIndex = fname === 'index';
			const finalSlug = isIndex ? dirPathParts.join('/') : [...dirPathParts, fname].join('/');
			const label = isIndex
				? titleCase(dirPathParts[dirPathParts.length - 1] ?? 'index')
				: titleCase(fname);
			items.push({
				type: 'link',
				id: idFactory(`link:${finalSlug}`),
				label,
				slug: finalSlug,
			});
		}
		const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
		for (const dname of dirNames) {
			const childParts = [...dirPathParts, dname];
			items.push({
				type: 'group',
				id: idFactory(`group:${childParts.join('/')}`),
				label: titleCase(dname),
				items: nodeToItems(node.dirs.get(dname), childParts),
			});
		}
		return items;
	}

	return nodeToItems(root, []);
}

/**
 * Accepts `ls -R` output, `tree` output (Unicode box-drawing chars, or a
 * best-effort ASCII fallback), or a plain newline-separated path list of
 * `src/content/docs`. Strips extensions, groups by folder, turns a folder's
 * `index` file into that folder's own link, and derives labels from
 * filenames (kebab/snake case -> Title Case).
 * @param {string} text
 * @returns {SidebarItem[]}
 */
export function iaFromFileListing(text) {
	if (typeof text !== 'string' || !text.trim()) return [];
	const format = detectListingFormat(text);
	let rawPaths;
	if (format === 'tree') rawPaths = parseTreeOutput(text);
	else if (format === 'ls-r') rawPaths = parseLsR(text);
	else rawPaths = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

	const slugs = normalizeCandidatePaths(rawPaths);
	const idFactory = makeIdFactory();
	return buildGroupsFromSlugs(slugs, idFactory);
}

// ---------------------------------------------------------------------------
// per-file frontmatter table (for autogenerate-driven sites)
// ---------------------------------------------------------------------------

/**
 * Walks the tree and, for every `link` item with a `slug` (an internal
 * content-collection entry), returns the per-file `sidebar` frontmatter
 * needed to reproduce this tree's order/label/hidden/badge for that file.
 *
 * Order is always included (position within its immediate parent's items,
 * 1-based) since it is the whole point for an autogenerate-driven directory:
 * Starlight only reads `sidebar.order`/`sidebar.hidden` frontmatter for
 * pages reached via `{autogenerate: {directory}}` (or the whole-site
 * fallback with no sidebar config at all) -- for a page that is ALSO
 * explicitly listed in the sidebar array, that array entry's own
 * label/badge win and order/hidden frontmatter has no effect. `label` is
 * only included when it differs from `titleCase(lastSlugSegment)` (matching
 * Starlight's own fallback-to-frontmatter-label behavior for slug links
 * that omit a label), and `badge` mirrors `item.badge` when present.
 *
 * @param {SidebarItem[]} items
 * @returns {{file: string, sidebar: {order?: number, label?: string, hidden?: boolean, badge?: Badge}}[]}
 */
export function iaToFrontmatterTable(items) {
	const rows = [];
	function walk(list) {
		list.forEach((item, index) => {
			if (item.type === 'link' && item.slug !== undefined) {
				// The slug becomes a file path a coding agent edits; never emit one that leaves the
				// docs folder or breaks out of its Markdown cell (`isSafeDocPath`).
				if (!isSafeDocPath(item.slug)) return;
				const derived = titleCase(lastSlugSegment(item.slug) || item.slug);
				/** @type {{order?: number, label?: string, hidden?: boolean, badge?: Badge}} */
				const sidebar = { order: index + 1 };
				if (item.label !== derived) sidebar.label = item.label;
				if (item.hidden) sidebar.hidden = true;
				if (item.badge) sidebar.badge = item.badge;
				rows.push({ file: `src/content/docs/${item.slug}.md`, sidebar });
			} else if (item.type === 'group') {
				walk(item.items);
			}
		});
	}
	walk(items);
	return rows;
}
