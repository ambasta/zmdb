import assert from 'node:assert/strict';

import { cockroach, cockroachDriver } from '@zmdb/cockroach';
import { createQueryCompiler } from '@zmdb/sql';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgres://unused@127.0.0.1:1/unused' });
try {
  assert.equal(cockroachDriver(pool).dialect, cockroach);
  const query = createQueryCompiler(cockroach).selectFrom('items').where('id', '=', 7).compile();
  assert.equal(query.text, 'SELECT * FROM "items" WHERE "id" = $1');
  assert.deepEqual(query.parameters, [7]);
} finally {
  await pool.end();
}
