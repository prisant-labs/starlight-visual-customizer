// @ts-check
/**
 * @file Shared browser launcher for the e2e suites. Picks the engine from `SVC_BROWSER`
 * (`chromium` (default), `firefox` or `webkit`), all three from `playwright-core`. Only the
 * `chromium` branch reads `SVC_CHROME_PATH`, so a pinned Chrome/Chromium path never leaks into
 * the other two engines; with `SVC_BROWSER` unset, `launchBrowser()` behaves exactly as each
 * suite's own inlined `chromium.launch({ executablePath, headless: true })` did before this
 * helper existed.
 *
 * Also exports `skip`, for a check an engine cannot run at all (e.g. a permission Chromium grants
 * and Firefox/WebKit reject). A skip prints `SKIP - <name> (<reason>)` and must never increment a
 * suite's own pass/fail counters - it is neither.
 */
import { chromium, firefox, webkit } from 'playwright-core';

export const BROWSER_NAME = process.env.SVC_BROWSER || 'chromium';

const ENGINES = { chromium, firefox, webkit };

if (!ENGINES[BROWSER_NAME]) {
	throw new Error(`SVC_BROWSER must be one of chromium, firefox, webkit (got "${BROWSER_NAME}")`);
}

/** Launches the engine named by `SVC_BROWSER`, headless. @returns {Promise<import('playwright-core').Browser>} */
export async function launchBrowser() {
	if (BROWSER_NAME === 'chromium') {
		const executablePath = process.env.SVC_CHROME_PATH || chromium.executablePath();
		return chromium.launch({ executablePath, headless: true });
	}
	return ENGINES[BROWSER_NAME].launch({ headless: true });
}

let skipped = 0;

/** Prints a skip line for a check this engine cannot run. Never counts as a pass or a failure. */
export function skip(name, reason = '') {
	skipped += 1;
	console.log(`SKIP - ${name}${reason ? ` (${reason})` : ''}`);
}

/** How many checks `skip` has reported so far, for a suite's closing summary line. */
export function skippedCount() {
	return skipped;
}

/**
 * For a suite not yet checked on Firefox or WebKit: under `SVC_BROWSER=firefox` or `webkit` it
 * prints one SKIP line and exits successfully, before launching anything. `npm run test:e2e` then
 * carries on to the next suite, and a Chromium run is never reported as another engine's pass.
 * @param {string} suite The suite's file name, for the SKIP line.
 */
export function chromiumOnly(suite) {
	if (BROWSER_NAME === 'chromium') return;
	console.log(`SKIP - ${suite} runs on Chromium only, so SVC_BROWSER=${BROWSER_NAME} skips the whole suite`);
	process.exit(0);
}
