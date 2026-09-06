import {
  defineSqlDialect,
  type DatabaseCapabilities,
  type PaginationTail,
  type ResolvedDialectTraits,
  type SqlDialect,
} from '@zmdb/query-compiler';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';

import { POSTGRES_TYPES } from './constants.js';
import { postgresFamilyDriver, type PgConnection, type PgOptions, type PgQueryable } from './driver.js';
import { postgresFamilyIntrospector, type PostgresCatalogOverrides } from './introspect.js';
import { postgresFamilyMigrations, type PostgresMigrationOptions } from './migrations.js';

export type { PgConnection, PgOptions, PgQueryable, PostgresCatalogOverrides, PostgresMigrationOptions };
export { postgresFamilyDriver, postgresFamilyIntrospector, postgresFamilyMigrations };
export {
  POSTGRES_OUTBOX_TABLE,
  postgresOutboxMigration,
  postgresOutboxPendingIndexDdl,
  postgresOutboxTableDdl,
} from './outbox.js';

const UNMAPPED_OPERATOR_TOKEN = /^(?!.*--)[A-Za-z@<>=!~*&|?-]{1,4}$/;
const POSTGRES_QUOTE: readonly [open: string, close: string] = ['"', '"'];
Object.freeze(POSTGRES_QUOTE);

const traits: ResolvedDialectTraits = Object.freeze({
  placeholder: 'numbered',
  quote: POSTGRES_QUOTE,
  paginate: ({ limit, offset }: PaginationTail) => {
    let text = '';
    if (limit !== undefined) text += ` LIMIT ${limit}`;
    if (offset !== undefined) text += ` OFFSET ${offset}`;
    return text;
  },
  returning: Object.freeze({
    insert: 'suffix',
    upsert: 'suffix',
    update: 'suffix',
    delete: 'suffix',
  }),
  upsert: 'onConflict',
  fts: 'tsvector',
  concat: 'operator',
  booleanNot: 'not',
  types: POSTGRES_TYPES,
  paramLimit: 60_000,
  retryableCodes: Object.freeze(['40001', '40P01']),
  acceptsOperator: (operator: string) =>
    operator === '#>' || operator === '#>>' || UNMAPPED_OPERATOR_TOKEN.test(operator),
  functions: true,
  procedures: true,
  tableFunctions: true,
  vectorDistance: true,
  spatialPredicates: true,
});

const capabilities: DatabaseCapabilities = Object.freeze({
  returning: Object.freeze({
    insert: true,
    upsert: true,
    update: true,
    delete: true,
  }),
  transactionalDdl: true,
  schemas: true,
  sequences: true,
  generatedColumns: true,
  partialIndexes: true,
  foreignKeys: true,
  rowLevelSecurity: true,
  streaming: true,
  cancellation: true,
});

export const postgresIntrospector = postgresFamilyIntrospector('postgres');

export const postgres: SqlDialect<'postgres'> = defineSqlDialect({
  name: 'postgres',
  family: 'postgres',
  traits,
  capabilities,
  migrations: postgresFamilyMigrations('postgres'),
  introspector: postgresIntrospector,
});

export function postgresDriver(client: PgQueryable, options?: PgOptions): TransactionalDriver<'postgres'> {
  return postgresFamilyDriver(postgres, client, options);
}

export const postgresVertical: DatabaseVertical<'postgres', PgQueryable, PgOptions> = Object.freeze({
  dialect: postgres,
  driver: postgresDriver,
});
