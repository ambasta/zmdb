import assert from 'node:assert/strict';

import { diff, snapshot } from '@zmdb/migrations';

import { toolSchema } from './tool-schema.js';

const before = snapshot([]);
const after = snapshot([toolSchema]);
assert.deepEqual(diff(before, before), []);
const operations = diff(before, after);
assert.equal(operations.length, 1);
assert.equal(operations[0]?.kind, 'create_table');
assert.equal(after.tables[0]?.name, 'echo');
