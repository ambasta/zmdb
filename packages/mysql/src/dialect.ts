// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  defineSqlDialect,
  type DatabaseCapabilities,
  type PaginationTail,
  type ResolvedDialectTraits,
} from '@zmdb/sql';

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
    uuid: 'CHAR(36)',
    date: 'DATE',
    time: 'TIME',
    decimal: 'DECIMAL',
    blob: 'BLOB',
  }),
  paramLimit: 60000,
  // mysql2 sets `code` to the error name and `errno` to the number, so both spellings are listed:
  // 1213 ER_LOCK_DEADLOCK and 1205 ER_LOCK_WAIT_TIMEOUT. InnoDB rolls the transaction back itself in
  // both cases, which is exactly the condition a re-run of the unit of work resolves.
  retryableCodes: Object.freeze(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '1213', '1205']),
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
