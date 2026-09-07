import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { createMemoryJobStore, createSqliteJobStore, jobsSqliteMigrations, sqliteJobEnqueuer } from '@zmdb/jobs-sqlite';

const database = new DatabaseSync(':memory:');
const store = createSqliteJobStore(database, { maxCacheSize: 8 });
try {
  for (const migration of jobsSqliteMigrations) database.exec(migration.up);
  const now = new Date('2026-09-07T00:00:00.000Z');
  const job = { id: 'installed', name: 'mail', payload: '{"to":"one"}', enqueuedAt: now, availableAt: now };
  assert.deepEqual(await sqliteJobEnqueuer(database).enqueue(job), { kind: 'inserted', jobId: 'installed' });
  assert.deepEqual(await store.candidates({ now, limit: 1 }), [{ id: 'installed', name: 'mail', enqueuedAt: now }]);
  assert.deepEqual(
    await store.claim({ ids: ['installed'], holder: 'worker', now, leaseUntil: new Date(now.getTime() + 1000) }),
    [{ id: 'installed', name: 'mail', payload: '{"to":"one"}', enqueuedAt: now, attempts: 0, holder: 'worker' }],
  );
  assert.equal(
    await store.settle({
      kind: 'done',
      jobId: 'installed',
      holder: 'worker',
      idempotencyKey: 'receipt',
      completedAt: now,
    }),
    true,
  );
  assert.equal(await store.completed('receipt'), true);
  assert.equal(database.prepare('SELECT status FROM zmdb_job WHERE id=?').get('installed').status, 'done');
  await store.close();
  assert.equal(database.prepare('SELECT 7 AS answer').get().answer, 7);
  await assert.rejects(store.completed('receipt'), /closed/);
} finally {
  await store.close();
  database.close();
}

const memory = createMemoryJobStore();
try {
  assert.deepEqual(await memory.candidates({ now: new Date('2026-09-07T00:00:00.000Z'), limit: 1 }), []);
} finally {
  await memory.close();
  memory[Symbol.dispose]();
}
assert.throws(() => memory.database.prepare('SELECT 1'), /closed|open/i);
console.log(
  '@zmdb/jobs-sqlite packed consumer: domain enqueue/claim/complete, borrowed connection and owned memory executed',
);
