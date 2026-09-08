import assert from 'node:assert/strict';

import { lenientParse, toolFromSchema } from '@zmdb/ai';

import { toolSchema } from './tool-schema.js';

assert.deepEqual(toolFromSchema('echo', toolSchema).parameters.properties.value, { type: 'string' });
assert.deepEqual(lenientParse('{"value":"wire-π"}').data, { value: 'wire-π' });
assert.equal(lenientParse('{').success, false);
