import assert from 'node:assert/strict';

import { postgres, postgresDriver } from '@zmdb/postgres';
import { trustedTable, createQueryCompiler } from '@zmdb/sql';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgres://unused@127.0.0.1:1/unused' });
try {
  assert.equal(postgresDriver(pool).dialect, postgres);
  const query = createQueryCompiler(postgres).selectFrom(trustedTable('items')).where('id', '=', 7).compile();
  assert.equal(query.text, 'SELECT * FROM "items" WHERE "id" = $1');
  assert.deepEqual(query.parameters, [7]);
  const calls: unknown[] = [];
  const driver = postgresDriver({
    query: async (...arguments_: unknown[]) => {
      calls.push(arguments_);
      return { rows: [{ value: 'wire-π' }] };
    },
  });
  assert.deepEqual(await driver.execute(query), [{ value: 'wire-π' }]);
  assert.deepEqual(calls, [[query.text, [7]]]);
} finally {
  await pool.end();
}
