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
} from './index.js';

declare const queryable: MysqlQueryable;
declare const options: MysqlOptions;

const dialect: SqlDialect<'singlestore'> = singlestore;
const introspector: Introspector<'singlestore'> = singlestoreIntrospector;
const migrations: MigrationDialect<'singlestore'> = singlestoreMigrations;
const driver: TransactionalDriver<'singlestore'> = singlestoreDriver(queryable, options);
const vertical: DatabaseVertical<'singlestore', MysqlQueryable, MysqlOptions> = singlestoreVertical;

void [dialect, introspector, migrations, driver, vertical];
