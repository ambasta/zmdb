import type { Introspector, MigrationDialect, SqlDialect } from '@zmdb/query-compiler';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';
import {
  singlestore,
  singlestoreDriver,
  singlestoreIntrospector,
  singlestoreMigrations,
  singlestoreVertical,
  type MysqlOptions,
  type MysqlQueryable,
} from '@zmdb/singlestore';
import type { Pool } from 'mysql2/promise';

declare const pool: Pool;
declare const queryable: MysqlQueryable;
declare const options: MysqlOptions;

const dialect: SqlDialect<'singlestore'> = singlestore;
const introspector: Introspector<'singlestore'> = singlestoreIntrospector;
const migrations: MigrationDialect<'singlestore'> = singlestoreMigrations;
const driver: TransactionalDriver<'singlestore'> = singlestoreDriver(pool, options);
const structuralDriver: TransactionalDriver<'singlestore'> = singlestoreDriver(queryable);
const vertical: DatabaseVertical<'singlestore', MysqlQueryable, MysqlOptions> = singlestoreVertical;

void [dialect, introspector, migrations, driver, structuralDriver, vertical];
