// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { cockroach } from '@zmdb/cockroach';
import { mssql } from '@zmdb/mssql';
import { mysql } from '@zmdb/mysql';
import { postgres } from '@zmdb/postgres';
import { singlestore } from '@zmdb/singlestore';
import { sqlite } from '@zmdb/sqlite';

export const cockroachDialect = cockroach;
export const mssqlDialect = mssql;
export const mysqlDialect = mysql;
export const postgresDialect = postgres;
export const singlestoreDialect = singlestore;
export const sqliteDialect = sqlite;

export const officialDialects = Object.freeze({
  cockroach: cockroachDialect,
  mssql: mssqlDialect,
  mysql: mysqlDialect,
  postgres: postgresDialect,
  singlestore: singlestoreDialect,
  sqlite: sqliteDialect,
});

export type OfficialDialectName = keyof typeof officialDialects;
