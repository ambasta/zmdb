import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { createMemoryJobStore, createSqliteJobStore, jobsSqliteMigrations } from './index.js';

describe('@zmdb/jobs-sqlite explicit storage owner', () => {
  it('ships owned memory with the complete fresh schema and no SQL-shaped public port', () => {
    using store = createMemoryJobStore();
    const objects = store.database
      .prepare("SELECT name, type FROM sqlite_master WHERE name LIKE 'zmdb_%' ORDER BY name")
      .all();
    expect(objects).toEqual([
      { name: 'zmdb_job', type: 'table' },
      { name: 'zmdb_job_dead', type: 'index' },
      { name: 'zmdb_job_done', type: 'table' },
      { name: 'zmdb_job_lease', type: 'table' },
      { name: 'zmdb_job_lease_expiry', type: 'index' },
      { name: 'zmdb_job_pending', type: 'index' },
      { name: 'zmdb_job_schedule_expiry', type: 'index' },
    ]);
    expect(store).not.toHaveProperty('dialect');
    expect(store).not.toHaveProperty('execute');
    expect(
      store.database
        .prepare('PRAGMA table_info(zmdb_job)')
        .all()
        .map(row => row['name']),
    ).toEqual([
      'id',
      'name',
      'payload',
      'status',
      'attempts',
      'enqueued_at',
      'dedupe_key',
      'lease_owner',
      'lease_until',
      'last_error',
      'dead_reason',
      'dead_detail',
      'dead_at',
    ]);
  });

  it('keeps the portable manifest database-free and the SQLite provider minimal', () => {
    const jobs: unknown = JSON.parse(readFileSync(new URL('../../jobs/package.json', import.meta.url), 'utf8'));
    const provider: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(jobs).toMatchObject({ dependencies: { '@zmdb/app': 'workspace:^' } });
    expect(jobs).toHaveProperty('exports', { '.': './src/index.ts', './schedule': './src/schedule/index.ts' });
    expect(jobs).not.toHaveProperty('peerDependencies');
    expect(jobs).not.toHaveProperty('optionalDependencies');
    expect(provider).toHaveProperty('dependencies', { '@zmdb/sqlite': 'workspace:1.0.0-beta.1' });
    expect(provider).toHaveProperty('devDependencies.@zmdb/jobs', 'workspace:^');
    expect(provider).toHaveProperty('exports', { '.': './src/index.ts' });
    expect(provider).toHaveProperty('peerDependencies', { '@zmdb/jobs': '1.0.0-beta.1' });
    expect(provider).not.toHaveProperty('peerDependenciesMeta');
  });

  it('refuses invalid bounds and post-close calls without closing borrowed SQLite', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      expect(() => createSqliteJobStore(database, { maxCacheSize: -1 })).toThrow(RangeError);
      const store = createSqliteJobStore(database);
      for (const migration of jobsSqliteMigrations) database.exec(migration.up);
      await expect(store.candidates({ now: new Date(), limit: 0 })).rejects.toThrow(RangeError);
      await expect(store.candidates({ now: new Date(NaN), limit: 1 })).rejects.toThrow(RangeError);
      await expect(store.acquire('task', 'holder', Infinity)).rejects.toThrow(RangeError);
      await expect(
        store.claim({ ids: [], holder: 'holder', now: new Date(10), leaseUntil: new Date(5) }),
      ).rejects.toThrow(RangeError);
      await store.close({ graceMs: 0 });
      await store.close();
      await expect(store.completed('key')).rejects.toThrow('@zmdb/jobs-sqlite: store is closed');
      expect(database.prepare('SELECT 1 AS survived').get()).toEqual({ survived: 1 });
    } finally {
      database.close();
    }
  });
});
