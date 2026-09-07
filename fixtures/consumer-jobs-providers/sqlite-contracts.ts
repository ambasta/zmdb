import type { DatabaseSync } from 'node:sqlite';

import type { JobEnqueuer, JobStore, JobStoreResource, LeaseStore } from '@zmdb/jobs';
import {
  createMemoryJobStore,
  createSqliteJobStore,
  sqliteJobEnqueuer,
  jobsSqliteMigrations,
  type MemoryJobStore,
  type SqliteJobStore,
  type SqliteJobStoreOptions,
} from '@zmdb/jobs-sqlite';

export function providerContracts(database: DatabaseSync): void {
  const options: SqliteJobStoreOptions = { maxCacheSize: 2 };
  const store: SqliteJobStore = createSqliteJobStore(database, options);
  const domain: JobStore & LeaseStore & JobStoreResource = store;
  const enqueuer: JobEnqueuer = sqliteJobEnqueuer(database);
  const memory: MemoryJobStore = createMemoryJobStore(options);
  void memory.close({ graceMs: 0 });
  memory[Symbol.dispose]();
  void domain;
  void enqueuer;
  void jobsSqliteMigrations[0]?.up;
}
