import {
  mysql,
  mysqlFamilyDriver,
  type MysqlConnection,
  type MysqlDriver,
  type MysqlExecutionResult,
  type MysqlOptions,
  type MysqlParameter,
  type MysqlPool,
  type MysqlQueryable,
  type MysqlQueryResult,
  type MysqlResultHeader,
} from '@zmdb/mysql';
import { extendSqlDialect, type SqlDialect } from '@zmdb/query-compiler';
import type { DatabaseVertical } from '@zmdb/repository';

import { singlestoreIntrospector } from './introspect.js';
import { SINGLESTORE_TYPE_OVERRIDES, singlestoreMigrations } from './migrations.js';

export type {
  MysqlConnection,
  MysqlDriver,
  MysqlExecutionResult,
  MysqlOptions,
  MysqlParameter,
  MysqlPool,
  MysqlQueryable,
  MysqlQueryResult,
  MysqlResultHeader,
};
export { singlestoreIntrospector, singlestoreMigrations };

const outbox = Object.freeze({
  createTable: 'CREATE ROWSTORE TABLE',
  pendingIndex: 'full' as const,
  epochLiteral: "'1970-01-01 00:00:00.000000'",
  createdAtDefault: 'CURRENT_TIMESTAMP(6)',
  boundedTextType: (length: number) => `VARCHAR(${String(length)})`,
});

export const singlestore: SqlDialect<'singlestore'> = extendSqlDialect(mysql, {
  name: 'singlestore',
  traits: {
    fts: 'matchPlain',
    types: SINGLESTORE_TYPE_OVERRIDES,
  },
  capabilities: {
    foreignKeys: false,
  },
  migrations: singlestoreMigrations,
  introspector: singlestoreIntrospector,
  outbox,
});

export function singlestoreDriver(client: MysqlQueryable, options?: MysqlOptions): MysqlDriver<'singlestore'> {
  return mysqlFamilyDriver(singlestore, client, options);
}

export const singlestoreVertical: DatabaseVertical<'singlestore', MysqlQueryable, MysqlOptions> = Object.freeze({
  dialect: singlestore,
  driver: singlestoreDriver,
});
