import assert from 'node:assert/strict';

import { compileProject } from '@zmdb/compiler';

const result = await compileProject({ project: 'tsconfig.json', files: ['src/declaration.ts'] });
assert.deepEqual(result.diagnostics, []);
assert.equal(result.artifacts.length, 1);
assert.match(result.artifacts[0]?.witness ?? '', /schemaOf<Echo>/);
assert.match(result.artifacts[0]?.runtime ?? '', /["']echo["']/);
