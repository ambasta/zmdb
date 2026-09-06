import { extendSqlDialect, type Introspector, type MigrationDialect, type SqlDialect } from '@zmdb/query-compiler';
import type { Migration } from '@zmdb/query-compiler/migrations';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';

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
} from './index.js';

declare const queryable: PgQueryable;
declare const options: PgOptions;

const dialect: SqlDialect<'postgres'> = postgres;
const introspector: Introspector<'postgres'> = postgresIntrospector;
const driver: TransactionalDriver<'postgres'> = postgresDriver(queryable, options);
const vertical: DatabaseVertical<'postgres', PgQueryable, PgOptions> = postgresVertical;

const childIntrospector = postgresFamilyIntrospector('postgres-child');
const child: Introspector<'postgres-child'> = childIntrospector;
const childMigrations: MigrationDialect<'postgres-child'> = postgresFamilyMigrations('postgres-child', {
  types: { integer: 'INT4' },
});
const childDialect: SqlDialect<'postgres-child'> = extendSqlDialect(postgres, {
  name: 'postgres-child',
  traits: {
    fts: 'none',
    retryableCodes: ['40001'],
    types: { integer: 'INT4' },
  },
  capabilities: { rowLevelSecurity: false },
  migrations: childMigrations,
  introspector: childIntrospector,
});
const childDriver: TransactionalDriver<'postgres-child'> = postgresFamilyDriver(childDialect, queryable, options);
const outbox: Migration = postgresOutboxMigration(1);

void dialect;
void introspector;
void driver;
void vertical;
void child;
void childMigrations;
void childDriver;
void outbox;
