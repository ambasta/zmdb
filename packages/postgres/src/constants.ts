import type { DialectTypeMap } from '@zmdb/query-compiler';

export const POSTGRES_TYPES: DialectTypeMap = Object.freeze({
  serial: 'SERIAL',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  numeric: 'NUMERIC',
  text: 'TEXT',
  varchar: 'VARCHAR',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMPTZ',
  json: 'JSONB',
  jsonEnum: 'TEXT',
  uuid: 'uuid',
  date: 'date',
  time: 'time',
  decimal: 'decimal',
  blob: 'bytea',
});
