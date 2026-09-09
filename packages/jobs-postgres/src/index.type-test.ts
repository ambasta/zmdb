// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { JobEnqueuer, JobStore, JobStoreMigration, JobStoreResource, LeaseStore } from '@zmdb/jobs';
import type { Client, Pool, PoolClient } from 'pg';

import {
  createPgJobStore,
  type jobsPostgresMigrations,
  type pgJobEnqueuer,
  type PgJobClient,
  type PgJobStore,
  type PgJobStoreOptions,
  type PgJobTransactionClient,
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

export type _ClientUnion = Expect<Equal<PgJobClient, Pool | PoolClient | Client>>;
export type _OptionKeys = Expect<
  Equal<keyof PgJobStoreOptions, 'cancelVia' | 'maxCacheSize' | 'prepared' | 'signal' | 'operationTimeoutMs'>
>;
export type _FactoryReturn = Expect<Equal<ReturnType<typeof createPgJobStore>, PgJobStore>>;
export type _TransactionClient = Expect<Equal<PgJobTransactionClient, PoolClient | Client>>;
export type _StoreKeys = Expect<Equal<keyof PgJobStore, keyof (JobStore & LeaseStore & JobStoreResource)>>;
export type _Factory = Expect<
  Equal<typeof createPgJobStore, (client: PgJobClient, options?: PgJobStoreOptions) => PgJobStore>
>;
export type _Enqueuer = Expect<
  Equal<typeof pgJobEnqueuer, (client: PgJobTransactionClient, options?: PgJobStoreOptions) => JobEnqueuer>
>;
export type _Migrations = Expect<Equal<typeof jobsPostgresMigrations, readonly JobStoreMigration[]>>;

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
