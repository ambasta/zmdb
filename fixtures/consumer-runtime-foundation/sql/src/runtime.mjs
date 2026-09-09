import assert from 'node:assert/strict';

import { createQueryCompiler, trustedTable } from '@zmdb/sql';

import { dialect } from './dialect.js';

const query = createQueryCompiler(dialect, { telemetry: true })
  .selectFrom(trustedTable('users'))
  .select(['id', 'email'])
  .where('id', '=', 7)
  .orderBy('id', 'asc')
  .limit(2)
  .compile();
assert.equal(query.text, 'SELECT <id>, <email> FROM <users> WHERE <id> = $1 ORDER BY <id> ASC LIMIT 2');
assert.deepEqual(query.parameters, [7]);
assert.deepEqual(query.telemetry, { system: 'acme', operation: 'SELECT', collection: 'users' });
