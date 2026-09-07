import type { DatabaseSync } from 'node:sqlite';

import type { JobEnqueuer, JobStore, JobStoreMigration, JobStoreResource, LeaseStore } from '@zmdb/jobs';
import {
  createMemoryJobStore,
  createSqliteJobStore,
  jobsSqliteMigrations,
  sqliteJobEnqueuer,
  type MemoryJobStore,
  type SqliteJobStoreOptions,
} from '@zmdb/jobs-sqlite';

export const migrations: readonly JobStoreMigration[] = jobsSqliteMigrations;

export function fromDatabase(database: DatabaseSync): JobStore & LeaseStore & JobStoreResource {
  const options: SqliteJobStoreOptions = { maxCacheSize: 8 };
  return createSqliteJobStore(database, options);
}

export function fromTransaction(database: DatabaseSync): JobEnqueuer {
  return sqliteJobEnqueuer(database);
}

export function ownedMemory(): MemoryJobStore {
  return createMemoryJobStore({ maxCacheSize: 0 });
}

export function rejectsStore(store: JobStore): void {
  // @ts-expect-error - a domain JobStore is not a SQLite database connection.
  createSqliteJobStore(store);
}
