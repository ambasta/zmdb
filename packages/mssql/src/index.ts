import {
  defineSqlDialect,
  UnsupportedFeatureError,
  type DatabaseCapabilities,
  type PaginationTail,
  type ResolvedDialectTraits,
  type SqlDialect,
} from '@zmdb/query-compiler';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';

import { mssqlCompiler } from './compiler.js';
import {
  createMssqlDriver,
  type MssqlOptions,
  type MssqlPool,
  type MssqlRequest,
  type MssqlTransaction,
} from './driver.js';
import { mssqlIntrospector } from './introspect.js';
import { mssqlMigrations } from './migrations.js';
import { MSSQL_TYPES } from './types.js';

export {
  mssqlIntrospector,
  type MssqlCatalogColumnSnapshot,
  type MssqlCatalogForeignKeySnapshot,
  type MssqlCatalogIndexSnapshot,
  type MssqlCatalogSchemaSnapshot,
  type MssqlCatalogSequenceSnapshot,
  type MssqlCatalogTableSnapshot,
  type MssqlComputedColumn,
  type MssqlIdentity,
  type MssqlIntrospector,
} from './introspect.js';
export type { MssqlOptions, MssqlPool, MssqlRequest, MssqlTransaction };
export { MSSQL_TYPES };

function paginate({ limit, offset, ordered }: PaginationTail): string {
  if (limit === undefined && offset === undefined) return '';
  if (!ordered) {
    throw new UnsupportedFeatureError(
      'pagination without ORDER BY',
      'mssql',
      'Dialect "mssql" spells LIMIT as OFFSET … FETCH NEXT, which SQL Server allows only after an ORDER BY. ' +
        'Add .orderBy(...) — an unordered page is not reproducible on any dialect.',
    );
  }
  let sql = ` OFFSET ${String(offset ?? 0)} ROWS`;
  if (limit !== undefined) sql += ` FETCH NEXT ${String(limit)} ROWS ONLY`;
  return sql;
}

const OPERATOR_TOKEN = /^(?!.*--)[A-Za-z@<>=!~*&|?-]{1,4}$/;

function acceptsOperator(operator: string): boolean {
  return OPERATOR_TOKEN.test(operator) && !operator.includes('@') && operator !== '#>' && operator !== '#>>';
}

const traits: ResolvedDialectTraits = Object.freeze({
  placeholder: 'named',
  quote: Object.freeze(['[', ']'] as const),
  paginate,
  paginationRequiresOrder: true,
  rowValueIn: false,
  returning: Object.freeze({
    insert: 'output',
    upsert: 'output',
    update: 'output',
    delete: 'output',
  }),
  upsert: 'merge',
  fts: 'none',
  concat: 'function',
  booleanNot: 'bitwise',
  types: MSSQL_TYPES,
  paramLimit: 2000,
  retryableCodes: Object.freeze(['1205']),
  acceptsOperator,
  functions: false,
  procedures: false,
  tableFunctions: false,
  vectorDistance: false,
  spatialPredicates: false,
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
  rowLevelSecurity: false,
  streaming: false,
  cancellation: false,
});

const outbox = Object.freeze({
  pendingIndex: 'filtered' as const,
  epochLiteral: "'1970-01-01T00:00:00.000+00:00'",
  createdAtDefault: 'SYSDATETIMEOFFSET()',
  boundedTextType: (length: number) => `NVARCHAR(${String(length)})`,
});

export const mssql: SqlDialect<'mssql'> = defineSqlDialect({
  name: 'mssql',
  family: 'mssql',
  traits,
  capabilities,
  migrations: mssqlMigrations,
  introspector: mssqlIntrospector,
  compiler: mssqlCompiler,
  outbox,
});

export function mssqlDriver(pool: MssqlPool, options?: MssqlOptions): TransactionalDriver<'mssql'> {
  return createMssqlDriver(mssql, pool, options);
}

export const mssqlVertical: DatabaseVertical<'mssql', MssqlPool, MssqlOptions> = Object.freeze({
  dialect: mssql,
  driver: mssqlDriver,
});
