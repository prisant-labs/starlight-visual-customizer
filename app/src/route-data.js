// @ts-check
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { withBase } from './customizer/core/base-path.js';
import { DEMO_DIR } from './demo-site.mjs';

/**
 * Starlight route middleware (registered as `routeMiddleware` in `astro.config.mjs`).
 *
 * Starlight points the header's site-title link at the site root, and offers no config option for
 * it. Here the root belongs to the product page and the studio, while every Starlight page belongs
 * to the demo site under `/demo/`. So the title link goes to the demo's own home page instead.
 * That also keeps the studio's preview frame inside the demo: clicking the title there shows the
 * demo's splash page, never a second copy of the site root. The 404 page has no other home link,
 * so this one rewrite covers it too.
 */
export const onRequest = defineRouteMiddleware((context) => {
	context.locals.starlightRoute.siteTitleHref = withBase(`/${DEMO_DIR}/`);
});
