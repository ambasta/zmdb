import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { defineRepository, ValidationError } from '@zmdb/orm';
import { schemaFromIR } from '@zmdb/schema/ir';
import { sqliteDriver } from '@zmdb/sqlite';

const schema = schemaFromIR({
  table: 'users',
  physicalTable: 'users',
  columns: [
    {
      name: 'id',
      physicalName: 'id',
      sql: 'integer',
      nullable: false,
      primaryKey: true,
      serial: true,
      unique: true,
      hasDefault: true,
      sensitive: false,
      constraints: {},
      rules: [],
    },
    {
      name: 'email',
      physicalName: 'email',
      sql: 'varchar',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: { minLength: 3 },
      rules: [],
    },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
});

const path = resolve('foundation.sqlite');
const database = new DatabaseSync(path);
let failure;
try {
  database.exec('CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL)');
  const driver = sqliteDriver(database);
  const queries = [];
  const users = defineRepository(schema, {
    dialect: driver.dialect,
    async execute(query, options) {
      queries.push(query);
      return driver.execute(query, options);
    },
  });
  const created = await users.create({ email: 'before@example.test' });
  assert.deepEqual({ ...created }, { id: 1, email: 'before@example.test' });
  assert.equal(queries[0].text, 'INSERT INTO "users" ("email") VALUES (?) RETURNING *');
  assert.deepEqual(queries[0].parameters, ['before@example.test']);
  assert.deepEqual(await users.findById(1), created);
  await users.update(1, { email: 'after@example.test' });
  assert.deepEqual({ ...(await users.findById(1)) }, { id: 1, email: 'after@example.test' });
  const beforeInvalid = queries.length;
  await assert.rejects(users.create({ email: 'x' }), ValidationError);
  assert.equal(queries.length, beforeInvalid, 'validation must precede the database write');
  const temporary = await users.create({ email: 'delete@example.test' });
  await users.delete(temporary.id);
  assert.equal(await users.findById(temporary.id), undefined);

  const rollback = new Error('foundation transaction rollback');
  await assert.rejects(
    driver.transaction(async transaction => {
      const transactionalUsers = defineRepository(schema, transaction);
      await transactionalUsers.create({ email: 'rollback@example.test' });
      await transactionalUsers.update(1, { email: 'rolled-back-update@example.test' });
      throw rollback;
    }),
    error => error === rollback,
  );
  assert.deepEqual(
    database
      .prepare('SELECT id, email FROM users ORDER BY id')
      .all()
      .map(row => ({ ...row })),
    [{ id: 1, email: 'after@example.test' }],
  );
  assert.deepEqual({ ...(await users.findById(1)) }, { id: 1, email: 'after@example.test' });
  assert.equal(
    database.prepare('SELECT 7 AS value').get().value,
    7,
    'the adapter must keep its borrowed database usable',
  );
} catch (error) {
  failure = error;
} finally {
  try {
    database.close();
  } catch (cleanup) {
    failure =
      failure === undefined ? cleanup : new AggregateError([failure, cleanup], 'application and cleanup failed');
  }
}
assert.throws(() => database.prepare('SELECT 1'), /closed|not open/i, 'the application must close its owned database');
if (failure !== undefined) throw failure;
const reopened = new DatabaseSync(path);
try {
  assert.deepEqual(
    reopened
      .prepare('SELECT id, email FROM users ORDER BY id')
      .all()
      .map(row => ({ ...row })),
    [{ id: 1, email: 'after@example.test' }],
  );
} finally {
  reopened.close();
}
