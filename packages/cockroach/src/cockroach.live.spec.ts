import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cockroach, cockroachDriver, cockroachIntrospector } from './index.js';

const connectionString = process.env['ZMDB_COCKROACH_URL'];
const live = connectionString === undefined ? describe.skip : describe;
const schema = 'zmdb_issue_673_vitest';
const accountsTable = `"${schema}"."accounts"`;
const usersTable = `"${schema}"."users"`;
const pool = connectionString === undefined ? undefined : new Pool({ connectionString, max: 4 });

live('CockroachDB live acceptance', () => {
  beforeAll(async () => {
    if (pool === undefined) throw new Error('ZMDB_COCKROACH_URL is required for live CockroachDB acceptance');
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await pool.end();
  });

  it('round-trips against real CockroachDB', async () => {
    if (pool === undefined) throw new Error('live pool is unavailable');
    const accounts = cockroach.migrations.emitUp({
      kind: 'create_table',
      table: 'accounts',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'name', type: 'text', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    });
    const users = cockroach.migrations.emitUp({
      kind: 'create_table',
      table: 'users',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'account_id', type: 'bigint', nullable: true, primaryKey: false },
        { name: 'email', type: 'text', nullable: false, primaryKey: false },
        { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    });
    const foreignKey = cockroach.migrations.emitUp({
      kind: 'add_foreign_key',
      table: 'users',
      fk: {
        name: 'users_account_id_fkey',
        columns: ['account_id'],
        targetTable: 'accounts',
        targetColumns: ['id'],
        onDelete: 'set null',
        onUpdate: 'cascade',
      },
    });
    const expressionIndex = cockroach.migrations.emitSchemaObject({
      kind: 'create_index',
      definition: {
        name: 'users_lower_email_idx',
        table: 'users',
        columns: [{ expr: 'lower(email)' }],
        unique: true,
        where: 'active',
      },
    })[0];
    if (expressionIndex === undefined) throw new Error('Cockroach expression-index DDL is absent');

    const setup = await pool.connect();
    try {
      await setup.query(`SET search_path TO "${schema}", public`);
      await setup.query(accounts);
      await setup.query(users);
      await setup.query(`ALTER TABLE "users" ADD COLUMN "email_key" TEXT GENERATED ALWAYS AS (lower(email)) STORED`);
      await setup.query(foreignKey);
      await setup.query(expressionIndex);
    } finally {
      setup.release();
    }

    const driver = cockroachDriver(pool);
    const insertedAccount = await driver.execute({
      text: 'INSERT INTO ' + accountsTable + ' ("name") VALUES ($1) RETURNING "id"',
      parameters: ['Acme'],
    });
    const accountId = insertedAccount[0]?.['id'];
    expect(typeof accountId).toBe('string');
    expect(Number.isSafeInteger(Number(accountId))).toBe(false);
    const insertedUser = await driver.execute({
      text:
        'INSERT INTO ' +
        usersTable +
        ' ("account_id", "email", "active") ' +
        'VALUES ($1, $2, $3) RETURNING "id", "email"',
      parameters: [accountId, 'Alice@Example.test', true],
    });
    expect(insertedUser[0]?.['email']).toBe('Alice@Example.test');

    const snapshot = await cockroachIntrospector.snapshot(driver, { schemas: [schema] });
    expect(snapshot.tables.map(table => table.name)).toEqual(['accounts', 'users']);
    expect(snapshot.tables.find(table => table.name === 'accounts')?.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', type: 'serial' })]),
    );
    expect(snapshot.tables.find(table => table.name === 'users')).toMatchObject({
      foreignKeys: [{ name: 'users_account_id_fkey', onDelete: 'set null', onUpdate: 'cascade' }],
      indexes: [
        {
          name: 'users_lower_email_idx',
          columns: [{ expr: 'lower(email)' }],
          unique: true,
          where: 'active',
        },
      ],
    });

    const stream = driver.stream;
    if (stream === undefined) throw new Error('Cockroach driver did not inherit cursor streaming');
    const values: unknown[] = [];
    for await (const row of stream(
      { text: 'SELECT i::INT4 AS i FROM generate_series($1::int, $2::int) AS i ORDER BY i', parameters: [1, 5] },
      { batchSize: 2 },
    )) {
      values.push(row['i']);
    }
    expect(values).toEqual([1, 2, 3, 4, 5]);
    expect(cockroach.capabilities.cancellation).toBe(false);
  });
});
