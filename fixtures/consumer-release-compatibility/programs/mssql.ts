import assert from 'node:assert/strict';

import { mssql, mssqlDriver } from '@zmdb/mssql';
import { createQueryCompiler } from '@zmdb/sql';
import sqlServer from 'mssql';

const pool = new sqlServer.ConnectionPool({ server: '127.0.0.1', port: 1 });
try {
  assert.equal(mssqlDriver(pool).dialect, mssql);
  const query = createQueryCompiler(mssql).selectFrom('items').where('id', '=', 7).compile();
  assert.equal(query.text, 'SELECT * FROM [items] WHERE [id] = @p1');
  assert.deepEqual(query.parameters, [7]);
} finally {
  await pool.close();
}
