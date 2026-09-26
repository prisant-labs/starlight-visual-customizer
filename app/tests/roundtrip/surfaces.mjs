// @ts-check
/**
 * @file ~40 key surfaces checked on both `/specimen/` and `/guides/kitchen-sink/`, light + dark.
 * Selectors are taken verbatim from `src/customizer/core/manifest.js`'s own `target` fields (and
 * `treatments.js` probes) wherever a control governs that surface, so the comparison probes the
 * exact same DOM hooks the customizer itself claims to control. A `pages` filter restricts a
 * surface to the page(s) where it actually appears; omit for "both".
 */
export const surfaces = [
	{ id: 'body-p', label: 'Body paragraph', selector: '.sl-markdown-content p', props: ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'] },
	{ id: 'h1-title', label: 'Page title (h1)', selector: '.sl-container > h1#_top', props: ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform'] },
	{ id: 'h2', label: 'Heading h2', selector: '.sl-markdown-content h2', props: ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'border-bottom-style', 'border-bottom-width'] },
	{ id: 'h3', label: 'Heading h3', selector: '.sl-markdown-content h3', props: ['font-family', 'font-size', 'font-weight'] },
	{ id: 'h4', label: 'Heading h4', selector: '.sl-markdown-content h4', props: ['font-family', 'font-size', 'font-weight'] },
	{ id: 'link', label: 'Body link', selector: ".sl-markdown-content a:not(:where(.not-content *))", props: ['color', 'text-decoration-line', 'text-decoration-thickness', 'text-underline-offset', 'font-weight'] },
	{ id: 'inline-code', label: 'Inline code', selector: ".sl-markdown-content code:not(:where(.not-content *)):not(pre code)", props: ['color', 'background-color', 'border-style', 'border-width', 'border-radius', 'font-family', 'font-size', 'padding-top', 'padding-inline'] },
	{ id: 'code-frame', label: 'Code block frame', selector: '.expressive-code .frame', props: ['border-radius'] },
	{ id: 'code-text', label: 'Code block text', selector: '.expressive-code pre code', props: ['font-size', 'font-family'] },
	{ id: 'aside-note', label: 'Note aside', selector: '.starlight-aside--note', props: ['background-color', 'border-color', 'border-style', 'border-width', 'border-radius', 'padding-top', 'padding-inline-start'] },
	{ id: 'aside-tip', label: 'Tip aside', selector: '.starlight-aside--tip', props: ['background-color', 'border-color', 'border-style'] },
	{ id: 'aside-caution', label: 'Caution aside', selector: '.starlight-aside--caution', props: ['background-color', 'border-color', 'border-style'] },
	{ id: 'aside-danger', label: 'Danger aside', selector: '.starlight-aside--danger', props: ['background-color', 'border-color', 'border-style'] },
	{ id: 'table', label: 'Table', selector: '.sl-markdown-content table:not(:where(.not-content *))', props: ['border-style', 'border-width'] },
	{ id: 'table-cell', label: 'Table cell padding', selector: '.sl-markdown-content :is(th, td):not(:where(.not-content *))', props: ['padding-top', 'padding-bottom'] },
	{ id: 'blockquote', label: 'Blockquote', selector: '.sl-markdown-content blockquote:not(:where(.not-content *))', props: ['border-inline-start-style', 'border-inline-start-width', 'background-color', 'padding-top', 'font-style'] },
	{ id: 'header', label: 'Header bar', selector: 'header.header', props: ['background-color', 'border-bottom-style', 'border-bottom-width', 'box-shadow', 'backdrop-filter'] },
	{ id: 'site-title', label: 'Site title', selector: '.site-title', props: ['color', 'font-size', 'font-weight'] },
	{ id: 'search-trigger', label: 'Search trigger', selector: 'button[data-open-modal]', props: ['background-color', 'border-style', 'border-radius', 'max-width'] },
	{ id: 'search-kbd', label: 'Search shortcut hint', selector: "button[data-open-modal] > kbd", props: ['display'] },
	{ id: 'sidebar-link', label: 'Sidebar link', selector: '.sidebar-content a', props: ['color', 'padding-top'] },
	{ id: 'sidebar-link-current', label: 'Sidebar current link', selector: ".sidebar-content a[aria-current='page']", props: ['background-color', 'color', 'border-radius', 'border-inline-start-style', 'border-inline-start-width'] },
	{ id: 'sidebar-group-label', label: 'Sidebar group label', selector: '.sidebar-content .group-label .large', props: ['text-transform', 'font-variant-caps', 'color', 'letter-spacing'] },
	{ id: 'sidebar-nested-li', label: 'Sidebar nested item', selector: '.sidebar-content ul ul li', props: ['margin-inline-start', 'border-inline-start-style'] },
	{ id: 'badge', label: 'Badge (default)', selector: '.sl-badge', props: ['border-radius', 'border-style', 'background-color'] },
	{ id: 'badge-success', label: 'Badge (success)', selector: '.sl-badge.success', props: ['background-color', 'color'] },
	{ id: 'toc-link', label: 'TOC link', selector: 'starlight-toc a', props: ['font-size', 'padding-inline-start', 'color'], pages: ['kitchen-sink'] },
	{ id: 'toc-current', label: 'TOC current marker', selector: "starlight-toc a[aria-current='true']", props: ['color', 'background-color', 'border-inline-start-style'], pages: ['kitchen-sink'] },
	{ id: 'toc-container', label: 'TOC placement', selector: '.right-sidebar-container', props: ['position'], pages: ['kitchen-sink'] },
	{ id: 'pagination-link', label: 'Pagination link', selector: '.pagination-links a', props: ['box-shadow', 'border-radius', 'background-color'] },
	{ id: 'pagination-container', label: 'Pagination alignment', selector: '.pagination-links', props: ['justify-content', 'display'] },
	{ id: 'footer-meta-link', label: 'Footer edit-page link', selector: '.meta a', props: ['color'] },
	{ id: 'footer-kudos', label: 'Footer credits link', selector: 'footer .kudos', props: ['display'] },
	{ id: 'card', label: 'Card', selector: 'article.card', props: ['border-style', 'border-width', 'box-shadow', 'background-color', 'border-radius'] },
	{ id: 'link-button', label: 'Link button', selector: '.sl-link-button', props: ['border-radius'] },
	{ id: 'link-card', label: 'Link card', selector: '.sl-link-card', props: ['border-style', 'border-radius', 'box-shadow'] },
	{ id: 'tabs-tablist', label: 'Tabs tablist', selector: "starlight-tabs [role='tablist']", props: ['border-bottom-style', 'box-shadow', 'background-color'] },
	{ id: 'content-panel', label: 'Content panel gutters', selector: '.content-panel', props: ['padding-inline'] },
	{ id: 'content-width', label: 'Content column width', selector: '.main-pane .sl-container', props: ['max-width'] },
	{ id: 'sidebar-width', label: 'Sidebar pane width', selector: '.sidebar-pane', props: ['width'] },
];

/** @param {{pages?: string[]}} surface @param {'specimen'|'kitchen-sink'} page */
export function appliesTo(surface, page) {
	return !surface.pages || surface.pages.includes(page);
}
