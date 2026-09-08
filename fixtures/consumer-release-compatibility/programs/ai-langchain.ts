import assert from 'node:assert/strict';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { langchainTool } from '@zmdb/ai-langchain';

import { toolSchema, validateEcho } from './tool-schema.js';

const selected = new DynamicStructuredTool(
  langchainTool('echo', toolSchema, {
    description: 'Echo the validated input',
    validate: validateEcho,
    execute: input => ({ echoed: input.value }),
  }),
);
assert.equal(await selected.invoke({ value: 'wire-π' }), '{"echoed":"wire-π"}');
await assert.rejects(selected.invoke({ value: 17 }));
