/**
 * @file Scopes a chunk of plain CSS (as authored in `core/treatments.js`) so it only ever matches
 * inside one tile's sample container, instead of leaking onto the real page or onto sibling tiles
 * in the same nested shadow root. Parses with a throwaway `CSSStyleSheet` (never touches the DOM),
 * walks `cssRules` (including nested `@media`/`@supports`), and rewrites `selectorText`:
 *  - a leading `:root`, `html`, or `body` in a selector is replaced outright by the scope selector
 *    (these tokens mean "the page root" in treatments.js; inside a tile that IS the tile container)
 *  - everything else is prefixed with `${scope} ` (plain descendant combinator)
 * Selector lists are split on top-level commas only (bracket/paren-depth aware), so
 * `:is(th, td)` / `:not(:where(.not-content *))` survive intact.
 */

/**
 * @param {string} cssText
 * @param {string} scope A CSS selector (e.g. `.svc-sample-2`) uniquely identifying one tile's
 *   sample container within the grid's nested shadow root.
 * @returns {string} Scoped CSS, or `''` if `cssText` is empty or fails to parse.
 */
export function scopeCss(cssText, scope) {
	if (!cssText || !cssText.trim()) return '';
	let sheet;
	try {
		sheet = new CSSStyleSheet();
		sheet.replaceSync(cssText);
	} catch {
		return '';
	}
	try {
		return scopeRuleList(sheet.cssRules, scope);
	} catch {
		return '';
	}
}

/** @param {CSSRuleList} ruleList @param {string} scope @returns {string} */
function scopeRuleList(ruleList, scope) {
	const out = [];
	for (const rule of ruleList) {
		if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
			const selectors = splitTopLevelCommas(rule.selectorText).map((s) => scopeOneSelector(s, scope));
			const decls = rule.style.cssText;
			if (decls) out.push(`${selectors.join(', ')} { ${decls} }`);
		} else if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
			const inner = scopeRuleList(rule.cssRules, scope);
			if (inner) out.push(`@media ${rule.conditionText} { ${inner} }`);
		} else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
			const inner = scopeRuleList(rule.cssRules, scope);
			if (inner) out.push(`@supports ${rule.conditionText} { ${inner} }`);
		}
		// Other rule kinds (@font-face, @keyframes, ...) never appear in treatments.js; ignored.
	}
	return out.join('\n');
}

/** @param {string} selector @param {string} scope @returns {string} */
function scopeOneSelector(selector, scope) {
	const trimmed = selector.trim();
	const rootMatch = trimmed.match(/^(:root|html|body)\b(.*)$/);
	if (rootMatch) return `${scope}${rootMatch[2]}`;
	return `${scope} ${trimmed}`;
}

/**
 * Splits a CSS selector list on commas that are not nested inside `()` or `[]` (so `:is(a, b)` and
 * `[data-x="a,b"]` survive as one selector each).
 * @param {string} text
 * @returns {string[]}
 */
function splitTopLevelCommas(text) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (ch === ',' && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map((p) => p.trim()).filter(Boolean);
}
