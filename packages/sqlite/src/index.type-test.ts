// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type DatabaseVertical, type TransactionalDriver } from '@zmdb/orm';
import { type Introspector, type MigrationDialect, type SqlDialect } from '@zmdb/sql';

import { sqliteDriver } from './index.js';
import type {
  sqlite,
  sqliteIntrospector,
  sqliteMigrations,
  sqliteVertical,
  SqliteDatabase,
  SqliteOptions,
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

export type _Dialect = Expect<Equal<typeof sqlite, SqlDialect<'sqlite'>>>;
export type _Introspector = Expect<Equal<typeof sqliteIntrospector, Introspector<'sqlite'>>>;
export type _Migrations = Expect<Equal<typeof sqliteMigrations, MigrationDialect<'sqlite'>>>;
export type _DriverReturn = Expect<Equal<ReturnType<typeof sqliteDriver>, TransactionalDriver<'sqlite'>>>;
export type _Vertical = Expect<Equal<typeof sqliteVertical, DatabaseVertical<'sqlite', SqliteDatabase, SqliteOptions>>>;

declare const database: SqliteDatabase;
export const driver = sqliteDriver(database);
export const dialectIdentity: SqlDialect<'sqlite'> = driver.dialect as SqlDialect<'sqlite'>;
