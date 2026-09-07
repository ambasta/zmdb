import type { JobEnqueuer, JobStore, JobStoreResource, LeaseStore } from '@zmdb/jobs';
import {
  createPgJobStore,
  pgJobEnqueuer,
  jobsPostgresMigrations,
  type PgJobStore,
  type PgJobStoreOptions,
  type PgJobClient,
  type PgJobTransactionClient,
} from '@zmdb/jobs-postgres';
import type { Client, Pool, PoolClient } from 'pg';

export function providerContracts(pool: Pool, client: Client, pinned: PoolClient): void {
  const options: PgJobStoreOptions = {
    prepared: true,
    maxCacheSize: 2,
    signal: new AbortController().signal,
    operationTimeoutMs: 1000,
    cancelVia: pool,
  };
  const clients: PgJobClient[] = [pool, client, pinned];
  const transactions: PgJobTransactionClient[] = [client, pinned];
  for (const connection of clients) {
    const store: PgJobStore = createPgJobStore(connection, options);
    const domain: JobStore & LeaseStore & JobStoreResource = store;
    void domain.close({ graceMs: 0 });
  }
  for (const connection of transactions) {
    const enqueuer: JobEnqueuer = pgJobEnqueuer(connection, options);
    void enqueuer;
  }
  void jobsPostgresMigrations[0]?.down;
}
