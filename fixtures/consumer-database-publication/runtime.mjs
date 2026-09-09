import assert from 'node:assert/strict';

import { down, up } from '@zmdb/migrations';
import { trustedTable, createQueryCompiler } from '@zmdb/sql';

const database = process.argv[2];
const required = {
  postgres: 'ZMDB_POSTGRES_URL',
  mysql: 'ZMDB_MYSQL_URL',
  mssql: 'ZMDB_MSSQL_URL',
  cockroach: 'ZMDB_COCKROACH_URL',
  singlestore: 'ZMDB_SINGLESTORE_URL',
};
assert(['sqlite', ...Object.keys(required)].includes(database), 'select one of the six database packages');
const address = database === 'sqlite' ? undefined : process.env[required[database]];
assert(
  database === 'sqlite' || (typeof address === 'string' && address.length > 0),
  `${required[database]} is required`,
);

const provider = await import(`@zmdb/${database}`);
const dialect = provider[database];
const makeDriver = provider[`${database}Driver`];
const vertical = provider[`${database}Vertical`];
assert.equal(vertical.dialect, dialect);
assert.equal(vertical.driver, makeDriver);
assert.equal(dialect.introspector, provider[`${database}Introspector`]);

let client;
let close;
if (database === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  client = new DatabaseSync(':memory:');
  close = () => client.close();
} else if (database === 'postgres' || database === 'cockroach') {
  const { Pool } = await import('pg');
  client = new Pool({ connectionString: address, max: 2 });
  close = () => client.end();
} else if (database === 'mssql') {
  const { default: sql } = await import('mssql');
  client = await new sql.ConnectionPool(address).connect();
  close = () => client.close();
} else {
  const { createPool } = await import('mysql2/promise');
  client = createPool(address);
  close = () => client.end();
}

const table = `zmdb_publication_${process.pid}`;
const driver = makeDriver(client);
const compiler = createQueryCompiler(dialect);
const connection = dialect.migrations.connection(driver, { table: `${table}_ledger` });
const create = {
  kind: 'create_table',
  table,
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'label', type: 'varchar', length: 128, nullable: false, primaryKey: false },
    { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  ...(database === 'singlestore' ? { tableOptions: { rowstore: true, shardKey: ['id'] } } : {}),
};
const migration = {
  version: 676,
  name: 'public database publication',
  up: dialect.migrations.emitUp(create),
  down: dialect.migrations.emitDown(create),
};
const observedQueries = [];
const label = "quoted'; SELECT 999; --";
const execute = async query => {
  observedQueries.push({ text: query.text, parameters: query.parameters });
  return (await driver.execute(query)).map(row => ({ ...row }));
};
let applied = false;
try {
  assert.deepEqual(await up(connection, [migration]), [676]);
  applied = true;
  assert.deepEqual(await up(connection, [migration]), []);
  await execute(compiler.insertInto(trustedTable(table)).values({ id: 7, label, visits: 1 }).compile());
  assert.deepEqual(await execute(compiler.selectFrom(trustedTable(table)).where('id', '=', 7).compile()), [
    { id: 7, label, visits: 1 },
  ]);
  await execute(compiler.updateTable(trustedTable(table)).set({ visits: 2 }).where('id', '=', 7).compile());
  assert.deepEqual(await execute(compiler.selectFrom(trustedTable(table)).where('id', '=', 7).compile()), [
    { id: 7, label, visits: 2 },
  ]);
  await assert.rejects(
    driver.transaction(async transaction => {
      await transaction.execute(
        compiler.insertInto(trustedTable(table)).values({ id: 8, label: 'rolled back', visits: 9 }).compile(),
      );
      throw new Error('publication rollback');
    }),
    /publication rollback/,
  );
  assert.deepEqual(await execute(compiler.selectFrom(trustedTable(table)).where('id', '=', 8).compile()), []);
  const catalog = await dialect.introspector.snapshot(driver);
  const actual = catalog.tables.find(entry => entry.name === table);
  assert(actual, 'the actual server catalog must contain the migrated table');
  assert.deepEqual(actual.primaryKey, ['id']);
  assert.deepEqual(actual.columns.map(column => column.name).toSorted(), ['id', 'label', 'visits']);
  await execute(compiler.deleteFrom(trustedTable(table)).where('id', '=', 7).compile());
  assert.deepEqual(await execute(compiler.selectFrom(trustedTable(table)).compile()), []);
  assert.equal(await down(connection, [migration]), 676);
  applied = false;
  assert.equal(
    (await dialect.introspector.snapshot(driver)).tables.some(entry => entry.name === table),
    false,
  );
  assert.deepEqual(observedQueries[0].parameters, [7, label, 1]);
  assert.equal(observedQueries[0].text.includes(label), false, 'values must travel through protocol parameters');
  const placeholder = database === 'mssql' ? '@p1' : ['postgres', 'cockroach'].includes(database) ? '$1' : '?';
  assert(observedQueries[0].text.includes(placeholder));
  process.stdout.write(
    `${JSON.stringify({ database, migration: true, crud: true, rollback: true, introspection: true, queries: observedQueries })}\n`,
  );
} finally {
  try {
    if (applied) await down(connection, [migration]);
  } finally {
    await close();
  }
}
