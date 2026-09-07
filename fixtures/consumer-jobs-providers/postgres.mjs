import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createPgJobStore, jobsPostgresMigrations, pgJobEnqueuer } from '@zmdb/jobs-postgres';
import { Client, Pool } from 'pg';

import { qualifyProvider } from './conformance.mjs';

assert(process.env.ZMDB_PG, 'ZMDB_PG must name the isolated real PostgreSQL server');
const connection = process.env.ZMDB_PG;
const administration = new Pool({ connectionString: connection, connectionTimeoutMillis: 1000, max: 2 });

async function databaseFixture() {
  const name = `issue756_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  await administration.query(`CREATE DATABASE ${name}`);
  const url = new URL(connection);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 1000, max: 4 });
  const cancellation = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 1000, max: 1 });
  const stores = new Set();
  const options = { cancelVia: cancellation, operationTimeoutMs: 3000 };
  let current = createPgJobStore(pool, options);
  stores.add(current);
  return {
    pool,
    cancellation,
    connectionString: url.toString(),
    get store() {
      return current;
    },
    async query(sql) {
      return (await pool.query(sql)).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async schemaMetadata() {
      const columns = {};
      for (const table of ['zmdb_job', 'zmdb_job_done', 'zmdb_job_lease']) {
        columns[table] = (
          await pool.query(
            'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
            ['public', table],
          )
        ).rows.map(row => ({ name: row.column_name, nullable: row.is_nullable === 'YES' }));
      }
      const indexes = (
        await pool.query(
          "SELECT i.relname AS name, pg_get_indexdef(i.oid) AS definition, pg_get_expr(x.indpred,x.indrelid) AS predicate FROM pg_class i JOIN pg_index x ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid WHERE t.relname IN ('zmdb_job','zmdb_job_done','zmdb_job_lease') AND NOT x.indisprimary AND NOT x.indisunique ORDER BY i.relname",
        )
      ).rows.map(row => ({
        name: row.name,
        columns: /USING btree \(([^)]+)\)/
          .exec(row.definition)[1]
          .split(',')
          .map(column => column.trim()),
        predicate: /'([^']+)'/.exec(row.predicate ?? '')?.[1],
      }));
      return { columns, indexes };
    },
    async additional() {
      const store = createPgJobStore(pool, options);
      stores.add(store);
      return store;
    },
    async reopen() {
      await current.close();
      current = createPgJobStore(pool, options);
      stores.add(current);
      return current;
    },
    async transaction(body) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await body({
            query: async sql => (await client.query(sql)).rows,
            enqueuer: pgJobEnqueuer(client, options),
          });
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        client.release();
      }
    },
    async rejectCompletion() {
      await pool.query(
        "CREATE FUNCTION reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reject completion'; END $$; CREATE TRIGGER reject_completion BEFORE INSERT ON zmdb_job_done FOR EACH ROW EXECUTE FUNCTION reject_completion()",
      );
    },
    async allowCompletion() {
      await pool.query('DROP TRIGGER reject_completion ON zmdb_job_done; DROP FUNCTION reject_completion()');
    },
    async close() {
      const errors = [];
      for (const store of stores) {
        try {
          await store.close();
        } catch (error) {
          errors.push(error);
        }
      }
      await pool.end();
      await cancellation.end();
      await administration.query(`DROP DATABASE ${name}`);
      if (errors.length) throw new AggregateError(errors, 'provider cleanup failed');
    },
  };
}

const job = { id: 'blocked', name: 'deliver', payload: '{"id":1}', enqueuedAt: new Date(), availableAt: new Date() };

async function until(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await delay(5);
  }
  assert.fail(message);
}

try {
  await administration.query('SELECT 1');
  await qualifyProvider({ name: 'postgres', migrations: jobsPostgresMigrations, create: databaseFixture });

  await test(
    'PostgreSQL accepts real PoolClient and Client without owning their shutdown',
    { timeout: 10_000 },
    async () => {
      const context = await databaseFixture();
      for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
      const supplied = await context.pool.connect();
      const client = new Client({ connectionString: context.connectionString });
      await client.connect();
      try {
        assert.throws(() => pgJobEnqueuer(context.pool), /transaction enqueue requires a pinned client/);
        for (const borrowed of [supplied, client]) {
          const store = createPgJobStore(borrowed, { operationTimeoutMs: 1000 });
          await store.enqueue({ ...job, id: globalThis.crypto.randomUUID() });
          await store.close();
          await store.close();
          assert.equal((await borrowed.query('SELECT 8 AS survived')).rows[0].survived, 8);
        }
      } finally {
        supplied.release();
        await client.end();
        await context.close();
      }
    },
  );

  await test(
    'PostgreSQL prepared statement cache is bounded on the borrowed connection',
    { timeout: 10_000 },
    async () => {
      const context = await databaseFixture();
      for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
      const client = await context.pool.connect();
      const store = createPgJobStore(client, { prepared: true, maxCacheSize: 1, operationTimeoutMs: 1000 });
      try {
        await store.completed('missing');
        await store.completed('other');
        assert.equal((await client.query('SELECT * FROM pg_prepared_statements')).rows.length, 1);
        await store.listDead({ limit: 1 });
        const prepared = (await client.query('SELECT * FROM pg_prepared_statements')).rows;
        assert.equal(prepared.length, 1);
        assert(prepared[0].statement.includes('dead'));
        await store.close();
        assert.equal((await client.query('SELECT 11 AS survived')).rows[0].survived, 11);
      } finally {
        await store.close();
        client.release();
        await context.close();
      }
    },
  );

  for (const cancellationMode of ['out-of-band', 'bounded-wait-only']) {
    await test(
      `PostgreSQL deadline uses ${cancellationMode} and never reports premature cleanup`,
      { timeout: 10_000 },
      async () => {
        const context = await databaseFixture();
        for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
        const lock = await context.pool.connect();
        const workPool = new Pool({
          connectionString: context.connectionString,
          connectionTimeoutMillis: 1000,
          max: 1,
        });
        const store = createPgJobStore(workPool, {
          operationTimeoutMs: 100,
          ...(cancellationMode === 'out-of-band' ? { cancelVia: context.cancellation } : {}),
        });
        let closing;
        try {
          await lock.query('BEGIN');
          await lock.query('LOCK TABLE zmdb_job IN ACCESS EXCLUSIVE MODE');
          const started = performance.now();
          await assert.rejects(store.enqueue(job), {
            name: 'TimeoutError',
            message: '@zmdb/jobs-postgres: operation deadline exceeded; database outcome may be incomplete',
          });
          assert(performance.now() - started < 1000, 'operation did not honor its one bound');
          closing = store.close({ graceMs: 100 });
          if (cancellationMode === 'bounded-wait-only') {
            await assert.rejects(closing, {
              name: 'TimeoutError',
              message: '@zmdb/jobs-postgres: shutdown deadline exceeded; cleanup incomplete',
            });
          } else {
            await closing;
            assert.equal(workPool.totalCount, workPool.idleCount);
          }
          await assert.rejects(store.completed('blocked'), /store is closed/);
        } finally {
          await lock.query('ROLLBACK');
          lock.release();
          await closing?.catch(() => undefined);
          for (let attempt = 0; attempt < 100 && workPool.totalCount !== workPool.idleCount; attempt += 1)
            await delay(10);
          assert.equal(
            workPool.totalCount,
            workPool.idleCount,
            'an internal acquisition remained busy after lock release',
          );
          await workPool.end();
          await context.close();
        }
      },
    );
  }

  await test(
    'PostgreSQL pre-abort refuses SQL and preserves its exact lifetime reason',
    { timeout: 10_000 },
    async () => {
      const context = await databaseFixture();
      for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
      const controller = new AbortController();
      const reason = new Error('caller lifetime ended');
      controller.abort(reason);
      const aborted = createPgJobStore(context.pool, {
        signal: controller.signal,
        cancelVia: context.cancellation,
        operationTimeoutMs: 1000,
      });
      try {
        await assert.rejects(aborted.enqueue(job), error => error === reason);
        assert.equal((await context.query('SELECT COUNT(*) AS count FROM zmdb_job'))[0].count, '0');
        await aborted.close();
        assert.equal((await context.query('SELECT 13 AS survived'))[0].survived, 13);
      } finally {
        await aborted.close();
        await context.close();
      }
    },
  );

  for (const mode of ['lifetime', 'close']) {
    await test(
      `PostgreSQL ${mode} cancellation stops a real blocked operation and releases its acquisition`,
      { timeout: 10_000 },
      async () => {
        const context = await databaseFixture();
        for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
        const lock = await context.pool.connect();
        const workPool = new Pool({
          connectionString: context.connectionString,
          max: 1,
          connectionTimeoutMillis: 1000,
        });
        const controller = new AbortController();
        const reason = new Error('active lifetime ended');
        const store = createPgJobStore(workPool, {
          signal: controller.signal,
          cancelVia: context.cancellation,
          operationTimeoutMs: 2000,
        });
        let pending;
        try {
          await lock.query('BEGIN');
          await lock.query('LOCK TABLE zmdb_job IN ACCESS EXCLUSIVE MODE');
          pending = store.enqueue(job).then(
            value => ({ value }),
            error => ({ error }),
          );
          await until(
            async () =>
              (
                await context.query(
                  "SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%zmdb_job%'",
                )
              )[0].count !== '0',
            'operation never reached the real database lock',
          );
          if (mode === 'lifetime') controller.abort(reason);
          const closing = mode === 'close' ? store.close({ graceMs: 1000 }) : undefined;
          const outcome = await pending;
          assert(outcome.error instanceof Error);
          if (mode === 'lifetime') assert.equal(outcome.error, reason);
          await closing;
          await until(() => workPool.totalCount === workPool.idleCount, 'cancelled operation retained an acquisition');
          if (mode === 'lifetime') await assert.rejects(store.completed('next'), error => error === reason);
          const firstClose = store.close({ graceMs: 1000 });
          assert.equal(store.close({ graceMs: 0 }), firstClose, 'repeated close refreshed its promise/budget');
          await firstClose;
        } finally {
          await lock.query('ROLLBACK');
          lock.release();
          await pending;
          await store.close().catch(() => undefined);
          await workPool.end();
          await context.close();
        }
      },
    );
  }

  await test('PostgreSQL late acquisition releases without running business SQL', { timeout: 10_000 }, async () => {
    const context = await databaseFixture();
    for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
    const pool = new Pool({ connectionString: context.connectionString, max: 1, connectionTimeoutMillis: 1000 });
    const occupied = await pool.connect();
    const store = createPgJobStore(pool, { operationTimeoutMs: 40 });
    try {
      await assert.rejects(store.enqueue(job), { name: 'TimeoutError' });
      occupied.release();
      await until(
        () => pool.waitingCount === 0 && pool.totalCount === pool.idleCount,
        'late acquisition was not returned',
      );
      assert.equal((await context.query('SELECT COUNT(*) AS count FROM zmdb_job'))[0].count, '0');
      await store.close();
    } finally {
      if (pool.idleCount === 0 && pool.waitingCount !== 0) occupied.release();
      await store.close().catch(() => undefined);
      await pool.end();
      await context.close();
    }
  });

  await test('PostgreSQL retains serialization until timed-out SQL rolls back', { timeout: 10_000 }, async () => {
    const context = await databaseFixture();
    for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
    const lock = await context.pool.connect();
    const client = new Client({ connectionString: context.connectionString });
    await client.connect();
    const observed = [];
    const query = client.query.bind(client);
    client.query = (...arguments_) => {
      observed.push(typeof arguments_[0] === 'string' ? arguments_[0] : arguments_[0].text);
      return query(...arguments_);
    };
    const store = createPgJobStore(client, { operationTimeoutMs: 50 });
    try {
      await lock.query('BEGIN');
      await lock.query('LOCK TABLE zmdb_job IN ACCESS EXCLUSIVE MODE');
      await assert.rejects(store.enqueue(job), { name: 'TimeoutError' });
      await assert.rejects(store.enqueue({ ...job, id: 'queued' }), { name: 'TimeoutError' });
      assert.equal(
        observed.filter(sql => /^BEGIN\b/i.test(sql)).length,
        1,
        'a timed-out promise released its live serialization slot',
      );
      await lock.query('ROLLBACK');
      await until(
        () => observed.some(sql => /^ROLLBACK\b/i.test(sql)),
        'owned rollback never ran after blocked SQL returned',
      );
      await store.close({ graceMs: 1000 });
      assert.equal(observed.filter(sql => /^COMMIT\b/i.test(sql)).length, 0, 'aborted work committed');
      assert.equal((await context.query('SELECT COUNT(*) AS count FROM zmdb_job'))[0].count, '0');
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await store.close().catch(() => undefined);
      await client.end();
      await context.close();
    }
  });

  for (const mode of ['begin-failure', 'body-and-rollback-failure']) {
    await test(`PostgreSQL preserves transaction error ownership for ${mode}`, { timeout: 10_000 }, async () => {
      const context = await databaseFixture();
      for (const migration of jobsPostgresMigrations) await context.exec(migration.up);
      const client = new Client({ connectionString: context.connectionString });
      await client.connect();
      const actualQuery = client.query.bind(client);
      const primary = new Error(mode);
      const rollback = new Error('rollback failed');
      const commands = [];
      client.query = (...arguments_) => {
        const sql = typeof arguments_[0] === 'string' ? arguments_[0] : arguments_[0].text;
        commands.push(sql);
        if (mode === 'begin-failure' && /^BEGIN\b/i.test(sql)) return Promise.reject(primary);
        if (mode === 'body-and-rollback-failure' && /^INSERT\b/i.test(sql)) return Promise.reject(primary);
        if (mode === 'body-and-rollback-failure' && /^ROLLBACK\b/i.test(sql)) return Promise.reject(rollback);
        return actualQuery(...arguments_);
      };
      const store = createPgJobStore(client, { operationTimeoutMs: 1000 });
      try {
        const error = await store.enqueue(job).then(
          () => undefined,
          rejected => rejected,
        );
        if (mode === 'begin-failure') {
          assert.equal(error, primary);
          assert.equal(commands.filter(sql => /^ROLLBACK\b/i.test(sql)).length, 0);
        } else {
          assert(error instanceof AggregateError);
          assert.deepEqual(error.errors, [primary, rollback]);
        }
      } finally {
        client.query = actualQuery;
        await client.query('ROLLBACK');
        await store.close();
        await client.end();
        await context.close();
      }
    });
  }
} finally {
  await administration.end();
}
