// @zmdb/jobs-postgres — caller-owned node-postgres adapter for JobStore.
import type { JobStore } from '@zmdb/jobs';
import { pgDriver } from '@zmdb/repository/drivers/pg';
import type { Client, Pool, PoolClient } from 'pg';

/** The node-postgres clients whose query method can back a job store. */
export type PgJobClient = Pool | PoolClient | Client;

/** Bounded prepared-statement and cancellation options delegated to the PostgreSQL driver. */
export interface PgJobStoreOptions {
  readonly prepared?: boolean;
  readonly maxCacheSize?: number;
  readonly cancelVia?: PgJobClient;
}

/**
 * Adapt a caller-owned node-postgres client to the jobs package's structural store.
 *
 * The adapter creates no connection, exposes no close method and never ends or releases the
 * supplied client.
 */
export function createPgJobStore(client: PgJobClient, options?: PgJobStoreOptions): JobStore {
  const driver = pgDriver(client, options);
  return {
    dialect: 'postgres',
    execute: query => driver.execute(query),
  };
}
