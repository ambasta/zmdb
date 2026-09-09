// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { DatabaseSync } from 'node:sqlite';

import type { JobEnqueuer, JobStore, JobStoreMigration, JobStoreResource, LeaseStore } from '@zmdb/jobs';
import type { SqliteDatabase } from '@zmdb/sqlite';

import type {
  createMemoryJobStore,
  createSqliteJobStore,
  jobsSqliteMigrations,
  sqliteJobEnqueuer,
  MemoryJobStore,
  SqliteJobStore,
  SqliteJobStoreOptions,
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;
export type StoreKeys = Expect<Equal<keyof SqliteJobStore, keyof (JobStore & LeaseStore & JobStoreResource)>>;
export type Options = Expect<Equal<SqliteJobStoreOptions, { readonly maxCacheSize?: number }>>;
export type Factory = Expect<
  Equal<typeof createSqliteJobStore, (database: SqliteDatabase, options?: SqliteJobStoreOptions) => SqliteJobStore>
>;
export type Enqueuer = Expect<Equal<typeof sqliteJobEnqueuer, (database: SqliteDatabase) => JobEnqueuer>>;
export type MemoryFactory = Expect<
  Equal<typeof createMemoryJobStore, (options?: SqliteJobStoreOptions) => MemoryJobStore>
>;
export type OwnedDatabase = Expect<Equal<MemoryJobStore['database'], DatabaseSync>>;
export type Migrations = Expect<Equal<typeof jobsSqliteMigrations, readonly JobStoreMigration[]>>;
