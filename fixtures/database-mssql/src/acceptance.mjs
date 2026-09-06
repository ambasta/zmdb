import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { mssql, mssqlDriver, mssqlIntrospector } from '@zmdb/mssql';
import { createQueryCompiler, quoteTable } from '@zmdb/query-compiler';
import { detectDrift } from '@zmdb/query-compiler/introspect';
import { down, driverMigrationConnection, up } from '@zmdb/query-compiler/migrations';

const connection = process.env.ZMDB_MSSQL_URL;
if (connection === undefined) {
  throw new Error('ZMDB_MSSQL_URL is required for packed @zmdb/mssql acceptance');
}

const requireFromHere = createRequire(import.meta.url);
const sql = requireFromHere('mssql');
const pool = await sql.connect(connection);
const suffix = String(process.pid);
const schema = `zmdb_packed_672_${suffix}`;
const usersName = 'users';
const childrenName = 'children';
const users = `${schema}.${usersName}`;
const children = `${schema}.${childrenName}`;
const sequenceName = `${schema}.user_sequence`;
const ledger = `${schema}._zmdb_migrations`;
const q = name => quoteTable(mssql, name);
const driver = mssqlDriver(pool);
const compiler = createQueryCompiler(mssql);
const migrationConnection = driverMigrationConnection(driver, mssql, { schema });
const base = {
  version: 20260905067211,
  name: 'create packed SQL Server schema',
  up: [
    mssql.migrations.emitUp({
      kind: 'create_table',
      table: users,
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'guid', type: 'UNIQUEIDENTIFIER', nullable: false, primaryKey: false },
        { name: 'email', type: 'varchar', length: 128, nullable: false, primaryKey: false },
        { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
        { name: 'happened_at', type: 'timestamp', nullable: false, primaryKey: false },
        { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    }),
    `ALTER TABLE ${q(users)} ADD CONSTRAINT [users_active_default] DEFAULT ((1)) FOR [active]`,
    `ALTER TABLE ${q(users)} ADD ${
      mssql.migrations.emitSchemaObject({
        kind: 'generated_column',
        definition: {
          name: 'email_size',
          type: 'integer',
          expression: 'LEN([email])',
          stored: true,
        },
      })[0]
    }`,
    mssql.migrations.emitSchemaObject({
      kind: 'create_index',
      definition: {
        name: 'users_active_email',
        table: users,
        columns: ['email'],
        where: '[active] = 1',
      },
    })[0],
    mssql.migrations.emitUp({
      kind: 'create_table',
      table: children,
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'user_id', type: 'integer', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    }),
    mssql.migrations.emitUp({
      kind: 'add_foreign_key',
      table: children,
      fk: {
        name: 'children_user_fkey',
        columns: ['user_id'],
        targetTable: users,
        targetColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no action',
      },
    }),
    mssql.migrations.emitSchemaObject({
      kind: 'create_sequence',
      definition: {
        name: sequenceName,
        start: 10,
        increment: 5,
      },
    })[0],
  ].join(';\n'),
  down: [`DROP TABLE ${q(children)}`, `DROP TABLE ${q(users)}`, `DROP SEQUENCE ${q(sequenceName)}`].join(';\n'),
};

let baseApplied = false;
try {
  await pool.request().query(`CREATE SCHEMA ${quoteTable(mssql, schema)}`);
  assert.deepEqual(await up(migrationConnection, [base]), [base.version]);
  baseApplied = true;

  const guid = '550e8400-e29b-41d4-a716-446655440000';
  const happenedAt = new Date('2026-09-05T12:34:56.789Z');
  const inserted = await driver.execute(
    compiler
      .insertInto(users)
      .values({
        guid,
        email: '東京@example.com',
        active: true,
        happened_at: happenedAt,
        visits: 1,
      })
      .returning(['id', 'guid', 'email', 'active', 'happened_at'])
      .compile(),
  );
  assert.equal(String(inserted[0]?.guid).toLowerCase(), guid);
  assert.equal(inserted[0]?.email, '東京@example.com');
  assert.equal(inserted[0]?.active, true);
  assert.ok(inserted[0]?.happened_at instanceof Date);
  assert.equal(inserted[0].happened_at.toISOString(), happenedAt.toISOString());

  const merged = await driver.execute(
    compiler
      .insertInto(users)
      .values({
        guid,
        email: 'updated@example.com',
        active: false,
        happened_at: happenedAt,
        visits: 2,
      })
      .onConflict('guid')
      .doUpdate(['email', 'active', 'happened_at', 'visits'])
      .returning(['email', 'active', 'visits'])
      .compile(),
  );
  assert.deepEqual(merged, [{ email: 'updated@example.com', active: false, visits: 2 }]);

  await driver.execute(
    compiler
      .insertInto(users)
      .values({
        guid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        email: 'page@example.com',
        active: true,
        happened_at: happenedAt,
        visits: 1,
      })
      .compile(),
  );
  const page = await driver.execute(compiler.selectFrom(users).orderBy('id', 'asc').offset(1).limit(1).compile());
  assert.equal(page[0]?.email, 'page@example.com');

  const updated = await driver.execute(
    compiler.updateTable(users).set({ visits: 3 }).where('guid', '=', guid).returning(['visits']).compile(),
  );
  assert.deepEqual(updated, [{ visits: 3 }]);
  const deleted = await driver.execute(
    compiler
      .deleteFrom(users)
      .where('guid', '=', '3f2504e0-4f89-41d3-9a0c-0305e82c3301')
      .returning(['email'])
      .compile(),
  );
  assert.deepEqual(deleted, [{ email: 'page@example.com' }]);

  const rollbackGuid = '21ec2020-3aea-4069-a2dd-08002b30309d';
  await assert.rejects(
    driver.transaction(async transaction => {
      await transaction.execute(
        compiler
          .insertInto(users)
          .values({
            guid: rollbackGuid,
            email: 'rollback@example.com',
            active: true,
            happened_at: happenedAt,
            visits: 1,
          })
          .compile(),
      );
      throw new Error('force rollback');
    }),
    /force rollback/,
  );
  assert.deepEqual(await driver.execute(compiler.selectFrom(users).where('guid', '=', rollbackGuid).compile()), []);

  const snapshot = await mssqlIntrospector.snapshot(driver, { schemas: [schema] });
  const usersCatalog = snapshot.tables.find(candidate => candidate.name === usersName);
  const childrenCatalog = snapshot.tables.find(candidate => candidate.name === childrenName);
  assert.ok(usersCatalog);
  assert.ok(childrenCatalog);
  assert.deepEqual(usersCatalog.primaryKey, ['id']);
  assert.deepEqual(usersCatalog.columns.find(column => column.name === 'id')?.identity, { seed: '1', increment: '1' });
  assert.equal(usersCatalog.columns.find(column => column.name === 'guid')?.catalogType, 'UNIQUEIDENTIFIER');
  assert.equal(usersCatalog.columns.find(column => column.name === 'email')?.catalogType, 'NVARCHAR(128)');
  assert.equal(usersCatalog.columns.find(column => column.name === 'active')?.default, '((1))');
  assert.deepEqual(usersCatalog.columns.find(column => column.name === 'email_size')?.computed, {
    expression: '(len([email]))',
    persisted: true,
  });
  assert.equal(usersCatalog.indexes[0]?.where, '([active]=(1))');
  assert.deepEqual(childrenCatalog.foreignKeys[0], {
    name: 'children_user_fkey',
    columns: ['user_id'],
    targetTable: usersName,
    targetColumns: ['id'],
    onDelete: 'cascade',
    onUpdate: 'no action',
    disabled: false,
    trusted: true,
  });
  assert.deepEqual(snapshot.sequences, [
    {
      name: 'user_sequence',
      schema,
      catalogType: 'BIGINT',
      start: '10',
      increment: '5',
    },
  ]);

  const liveRoundTrip = await mssqlIntrospector.snapshot(driver, {
    schemas: [schema],
    include: [usersName],
  });
  const normalized = mssqlIntrospector.normalizeForDrift(liveRoundTrip, 'live');
  const declared = {
    version: 1,
    tables: [
      {
        name: usersName,
        columns: [
          { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
          { name: 'email', type: 'varchar', length: 128, nullable: false, primaryKey: false },
          { name: 'email_size', type: 'integer', nullable: true, primaryKey: false },
          { name: 'guid', type: 'UNIQUEIDENTIFIER', nullable: false, primaryKey: false },
          { name: 'happened_at', type: 'timestamp', nullable: false, primaryKey: false },
          { name: 'id', type: 'serial', nullable: false, primaryKey: true },
          { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
      },
    ],
    extensions: [],
  };
  assert.deepEqual(detectDrift(normalized, declared), {
    onlyInDatabase: [],
    onlyInDeclarations: [],
    clean: true,
  });

  assert.equal(await down(migrationConnection, [base]), base.version);
  baseApplied = false;
  console.log(
    JSON.stringify({
      package: '@zmdb/mssql',
      migration: 'up/down',
      crud: ['insert', 'merge', 'select-page', 'update', 'delete'],
      introspected: {
        tables: snapshot.tables.length,
        columns: snapshot.tables.reduce((count, current) => count + current.columns.length, 0),
        foreignKeys: snapshot.tables.reduce((count, current) => count + current.foreignKeys.length, 0),
        indexes: snapshot.tables.reduce((count, current) => count + current.indexes.length, 0),
        sequences: snapshot.sequences.length,
      },
      driftClean: true,
    }),
  );
  console.log('packed consumer applies migrations and CRUD against SQL Server');
} finally {
  if (baseApplied) {
    await pool.request().query(`DROP TABLE IF EXISTS ${q(children)}`);
    await pool.request().query(`DROP TABLE IF EXISTS ${q(users)}`);
    await pool.request().query(`DROP SEQUENCE IF EXISTS ${q(sequenceName)}`);
  }
  await pool.request().query(`DROP TABLE IF EXISTS ${q(ledger)}`);
  await pool.request().query(`DROP SCHEMA IF EXISTS ${quoteTable(mssql, schema)}`);
  await pool.close();
}
