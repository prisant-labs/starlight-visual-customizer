/**
 * @file Rewrites every file in `tests/golden/` from the cases in `tests/golden/cases.js`.
 * Run it with `npm run golden:update` after an intended change to `emit-css.js` or
 * `emit-apply.js`, then read the diff before committing it. This script trusts the emitters, so a
 * regression gets written into the golden files just as faithfully as an improvement.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { goldenCases } from '../tests/golden/cases.js';

const goldenDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'golden');

for (const c of goldenCases) {
	writeFileSync(path.join(goldenDir, c.file), c.emit().replace(/\r\n/g, '\n'));
	console.log(`wrote tests/golden/${c.file}`);
}
