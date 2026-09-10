import assert from 'node:assert/strict';
import { realpath, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createSqsStrategy } from '@zmdb/transport/sqs';

import { exerciseApplication } from './app.mjs';
import { exerciseBroker } from './runtime.mjs';
import { exerciseWire } from './wire.mjs';

const manifest = JSON.parse(await readFile('node_modules/@zmdb/transport/sqs/package.json', 'utf8'));
assert.deepEqual(Object.keys(manifest.exports), ['.']);
assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
assert.equal(manifest.exports['.'].import, './dist/index.js');
assert.equal((await lstat('node_modules/@zmdb/transport/sqs')).isSymbolicLink(), false);
assert((await realpath('node_modules/@zmdb/transport/sqs')).startsWith(join(process.cwd(), 'node_modules')));
await assert.rejects(import('@zmdb/transport/sqs/src/index.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
await assert.rejects(import('@zmdb/transport/sqs/private'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
const endpoint = process.env.ZMDB_760_SQS_ENDPOINT,
  wire = process.env.ZMDB_760_WIRE_ENDPOINT;
assert(endpoint && wire, 'both required local fixtures must be supplied');
console.log(
  JSON.stringify({
    broker: await exerciseBroker(createSqsStrategy, endpoint),
    wire: await exerciseWire(createSqsStrategy, wire),
    app: await exerciseApplication(createSqsStrategy, endpoint),
  }),
);
