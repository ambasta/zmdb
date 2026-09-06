import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cockroach, cockroachDriver, cockroachIntrospector, cockroachMigrations } from '@zmdb/cockroach';
import { up } from '@zmdb/migrations';
import { detectDrift } from '@zmdb/migrations/introspect';
import { createQueryCompiler, UnsupportedFeatureError } from '@zmdb/query-compiler';
import { createTransactionalDb } from '@zmdb/repository';
import { Pool } from 'pg';

const connectionString = process.env.ZMDB_COCKROACH_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('ZMDB_COCKROACH_URL is required; packed CockroachDB acceptance is fail-closed');
}

const schema = 'zmdb_issue_673';
const accountsTable = `${schema}.accounts`;
const usersTable = `${schema}.users`;
const retryCounterSqlTable = `"${schema}"."retry_counter"`;
const usersSqlTable = `"${schema}"."users"`;
const pool = new Pool({ connectionString, max: 6 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function step(name, run) {
  await run();
  process.stdout.write(`ok - ${name}\n`);
}

async function withSchema(run) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    return await run(client);
  } finally {
    client.release();
  }
}

function packageRoot(specifier) {
  return dirname(dirname(fileURLToPath(import.meta.resolve(specifier))));
}

async function manifest(specifier) {
  return JSON.parse(await readFile(join(packageRoot(specifier), 'package.json'), 'utf8'));
}

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (entry.isFile() && /\.(?:m?js|d\.ts|ts)$/.test(entry.name)) found.push(path);
  }
  return found;
}

function transactionConnection(client) {
  return {
    dialect: cockroach,
    async raw(sql) {
      await client.query(sql);
    },
    async execute(query) {
      return (await client.query(query.text, query.parameters)).rows;
    },
  };
}

async function staleReadRetry() {
  const retryClient = await pool.connect();
  const blocker = await pool.connect();
  let releaseBlocker;
  const blockerStart = new Promise(resolve => {
    releaseBlocker = resolve;
  });
  const blockerDone = (async () => {
    await blockerStart;
    await blocker.query('BEGIN');
    try {
      await blocker.query(`UPDATE "${schema}"."retry_counter" SET "value" = "value" + 1 WHERE "id" = 1`);
      await blocker.query('COMMIT');
    } catch (error) {
      await blocker.query('ROLLBACK').catch(() => {});
      throw error;
    }
  })();

  let attempts = 0;
  try {
    const result = await createTransactionalDb(transactionConnection(retryClient)).transaction(
      async transaction => {
        attempts += 1;
        const rows = await transaction.execute({
          text: 'SELECT "value" FROM ' + retryCounterSqlTable + ' WHERE "id" = 1',
          parameters: [],
        });
        const value = rows[0]?.value;
        if (typeof value !== 'number') throw new Error('retry counter did not return a number');
        if (attempts === 1) {
          releaseBlocker();
          await blockerDone;
        }
        await transaction.execute({
          text: 'UPDATE ' + retryCounterSqlTable + ' SET "value" = $1 WHERE "id" = 1',
          parameters: [value + 1],
        });
        return value + 1;
      },
      { retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } },
    );
    return { attempts, result };
  } finally {
    releaseBlocker();
    await blockerDone.catch(() => {});
    retryClient.release();
    blocker.release();
  }
}

