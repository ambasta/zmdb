import type { JobStore } from '@zmdb/jobs';
import type { Client, Pool, PoolClient } from 'pg';

import { createPgJobStore, type PgJobClient, type PgJobStoreOptions } from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

export type _ClientUnion = Expect<Equal<PgJobClient, Pool | PoolClient | Client>>;
export type _OptionKeys = Expect<Equal<keyof PgJobStoreOptions, 'cancelVia' | 'maxCacheSize' | 'prepared'>>;
export type _FactoryReturn = Expect<Equal<ReturnType<typeof createPgJobStore>, JobStore>>;

export function poolStore(pool: Pool): JobStore {
  return createPgJobStore(pool);
}

export function poolClientStore(client: PoolClient): JobStore {
  return createPgJobStore(client);
}

export function clientStore(client: Client): JobStore {
  return createPgJobStore(client, { prepared: true, maxCacheSize: 32, cancelVia: client });
}

export function rejectsArbitraryStore(store: JobStore): void {
  // @ts-expect-error - the adapter requires a node-postgres Pool, PoolClient, or Client.
  createPgJobStore(store);
}
