import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { trustedTable, createQueryCompiler } from '@zmdb/sql';
import { sqlite, sqliteDriver } from '@zmdb/sqlite';

const database = new DatabaseSync(':memory:');
try {
  database.exec('CREATE TABLE release_value (value TEXT NOT NULL)');
  const driver = sqliteDriver(database);
  const compiler = createQueryCompiler(sqlite);
  await driver.execute(compiler.insertInto(trustedTable('release_value')).values({ value: 'wire-π' }).compile());
  assert.deepEqual(
    (await driver.execute(compiler.selectFrom(trustedTable('release_value')).compile())).map(row => row.value),
    ['wire-π'],
  );
} finally {
  database.close();
}
