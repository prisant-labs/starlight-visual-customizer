/**
 * @file Clones the real page's stylesheets so a tile grid's nested shadow root can render live
 * Starlight markup with Starlight's own CSS applied: clones the page's stylesheets
 * (`document.head` `<link rel=stylesheet>` and `<style>` elements - in dev Vite injects `<style>`
 * tags, in build they are `<link>`s; handles both). Cloned in document order so `@layer`
 * declaration order (see `dist/style/layers.css`) is preserved.
 *
 * PAGE-facing (studio.astro's design doc, item C): reads from `getPageDoc()` (the previewed
 * document - the frame's, in studio mode), not the module's own `document`, so a tile grid picks up
 * whichever page's stylesheets are actually live right now.
 */
import { getPageDoc } from '../page-doc.js';

/** @returns {(HTMLStyleElement|HTMLLinkElement)[]} Cloned `<style>`/`<link rel=stylesheet>` nodes from the page document's `<head>`, in document order. */
export function clonePageStyleNodes() {
	const pageDoc = getPageDoc();
	if (!pageDoc) return [];
	const nodes = pageDoc.head.querySelectorAll("style, link[rel='stylesheet']");
	return Array.from(nodes).map((node) => /** @type {HTMLStyleElement|HTMLLinkElement} */ (node.cloneNode(true)));
}
