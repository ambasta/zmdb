import {
  postgres,
  postgresDriver,
  postgresFamilyDriver,
  postgresFamilyIntrospector,
  postgresFamilyMigrations,
  postgresIntrospector,
  postgresOutboxMigration,
  postgresVertical,
  type PgOptions,
  type PgQueryable,
  type PostgresCatalogOverrides,
} from '@zmdb/postgres';
import type { Introspector, MigrationDialect, SqlDialect } from '@zmdb/query-compiler';
import type { Migration } from '@zmdb/query-compiler/migrations';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';
import type { Pool } from 'pg';

declare const pool: Pool;
declare const queryable: PgQueryable;
declare const options: PgOptions;
declare const childDialect: SqlDialect<'postgres-child'>;
declare const overrides: PostgresCatalogOverrides;

const dialect: SqlDialect<'postgres'> = postgres;
const introspector: Introspector<'postgres'> = postgresIntrospector;
const driver: TransactionalDriver<'postgres'> = postgresDriver(pool, options);
const structuralDriver: TransactionalDriver<'postgres'> = postgresDriver(queryable);
const vertical: DatabaseVertical<'postgres', PgQueryable, PgOptions> = postgresVertical;
const childIntrospector: Introspector<'postgres-child'> = postgresFamilyIntrospector('postgres-child', overrides);
const childMigrations: MigrationDialect<'postgres-child'> = postgresFamilyMigrations('postgres-child', {
  types: { integer: 'INT4' },
});
const childDriver: TransactionalDriver<'postgres-child'> = postgresFamilyDriver(childDialect, queryable, options);
const outbox: Migration = postgresOutboxMigration(1);

void [
  dialect,
  introspector,
  driver,
  structuralDriver,
  vertical,
  childIntrospector,
  childMigrations,
  childDriver,
  outbox,
];
