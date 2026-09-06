import type { ColumnSnapshot } from '@zmdb/migrations';
import { UnsupportedFeatureError, type DialectTypeMap } from '@zmdb/query-compiler';

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

export function mssqlDdlType(column: ColumnSnapshot): string {
  if (typeof column.type !== 'string') {
    const args = column.type.args ?? [];
    const rendered = `${column.type.name}${args.length === 0 ? '' : `(${args.map(String).join(',')})`}`;
    throw new UnsupportedFeatureError(
      `extension type ${rendered}`,
      'mssql',
      `mssql does not support the extension type ${rendered} on column "${column.name}" ` +
        `(extension \`${column.type.extension}\`); use a native SQL Server type in a hand-written migration`,
    );
  }

  const mapped: string = Reflect.get(MSSQL_TYPES, column.type) ?? column.type;
  if (column.type === 'varchar') {
    return column.length === undefined ? 'NVARCHAR(MAX)' : `NVARCHAR(${String(column.length)})`;
  }
  return mapped;
}
