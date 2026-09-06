import {
  defineSqlDialect,
  type DatabaseCapabilities,
  type PaginationTail,
  type ResolvedDialectTraits,
} from '@zmdb/query-compiler';

import { mysqlIntrospector } from './introspect.js';
import { createMysqlMigrations } from './migrations.js';

const OPERATOR_TOKEN = /^(?!.*--)[A-Za-z@<>=!~*&|?-]{1,4}$/;

function acceptsOperator(operator: string): boolean {
  if (operator === '#>' || operator === '#>>') return false;
  return OPERATOR_TOKEN.test(operator) && !operator.includes('?');
}

function paginate({ limit, offset }: PaginationTail): string {
  if (limit === undefined && offset !== undefined) {
    return ` LIMIT 18446744073709551615 OFFSET ${String(offset)}`;
  }
  let text = '';
  if (limit !== undefined) text += ` LIMIT ${String(limit)}`;
  if (offset !== undefined) text += ` OFFSET ${String(offset)}`;
  return text;
}

const traits: ResolvedDialectTraits = {
  placeholder: 'positional',
  quote: Object.freeze(['`', '`']),
  paginate,
  paginationRequiresOrder: false,
  rowValueIn: true,
  returning: Object.freeze({
    insert: 'none',
    upsert: 'none',
    update: 'none',
    delete: 'none',
  }),
  upsert: 'onDuplicateKey',
  fts: 'match',
  concat: 'function',
  booleanNot: 'not',
  types: Object.freeze({
    serial: 'INT AUTO_INCREMENT',
    integer: 'INT',
    bigint: 'BIGINT',
    numeric: 'DECIMAL',
    text: 'TEXT',
    varchar: 'VARCHAR',
    boolean: 'TINYINT(1)',
    timestamp: 'DATETIME(3)',
    json: 'JSON',
    jsonEnum: 'TEXT',
  }),
  paramLimit: 60000,
  retryableCodes: Object.freeze([]),
  acceptsOperator,
  functions: true,
  procedures: true,
  tableFunctions: false,
  vectorDistance: false,
  spatialPredicates: false,
};

const capabilities: DatabaseCapabilities = {
  returning: Object.freeze({
    insert: false,
    upsert: false,
    update: false,
    delete: false,
  }),
  transactionalDdl: false,
  schemas: true,
  sequences: false,
  generatedColumns: true,
  partialIndexes: false,
  foreignKeys: true,
  rowLevelSecurity: false,
  streaming: false,
  cancellation: false,
};

export const mysql = defineSqlDialect({
  name: 'mysql',
  family: 'mysql',
  telemetrySystem: 'mysql',
  traits,
  capabilities,
  migrations: createMysqlMigrations('mysql'),
  introspector: mysqlIntrospector,
  outbox: Object.freeze({
    createTable: 'CREATE TABLE',
    pendingIndex: 'full',
    epochLiteral: "'1970-01-01 00:00:00.000'",
    createdAtDefault: 'CURRENT_TIMESTAMP(3)',
    boundedTextType: (length: number) => `VARCHAR(${String(length)})`,
  }),
});
