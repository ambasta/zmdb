// @zmdb/web/queues/backends/pg — node-postgres adapter for the queue JobStore port.
import { pgDriver } from '@zmdb/repository/drivers/pg';
import type { PgOptions } from '@zmdb/repository/drivers/pg';
import type { Client, Pool, PoolClient } from 'pg';

import type { JobStore } from '../index.js';

/** The node-postgres clients whose query method can back a queue store. */
export type PgJobClient = Pool | PoolClient | Client;

/** Prepared-statement options are the same bounded cache exposed by the repository driver. */
export type PgJobStoreOptions = PgOptions;

/**
 * Adapt a caller-owned node-postgres client to JobStore.
 *
 * `pg` is an optional peer: importing the core queue module does not load it, and
 * this adapter neither creates nor closes the caller's pool/client.
 */
export function createPgJobStore(client: PgJobClient, options?: PgJobStoreOptions): JobStore {
  const driver = pgDriver(client, options);
  return {
    dialect: 'postgres',
    execute: query => driver.execute(query),
  };
}
