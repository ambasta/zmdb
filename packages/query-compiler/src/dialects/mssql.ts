import { UnsupportedFeatureError } from '../errors.js';
import type { DialectTypeMap, PaginationTail } from './index.js';

export const MSSQL_TYPES = Object.freeze({
  serial: 'INT IDENTITY(1,1)',
  integer: 'INT',
  bigint: 'BIGINT',
  numeric: 'DECIMAL',
  text: 'NVARCHAR(MAX)',
  varchar: 'NVARCHAR',
  boolean: 'BIT',
  timestamp: 'DATETIMEOFFSET(3)',
  json: 'NVARCHAR(MAX)',
  jsonEnum: 'NVARCHAR(MAX)',
  uuid: 'UNIQUEIDENTIFIER',
  date: 'DATE',
  time: 'TIME',
  decimal: 'DECIMAL',
  blob: 'VARBINARY(MAX)',
} satisfies DialectTypeMap);

export function mssqlPaginate({ limit, offset, ordered }: PaginationTail): string {
  if (limit === undefined && offset === undefined) return '';
  if (!ordered) {
    throw new UnsupportedFeatureError(
      'pagination without ORDER BY',
      'mssql',
      'Dialect "mssql" spells LIMIT as OFFSET … FETCH NEXT, which SQL Server allows only after an ORDER BY. ' +
        'Add .orderBy(...) — an unordered page is not reproducible on any dialect.',
    );
  }

  let text = ` OFFSET ${offset ?? 0} ROWS`;
  if (limit !== undefined) text += ` FETCH NEXT ${limit} ROWS ONLY`;
  return text;
}
