import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  postgres,
  postgresDriver,
  postgresIntrospector,
  postgresOutboxPendingIndexDdl,
  postgresOutboxTableDdl,
} from '@zmdb/postgres';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { up } from '@zmdb/query-compiler/migrations';
import { outboxCandidatesQuery } from '@zmdb/query-compiler/outbox';
import { Pool } from 'pg';

const connectionString = process.env.ZMDB_POSTGRES_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('ZMDB_POSTGRES_URL is required; packed PostgreSQL acceptance is fail-closed');
}

const schema = 'zmdb_issue_670';
const usersTable = 'zmdb_issue_670.users';
const pool = new Pool({ connectionString, max: 4 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function step(name, run) {
  await run();
  process.stdout.write(`ok - ${name}\n`);
}

function packageRoot(specifier) {
  return dirname(dirname(fileURLToPath(import.meta.resolve(specifier))));
}

async function manifest(specifier) {
  return JSON.parse(await readFile(join(packageRoot(specifier), 'package.json'), 'utf8'));
}

try {
  await pool.query('DROP SCHEMA IF EXISTS "zmdb_issue_670" CASCADE');
  await pool.query('CREATE SCHEMA "zmdb_issue_670"');

  await step('packed consumer executes migrations and CRUD against PostgreSQL', async () => {
    const accounts = postgres.migrations.emitUp({
      kind: 'create_table',
      table: 'accounts',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'name', type: 'text', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    });
    const users = postgres.migrations.emitUp({
      kind: 'create_table',
      table: 'users',
      columns: [
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'account_id', type: 'integer', nullable: true, primaryKey: false },
        { name: 'email', type: { extension: 'citext', name: 'citext' }, nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    });
    const foreignKey = postgres.migrations.emitUp({
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
    const expressionIndex = postgres.migrations.emitSchemaObject({
      kind: 'create_index',
      definition: {
        name: 'users_lower_email_idx',
        table: 'users',
        columns: [{ expr: 'lower(email::text)' }],
        unique: true,
        where: 'account_id IS NOT NULL',
      },
    })[0];
    const migration = {
      version: 202609050670,
      name: 'complete_postgres_vertical',
      up: [
        'SET LOCAL search_path TO "zmdb_issue_670", public',
        'CREATE EXTENSION IF NOT EXISTS "citext"',
        accounts,
        users,
        `ALTER TABLE "users" ADD COLUMN "email_key" TEXT GENERATED ALWAYS AS (lower(email::text)) STORED`,
        foreignKey,
        expressionIndex,
      ].join(';\n'),
      down: 'DROP SCHEMA "zmdb_issue_670" CASCADE',
    };

    const driver = postgresDriver(pool);
    const applied = await up(postgres.migrations.connection(driver, { schema }), [migration]);
    assert(applied.length === 1 && applied[0] === migration.version, 'migration did not apply');

    const compiler = createQueryCompiler(postgres);
    const account = await driver.execute(
      compiler.insertInto('zmdb_issue_670.accounts').values({ name: 'Acme' }).returning(['id']).compile(),
    );
    const accountId = account[0]?.id;
    assert(typeof accountId === 'number', 'account INSERT did not return id');
    const inserted = await driver.execute(
      compiler
        .insertInto(usersTable)
        .values({ account_id: accountId, email: 'Alice@Example.test' })
        .returning(['id', 'email'])
        .compile(),
    );
    const userId = inserted[0]?.id;
    assert(typeof userId === 'number', 'user INSERT did not return id');
    const selected = await driver.execute(compiler.selectFrom(usersTable).where('id', '=', userId).compile());
    assert(selected[0]?.email === 'Alice@Example.test', 'SELECT did not round-trip');
    const updated = await driver.execute(
      compiler
        .updateTable(usersTable)
        .set({ email: 'alice@example.test' })
        .where('id', '=', userId)
        .returning(['email'])
        .compile(),
    );
    assert(updated[0]?.email === 'alice@example.test', 'UPDATE RETURNING failed');
    const fts = await driver.execute(
      ftsSelectFrom(usersTable, postgres).whereMatch('email', 'alice@example.test').compile(),
    );
    assert(fts.length === 1, 'full-text query failed');
    await driver.transaction(async transaction => {
      await transaction.execute({ text: 'SET LOCAL search_path TO "zmdb_issue_670", public', parameters: [] });
      await transaction.execute({ text: postgresOutboxTableDdl(), parameters: [] });
      await transaction.execute({ text: postgresOutboxPendingIndexDdl(), parameters: [] });
      const candidates = await transaction.execute(outboxCandidatesQuery(postgres, { now: new Date(0), batch: 5 }));
      assert(candidates.length === 0, 'new outbox was not empty');
      await transaction.execute({ text: 'DROP TABLE "zmdb_outbox"', parameters: [] });
    });
    const deleted = await driver.execute(
      compiler.deleteFrom(usersTable).where('id', '=', userId).returning(['id']).compile(),
    );
    assert(deleted[0]?.id === userId, 'DELETE RETURNING failed');
  });

  await step('round-trips a schema through PostgreSQL and introspection', async () => {
    const snapshot = await postgresIntrospector.snapshot(postgresDriver(pool), { schemas: [schema] });
    assert(
      snapshot.tables.some(table => table.name === 'accounts'),
      'introspection omitted accounts',
    );
    assert(
      snapshot.tables.some(table => table.name === 'users'),
      'introspection omitted users',
    );
    assert(
      postgresIntrospector.normalizeForDrift(snapshot, 'live').tables.length === 2,
      'normalization changed tables',
    );
  });

  await step('preserves extensions expression indexes and referential actions', async () => {
    const snapshot = await postgresIntrospector.snapshot(postgresDriver(pool), { schemas: [schema] });
    const users = snapshot.tables.find(table => table.name === 'users');
    assert(
      snapshot.extensions.some(extension => extension.name === 'citext'),
      'citext was omitted',
    );
    assert(users?.foreignKeys[0]?.onDelete === 'set null', 'foreign-key delete action changed');
    assert(users?.foreignKeys[0]?.onUpdate === 'cascade', 'foreign-key update action changed');
    assert(users?.indexes[0]?.where?.includes('account_id IS NOT NULL') === true, 'partial predicate was omitted');
    assert(
      Reflect.get(users?.columns.find(column => column.name === 'email_key') ?? {}, 'generated') !== undefined,
      'generated column was omitted',
    );
  });

  await step('streams through a cursor and releases an abandoned connection', async () => {
    const stream = postgresDriver(pool).stream;
    assert(stream !== undefined, 'pool-backed driver omitted stream');
    for await (const row of stream(
      { text: 'SELECT i FROM generate_series($1::int, $2::int) AS i ORDER BY i', parameters: [1, 20] },
      { batchSize: 3 },
    )) {
      assert(row.i === 1, 'cursor returned an unexpected first row');
      break;
    }
    await pool.query('SELECT 1');
    assert(pool.waitingCount === 0 && pool.idleCount === pool.totalCount, 'abandoned cursor leaked a client');
  });

  await step('cancels through a second PostgreSQL connection', async () => {
    const controller = new AbortController();
    const reason = new Error('packed deadline');
    const started = performance.now();
    const pending = postgresDriver(pool, { cancelVia: pool }).execute(
      { text: 'SELECT pg_sleep(10)', parameters: [] },
      { signal: controller.signal },
    );
    const timer = setTimeout(() => controller.abort(reason), 100);
    try {
      await pending.then(
        () => {
          throw new Error('cancelled query unexpectedly completed');
        },
        error => {
          if (error !== reason) throw error;
        },
      );
    } finally {
      clearTimeout(timer);
    }
    assert(performance.now() - started < 3_000, 'server-side cancellation did not interrupt pg_sleep');
  });

  await step('keeps a transaction on one checked-out client', async () => {
    let firstPid;
    await postgresDriver(pool).transaction(async transaction => {
      const first = await transaction.execute({ text: 'SELECT pg_backend_pid() AS pid', parameters: [] });
      const second = await transaction.execute({ text: 'SELECT pg_backend_pid() AS pid', parameters: [] });
      firstPid = first[0]?.pid;
      assert(firstPid === second[0]?.pid, 'transaction crossed clients');
    });
    assert(typeof firstPid === 'number', 'transaction exposed no backend pid');
  });

  await step('deallocates an evicted prepared statement', async () => {
    const client = await pool.connect();
    try {
      const driver = postgresDriver(client, { prepared: true, maxCacheSize: 1 });
      await driver.execute({ text: 'SELECT $1::int', parameters: [1] });
      const before = await client.query("SELECT name FROM pg_prepared_statements WHERE name LIKE 'zmdb_%'");
      await driver.execute({ text: 'SELECT ($1::int + 1)', parameters: [1] });
      const after = await client.query("SELECT name FROM pg_prepared_statements WHERE name LIKE 'zmdb_%'");
      assert(before.rows.length === 1 && after.rows.length === 1, 'prepared cache bound changed');
      assert(before.rows[0]?.name !== after.rows[0]?.name, 'evicted statement remained on the server');
    } finally {
      client.release();
    }
  });

  await step('installs pg only because the packed consumer selected it', async () => {
    const fixture = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    const postgresManifest = await manifest('@zmdb/postgres');
    const repositoryManifest = await manifest('@zmdb/repository');
    const compilerManifest = await manifest('@zmdb/query-compiler');
    assert(fixture.dependencies?.pg === '8.23.0', 'consumer did not select pg');
    assert(postgresManifest.dependencies?.pg === undefined, '@zmdb/postgres made pg a dependency');
    assert(postgresManifest.peerDependenciesMeta?.pg?.optional === true, 'pg peer is not optional');
    assert(repositoryManifest.dependencies?.pg === undefined, '@zmdb/repository depends on pg');
    assert(compilerManifest.dependencies?.pg === undefined, '@zmdb/query-compiler depends on pg');
  });
} finally {
  await pool.query('DROP SCHEMA IF EXISTS "zmdb_issue_670" CASCADE').catch(() => {});
  await pool.end();
}
