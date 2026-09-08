import { type DatabaseVertical, type TransactionalDriver } from '@zmdb/orm';
import { type Introspector, type MigrationDialect, type SqlDialect } from '@zmdb/sql';

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
