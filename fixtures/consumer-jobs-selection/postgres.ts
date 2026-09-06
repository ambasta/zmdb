import { createRequire } from 'node:module';

import type { JobEnqueuer, JobStore, JobStoreMigration, LeaseStore } from '@zmdb/jobs';
import {
  createPgJobStore,
  jobsPostgresMigrations,
  pgJobEnqueuer,
  type PgJobClient,
  type PgJobStore,
  type PgJobTransactionClient,
} from '@zmdb/jobs-postgres';
import type { Client, Pool, PoolClient } from 'pg';

export function publicContracts(pool: Pool, client: Client, poolClient: PoolClient): void {
  const storeFromPool: JobStore & LeaseStore = createPgJobStore(pool);
  const storeFromClient: PgJobStore = createPgJobStore(client);
  const storeFromPoolClient: PgJobStore = createPgJobStore(poolClient);
  const transactionFromClient: JobEnqueuer = pgJobEnqueuer(client);
  const transactionFromPoolClient: JobEnqueuer = pgJobEnqueuer(poolClient);
  const migrations: readonly JobStoreMigration[] = jobsPostgresMigrations;

  void storeFromPool;
  void storeFromClient;
  void storeFromPoolClient;
  void transactionFromClient;
  void transactionFromPoolClient;
  void migrations;

  // @ts-expect-error - a Pool does not identify one transaction connection.
  pgJobEnqueuer(pool);
}

const calls: string[] = [];
const client = {
  query: () => Promise.resolve({ rows: [] }),
  end: () => {
    calls.push('end');
    return Promise.resolve();
  },
  release: () => {
    calls.push('release');
  },
} as unknown as PgJobClient;
const transactionClient = client as PgJobTransactionClient;

const store = createPgJobStore(client);
const enqueuer = pgJobEnqueuer(transactionClient);
await store.close();
await store.close();
if (calls.length !== 0) throw new Error(`PostgreSQL provider took ownership of its client: ${calls.join(', ')}`);

const migrationIdentity = jobsPostgresMigrations.map(migration => [migration.version, migration.name]);
if (
  JSON.stringify(migrationIdentity) !==
  JSON.stringify([
    [20260906000100, 'jobs_queue'],
    [20260906000200, 'jobs_schedule_lease'],
  ])
) {
  throw new Error(`unexpected PostgreSQL jobs migrations: ${JSON.stringify(migrationIdentity)}`);
}

const require = createRequire(import.meta.url);
const pgManifest = require('pg/package.json') as { readonly version: string };
if (pgManifest.version !== '8.23.0') throw new Error(`expected pg 8.23.0, received ${pgManifest.version}`);

process.stdout.write(
  `${JSON.stringify({
    enqueuer: typeof enqueuer.enqueue,
    migrations: migrationIdentity,
    pg: pgManifest.version,
    resourceCalls: calls,
  })}\n`,
);
