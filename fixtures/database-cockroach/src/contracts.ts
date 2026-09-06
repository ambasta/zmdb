import {
  cockroach,
  cockroachDriver,
  cockroachIntrospector,
  cockroachMigrations,
  cockroachVertical,
  type PgOptions,
  type PgQueryable,
} from '@zmdb/cockroach';
import type { Introspector, MigrationDialect, SqlDialect } from '@zmdb/query-compiler';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';
import type { Pool } from 'pg';

declare const pool: Pool;
declare const queryable: PgQueryable;
declare const options: PgOptions;

const dialect: SqlDialect<'cockroach'> = cockroach;
const introspector: Introspector<'cockroach'> = cockroachIntrospector;
const migrations: MigrationDialect<'cockroach'> = cockroachMigrations;
const driver: TransactionalDriver<'cockroach'> = cockroachDriver(pool, options);
const structuralDriver: TransactionalDriver<'cockroach'> = cockroachDriver(queryable);
const vertical: DatabaseVertical<'cockroach', PgQueryable, PgOptions> = cockroachVertical;

void [dialect, introspector, migrations, driver, structuralDriver, vertical];
