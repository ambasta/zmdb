import { defineSqlDialect, type DialectTypeMap, type PaginationTail } from '@zmdb/query-compiler';

import { sqliteIntrospector } from './introspector.js';
import { sqliteMigrations } from './migrations.js';

const TYPES = Object.freeze({
  serial: 'INTEGER',
  integer: 'INTEGER',
  bigint: 'INTEGER',
  numeric: 'NUMERIC',
  text: 'TEXT',
  varchar: 'TEXT',
  boolean: 'INTEGER',
  timestamp: 'TEXT',
  json: 'TEXT',
  jsonEnum: 'TEXT',
  uuid: 'text',
  date: 'date',
  time: 'time',
  decimal: 'decimal',
  blob: 'blob',
} satisfies DialectTypeMap);

const OPERATOR_TOKEN = /^(?!.*--)[A-Za-z@<>=!~*&|?-]{1,4}$/;

function acceptsOperator(operator: string): boolean {
  if (operator === '#>' || operator === '#>>') return false;
  if (!OPERATOR_TOKEN.test(operator)) return false;
  return !operator.includes('?');
}

function paginate({ limit, offset }: PaginationTail): string {
  let text = '';
  if (limit !== undefined) text += ` LIMIT ${String(limit)}`;
  else if (offset !== undefined) text += ' LIMIT -1';
  if (offset !== undefined) text += ` OFFSET ${String(offset)}`;
  return text;
}

const suffixReturning = Object.freeze({
  insert: 'suffix',
  upsert: 'suffix',
  update: 'suffix',
  delete: 'suffix',
} as const);

const returningCapabilities = Object.freeze({
  insert: true,
  upsert: true,
  update: true,
  delete: true,
});

export const sqlite = defineSqlDialect({
  name: 'sqlite',
  family: 'sqlite',
  traits: {
    placeholder: 'positional',
    quote: Object.freeze(['"', '"']),
    paginate,
    returning: suffixReturning,
    upsert: 'onConflict',
    fts: 'companionTable',
    concat: 'operator',
    booleanNot: 'not',
    types: TYPES,
    paramLimit: 30_000,
    retryableCodes: Object.freeze([]),
    acceptsOperator,
    functions: false,
    procedures: false,
    tableFunctions: false,
    vectorDistance: false,
    spatialPredicates: false,
  },
  capabilities: {
    returning: returningCapabilities,
    transactionalDdl: true,
    schemas: false,
    sequences: false,
    generatedColumns: true,
    partialIndexes: true,
    foreignKeys: true,
    rowLevelSecurity: false,
    streaming: true,
    cancellation: false,
  },
  migrations: sqliteMigrations,
  introspector: sqliteIntrospector,
});