try {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.query(`CREATE SCHEMA "${schema}"`);

  await step('executes Cockroach migrations CRUD returning and transactions', async () => {
    const accounts = cockroachMigrations.emitUp({
      kind: 'create_table',
      table: 'accounts',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'name', type: 'text', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    });
    const users = cockroachMigrations.emitUp({
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
    const foreignKey = cockroachMigrations.emitUp({
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
    const expressionIndex = cockroachMigrations.emitSchemaObject({
      kind: 'create_index',
      definition: {
        name: 'users_lower_email_idx',
        table: 'users',
        columns: [{ expr: 'lower(email)' }],
        unique: true,
        where: 'active',
      },
    })[0];
    assert(expressionIndex !== undefined, 'expression-index DDL was absent');

    const migration = {
      version: 202609060673,
      name: 'complete_cockroach_vertical',
      up: [
        `SET search_path TO "${schema}", public`,
        accounts,
        users,
        `ALTER TABLE "users" ADD COLUMN "email_key" TEXT GENERATED ALWAYS AS (lower(email)) STORED`,
        foreignKey,
        expressionIndex,
        'RESET search_path',
      ].join(';\n'),
      down: `DROP SCHEMA "${schema}" CASCADE`,
    };
    const warnings = [];
    const migrationClient = await pool.connect();
    try {
      const applied = await up(
        cockroachMigrations.connection(cockroachDriver(migrationClient), { schema }),
        [migration],
        {
          onWarning: warning => warnings.push(warning),
        },
      );
      assert(applied.length === 1 && applied[0] === migration.version, 'Cockroach migration did not apply');
    } finally {
      await migrationClient.query('RESET search_path').catch(() => {});
      migrationClient.release();
    }
    assert(
      warnings.length === 1 && warnings[0]?.startsWith('cockroach does not support transactional DDL'),
      `Cockroach migration warning changed: ${JSON.stringify(warnings)}`,
    );
    const driver = cockroachDriver(pool);
    const compiler = createQueryCompiler(cockroach);
    const account = await driver.execute(
      compiler.insertInto(accountsTable).values({ name: 'Acme' }).returning(['id']).compile(),
    );
    const accountId = account[0]?.id;
    assert(
      typeof accountId === 'string' && /^\d+$/.test(accountId) && !Number.isSafeInteger(Number(accountId)),
      'Cockroach serial did not preserve its unsafe INT8 string',
    );
    const inserted = await driver.execute(
      compiler
        .insertInto(usersTable)
        .values({ account_id: accountId, email: 'Alice@Example.test', active: true })
        .returning(['id', 'email'])
        .compile(),
    );
    const userId = inserted[0]?.id;
    assert(userId !== undefined, 'user INSERT did not return id');
    const selected = await driver.execute(compiler.selectFrom(usersTable).where('id', '=', userId).compile());
    assert(selected[0]?.email === 'Alice@Example.test', 'SELECT did not round-trip');
    const upserted = await driver.execute(
      compiler
        .insertInto(usersTable)
        .values({ id: userId, account_id: accountId, email: 'upsert@example.test', active: true })
        .onConflict('id')
        .doUpdate(['email'])
        .returning(['email'])
        .compile(),
    );
    assert(upserted[0]?.email === 'upsert@example.test', 'UPSERT RETURNING failed');
    const updated = await driver.execute(
      compiler
        .updateTable(usersTable)
        .set({ email: 'alice@example.test' })
        .where('id', '=', userId)
        .returning(['email'])
        .compile(),
    );
    assert(updated[0]?.email === 'alice@example.test', 'UPDATE RETURNING failed');
    await driver.transaction(async transaction => {
      const rows = await transaction.execute({
        text: 'SELECT "email" FROM ' + usersSqlTable + ' WHERE "id" = $1',
        parameters: [userId],
      });
      assert(rows[0]?.email === 'alice@example.test', 'transaction did not stay on Cockroach');
    });
    const deleted = await driver.execute(
      compiler.deleteFrom(usersTable).where('id', '=', userId).returning(['id']).compile(),
    );
    assert(deleted[0]?.id === userId, 'DELETE RETURNING failed');
  });

  await step('round-trips against real CockroachDB', async () => {
    const driver = cockroachDriver(pool);
    const snapshot = await cockroachIntrospector.snapshot(driver, { schemas: [schema] });
    const normalized = cockroachIntrospector.normalizeForDrift(snapshot, 'live');
    const accounts = normalized.tables.find(table => table.name === 'accounts');
    const users = normalized.tables.find(table => table.name === 'users');
    assert(
      accounts?.columns.some(column => column.name === 'id' && column.type === 'serial') === true,
      'serial was not normalized',
    );
    assert(
      users?.columns.some(column => column.name === 'account_id' && column.type === 'bigint') === true,
      'BIGINT foreign key was not normalized',
    );
    assert(users?.foreignKeys[0]?.onDelete === 'set null', 'foreign-key delete action changed');
    assert(users?.foreignKeys[0]?.onUpdate === 'cascade', 'foreign-key update action changed');
    assert(users?.indexes[0]?.name === 'users_lower_email_idx', 'Cockroach SHOW index was omitted');
    assert(users?.indexes[0]?.where === 'active', 'partial-index predicate was omitted');
    assert(
      JSON.stringify(users?.indexes[0]?.columns) === JSON.stringify([{ expr: 'lower(email)' }]),
      'expression-index column changed',
    );
    assert(snapshot.extensions.length === 0 && normalized.extensions.length === 0, 'unexpected extension drift');
    const declared = {
      version: 1,
      tables: [
        {
          name: 'accounts',
          columns: [
            { name: 'id', type: 'serial', nullable: false, primaryKey: true },
            { name: 'name', type: 'text', nullable: false, primaryKey: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          indexes: [],
        },
        {
          name: 'users',
          columns: [
            { name: 'account_id', type: 'bigint', nullable: true, primaryKey: false },
            { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
            { name: 'email', type: 'text', nullable: false, primaryKey: false },
            { name: 'email_key', type: 'text', nullable: true, primaryKey: false },
            { name: 'id', type: 'serial', nullable: false, primaryKey: true },
          ],
          primaryKey: ['id'],
          foreignKeys: [
            {
              name: 'users_account_id_fkey',
              columns: ['account_id'],
              targetTable: 'accounts',
              targetColumns: ['id'],
              onDelete: 'set null',
              onUpdate: 'cascade',
            },
          ],
          indexes: [
            {
              name: 'users_lower_email_idx',
              columns: [{ expr: 'lower(email)' }],
              unique: true,
              where: 'active',
            },
          ],
        },
      ],
      extensions: [],
    };
    const report = detectDrift(normalized, declared);
    assert(report.clean, `Cockroach drift report was not clean: ${JSON.stringify(report)}`);
  });

  await step('proves inherited capabilities and explicit Cockroach refusals', async () => {
    const sequence = cockroachMigrations.emitSchemaObject({
      kind: 'create_sequence',
      definition: { name: 'issue_673_sequence', start: 10, increment: 2 },
    })[0];
    const materialized = cockroachMigrations.emitSchemaObject({
      kind: 'create_view',
      definition: {
        name: 'issue_673_active_users',
        select: `SELECT "email" FROM "${schema}"."users" WHERE "active"`,
        materialized: true,
      },
    })[0];
    assert(sequence !== undefined && materialized !== undefined, 'inherited schema-object DDL was absent');
    await withSchema(async client => {
      await client.query(sequence);
      await client.query(materialized);
      const functionDdl = cockroachMigrations.emitSchemaObject({
        kind: 'create_routine',
        definition: {
          kind: 'function',
          name: 'issue_673_add_one',
          params: [{ name: 'value', type: 'integer' }],
          returns: { type: 'integer' },
          language: 'sql',
          body: 'SELECT value + 1',
        },
      })[0];
      const tableFunctionDdl = cockroachMigrations.emitSchemaObject({
        kind: 'create_routine',
        definition: {
          kind: 'function',
          name: 'issue_673_numbers',
          params: [{ name: 'value', type: 'integer' }],
          returns: { type: 'integer', setof: true },
          language: 'sql',
          body: 'SELECT generate_series(1, value)::INT4',
        },
      })[0];
      const procedureDdl = cockroachMigrations.emitSchemaObject({
        kind: 'create_routine',
        definition: {
          kind: 'procedure',
          name: 'issue_673_noop',
          params: [],
          language: 'sql',
          body: 'SELECT 1',
        },
      })[0];
      assert(
        functionDdl !== undefined && tableFunctionDdl !== undefined && procedureDdl !== undefined,
        'routine DDL was absent',
      );
      await client.query(functionDdl);
      await client.query(tableFunctionDdl);
      await client.query(procedureDdl);
    });
    const next = await pool.query(`SELECT nextval('"${schema}"."issue_673_sequence"') AS value`);
    assert(String(next.rows[0]?.value) === '10', 'sequence did not use inherited PostgreSQL-family DDL');
    await pool.query(`SELECT * FROM "${schema}"."issue_673_active_users"`);

    const functionResult = await pool.query(`SELECT "${schema}"."issue_673_add_one"(1) AS value`);
    assert(functionResult.rows[0]?.value === 2, 'inherited SQL function did not execute');
    const tableFunctionResult = await pool.query(`SELECT "${schema}"."issue_673_numbers"(3) AS value`);
    assert(
      JSON.stringify(tableFunctionResult.rows.map(row => row.value)) === JSON.stringify([1, 2, 3]),
      'inherited set-returning SQL function did not execute',
    );
    await pool.query(`CALL "${schema}"."issue_673_noop"()`);

    const ddlTransaction = await pool.connect();
    try {
      await ddlTransaction.query('BEGIN');
      await ddlTransaction.query(`CREATE TABLE "${schema}"."rollback_probe" ("id" INT4 PRIMARY KEY)`);
      await ddlTransaction.query('ROLLBACK');
    } finally {
      ddlTransaction.release();
    }
    const rolledBack = await pool.query(
      'SELECT count(*)::INT4 AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      [schema, 'rollback_probe'],
    );
    assert(rolledBack.rows[0]?.count === 1, 'Cockroach CREATE TABLE unexpectedly rolled back');
    assert(cockroach.capabilities.transactionalDdl === false, 'Cockroach advertised transactional DDL');
    const migrationConnection = cockroachMigrations.connection(cockroachDriver(pool));
    assert(migrationConnection.transactionalDdl === false, 'Cockroach migration connection advertised atomic DDL');
    assert(
      migrationConnection.transaction === undefined,
      'Cockroach migration connection wrapped DDL in a transaction',
    );
    await pool.query(`DROP TABLE "${schema}"."rollback_probe"`);

    const stream = cockroachDriver(pool).stream;
    assert(stream !== undefined, 'Cockroach driver omitted inherited cursor streaming');
    const streamed = [];
    for await (const row of stream(
      { text: 'SELECT i::INT4 AS i FROM generate_series($1::int, $2::int) AS i ORDER BY i', parameters: [1, 5] },
      { batchSize: 2 },
    )) {
      streamed.push(row.i);
    }
    assert(JSON.stringify(streamed) === JSON.stringify([1, 2, 3, 4, 5]), 'cursor stream changed rows');
    assert(cockroach.capabilities.cancellation === false, 'Cockroach advertised unsupported cancellation');
    let cancellationRefused = false;
    try {
      cockroachDriver(pool, { cancelVia: pool });
    } catch (error) {
      cancellationRefused =
        error instanceof UnsupportedFeatureError &&
        error.dialect === 'cockroach' &&
        error.feature === 'server-side cancellation';
    }
    assert(cancellationRefused, 'Cockroach did not refuse pg_cancel_backend-based cancellation');
  });

  await step('retries a real Cockroach serialization failure only after opt-in', async () => {
    await pool.query(`CREATE TABLE "${schema}"."retry_counter" ("id" INT4 PRIMARY KEY, "value" INT4 NOT NULL)`);
    await pool.query(`INSERT INTO "${schema}"."retry_counter" ("id", "value") VALUES (1, 0)`);
    const retried = await staleReadRetry();
    assert(retried.attempts === 2, `expected one real 40001 retry, observed ${String(retried.attempts)} attempts`);
    assert(retried.result === 2, `retry callback returned ${String(retried.result)} instead of 2`);
    const row = await pool.query(`SELECT "value" FROM "${schema}"."retry_counter" WHERE "id" = 1`);
    assert(row.rows[0]?.value === 2, 'retried transaction did not commit after the blocker');
  });

  await step('packed consumer imports no PostgreSQL internals', async () => {
    const fixture = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    const cockroachManifest = await manifest('@zmdb/cockroach');
    const postgresManifest = await manifest('@zmdb/postgres');
    const childFiles = await sourceFiles(packageRoot('@zmdb/cockroach'));
    const childSource = (await Promise.all(childFiles.map(path => readFile(path, 'utf8')))).join('\n');
    const fixtureCockroach = fixture.dependencies?.['@zmdb/cockroach'];
    const expectedParent =
      typeof fixtureCockroach === 'string' && fixtureCockroach.startsWith('file:')
        ? cockroachManifest.version
        : 'workspace:^';

    assert(fixture.dependencies?.pg === '8.23.0', 'consumer did not select pg');
    assert(
      cockroachManifest.dependencies?.['@zmdb/postgres'] === expectedParent,
      '@zmdb/cockroach did not depend on the public PostgreSQL parent',
    );
    assert(
      postgresManifest.dependencies?.['@zmdb/cockroach'] === undefined,
      '@zmdb/postgres created a reverse Cockroach dependency',
    );
    assert(!/@zmdb\/postgres(?:\/src|\/[^'"]+)/.test(childSource), 'packed child imported a PostgreSQL internal path');
    assert(cockroachManifest.dependencies?.pg === undefined, '@zmdb/cockroach made pg a hard dependency');
    assert(postgresManifest.peerDependenciesMeta?.pg?.optional === true, 'parent pg peer is not optional');
  });
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await pool.end();
}
