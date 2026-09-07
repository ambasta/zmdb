import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createApplication } from '@zmdb/app';
import { jobsExtension } from '@zmdb/jobs';
import { createMemoryJobStore, createSqliteJobStore, jobsSqliteMigrations, sqliteJobEnqueuer } from '@zmdb/jobs-sqlite';

import { qualifyProvider } from './conformance.mjs';
import { JobsApplication } from './dist/tasks.js';

await qualifyProvider({
  name: 'sqlite',
  migrations: jobsSqliteMigrations,
  async create() {
    const directory = await mkdtemp(join(process.cwd(), 'sqlite-database-'));
    const path = join(directory, 'jobs.sqlite');
    let database = new DatabaseSync(path);
    const stores = new Set();
    let current = createSqliteJobStore(database, { maxCacheSize: 2 });
    stores.add(current);
    async function query(sql) {
      const statement = database.prepare(sql);
      return statement.columns().length > 0 ? statement.all().map(row => ({ ...row })) : (statement.run(), []);
    }
    return {
      get store() {
        return current;
      },
      query,
      async exec(sql) {
        database.exec(sql);
      },
      async schemaMetadata() {
        const columns = {};
        const indexes = [];
        for (const table of ['zmdb_job', 'zmdb_job_done', 'zmdb_job_lease']) {
          columns[table] = database
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map(row => ({ name: row.name, nullable: row.notnull === 0 }));
          for (const index of database.prepare(`PRAGMA index_list(${table})`).all()) {
            if (index.origin !== 'c') continue;
            const sql = database.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(index.name).sql;
            indexes.push({
              name: index.name,
              columns: database
                .prepare(`PRAGMA index_info(${index.name})`)
                .all()
                .map(row => row.name),
              predicate: /WHERE.*'([^']+)'/i.exec(sql)?.[1],
            });
          }
        }
        return { columns, indexes };
      },
      async additional() {
        const store = createSqliteJobStore(database);
        stores.add(store);
        return store;
      },
      async reopen() {
        for (const store of stores) await store.close();
        stores.clear();
        database.close();
        database = new DatabaseSync(path);
        current = createSqliteJobStore(database);
        stores.add(current);
        return current;
      },
      async transaction(body) {
        database.exec('BEGIN');
        try {
          await body({
            query: async sql => {
              database.exec(sql);
              return [];
            },
            enqueuer: sqliteJobEnqueuer(database),
          });
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
      async rejectCompletion() {
        database.exec(
          "CREATE TRIGGER reject_completion BEFORE INSERT ON zmdb_job_done BEGIN SELECT RAISE(ABORT, 'reject completion'); END",
        );
      },
      async allowCompletion() {
        database.exec('DROP TRIGGER reject_completion');
      },
      async close() {
        try {
          for (const store of stores) await store.close();
        } finally {
          database.close();
          await rm(directory, { recursive: true });
        }
      },
    };
  },
});

await test('owned memory applies fresh migrations and closes exactly once across app and dispose', async () => {
  const store = createMemoryJobStore({ maxCacheSize: 0 });
  let closes = 0;
  const actualClose = store.database.close.bind(store.database);
  store.database.close = () => {
    closes += 1;
    actualClose();
  };
  const application = createApplication(JobsApplication, {
    graceMs: 100,
    extensions: [jobsExtension({ stores: [store, store] })],
  });
  try {
    for (const table of ['zmdb_job', 'zmdb_job_done', 'zmdb_job_lease']) {
      assert.equal(store.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    await application.init();
  } finally {
    await application[Symbol.asyncDispose]();
    await store.close();
    store[Symbol.dispose]();
  }
  assert.equal(closes, 1);
  assert.throws(() => store.database.prepare('SELECT 1'), /closed|open/i);
});

await test('SQLite invalid cache and close options never close a borrowed connection', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    for (const maxCacheSize of [-1, Infinity, NaN, 1.5]) {
      assert.throws(() => createSqliteJobStore(database, { maxCacheSize }), RangeError);
    }
    const store = createSqliteJobStore(database);
    await assert.rejects(async () => store.close({ graceMs: -1 }), RangeError);
    await store.close({ graceMs: 0 });
    assert.equal(database.prepare('SELECT 9 AS survived').get().survived, 9);
  } finally {
    database.close();
  }
});
