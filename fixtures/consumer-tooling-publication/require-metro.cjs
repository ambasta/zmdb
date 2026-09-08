const assert = require('node:assert/strict');
const { withZmdb } = require('@zmdb/compiler/metro');

assert.equal(typeof withZmdb, 'function');
assert.equal(withZmdb({ projectRoot: process.cwd() }, { workerCount: 1 }).maxWorkers, 1);
assert.throws(() => withZmdb({ projectRoot: process.cwd() }, { workerCount: 0 }), RangeError);
process.stdout.write(JSON.stringify({ node: process.version, synchronousMetroRequire: true }) + '\n');
