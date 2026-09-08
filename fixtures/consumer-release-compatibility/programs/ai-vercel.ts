import assert from 'node:assert/strict';

import { aiSdkTool } from '@zmdb/ai-vercel';
import { jsonSchema, tool } from 'ai';

import { toolSchema, validateEcho } from './tool-schema.js';

const fields = aiSdkTool('echo', toolSchema, {
  jsonSchema,
  description: 'Echo the validated input',
  validate: validateEcho,
  execute: input => ({ echoed: input.value }),
});
const selected = tool(fields);
assert.equal(selected.inputSchema, fields.inputSchema);
assert.ok(selected.execute);
assert.deepEqual(await selected.execute({ value: 'wire-π' }, { toolCallId: 'release', messages: [], context: {} }), {
  echoed: 'wire-π',
});
await assert.rejects(fields.execute({ value: 17 }), /value must be a string/);
