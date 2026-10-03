import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { goldenCases } from '../golden/cases.js';

const goldenDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'golden');

test('every golden file has exactly one case in tests/golden/cases.js, so golden:update rewrites them all', () => {
	const files = readdirSync(goldenDir)
		.filter((f) => f.endsWith('.css') || f.endsWith('.md'))
		.sort();
	const caseFiles = goldenCases.map((c) => c.file).sort();
	assert.deepEqual(caseFiles, files);
});
