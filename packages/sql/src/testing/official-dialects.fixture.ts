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
