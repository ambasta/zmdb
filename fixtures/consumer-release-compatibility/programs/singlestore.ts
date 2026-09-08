import assert from 'node:assert/strict';

import { singlestore, singlestoreDriver } from '@zmdb/singlestore';
import { createQueryCompiler } from '@zmdb/sql';
import { createPool } from 'mysql2/promise';

const pool = createPool({ host: '127.0.0.1', port: 1 });
try {
  assert.equal(singlestoreDriver(pool).dialect, singlestore);
  const query = createQueryCompiler(singlestore).selectFrom('items').where('id', '=', 7).compile();
  assert.equal(query.text, 'SELECT * FROM `items` WHERE `id` = ?');
  assert.deepEqual(query.parameters, [7]);
} finally {
  await pool.end();
}
