import assert from 'node:assert/strict';

import { lenientParse, toolFromSchema } from '@zmdb/ai';

import { toolSchema } from './tool-schema.js';

assert.deepEqual(toolFromSchema('echo', toolSchema).parameters.properties.value, { type: 'string' });
const parsed = lenientParse('{"value":"wire-π"}');
assert(parsed.success);
assert.deepEqual(parsed.data, { value: 'wire-π' });
assert.equal(lenientParse('{').success, false);
