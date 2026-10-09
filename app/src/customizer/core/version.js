/**
 * @file Single source of truth for the pinned `@astrojs/starlight` version. A plain ES module
 * constant - no filesystem or `package.json` reads at runtime, so this stays usable from the
 * browser bundle (`ui/studio.js`) as well as the DOM-free Node test suites (`core/state.js`,
 * `core/emit-css.js`, `core/emit-apply.js`). On every Starlight upgrade, bump this one constant;
 * `tests/core/version.test.js` asserts it against the installed
 * `node_modules/@astrojs/starlight/package.json`, so `npm test` fails until it's bumped.
 */
export const STARLIGHT_VERSION = '0.42.6';
