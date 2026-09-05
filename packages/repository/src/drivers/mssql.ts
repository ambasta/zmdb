import type { Driver } from '../index.js';

/** The node-mssql Request surface used by this adapter. */
export interface MssqlRequest {
  input(name: string, value: unknown): MssqlRequest;
  query(text: string): Promise<{
    readonly recordset?: readonly Record<string, unknown>[];
  }>;
}

/** A connected node-mssql ConnectionPool, expressed structurally. */
export interface MssqlPool {
  request(): MssqlRequest;
}

/**
 * Wrap a connected node-mssql pool as a zmdb Driver.
 *
 * The compiler keeps parameters as a positional array while SQL Server SQL
 * names them `@p1` through `@pN`. node-mssql's `input()` takes the name without
 * the `@`, so this is the one boundary that maps array position to `pN`.
 */
export function mssqlDriver(pool: MssqlPool): Driver {
  return {
    dialect: 'mssql',
    async execute(query) {
      const request = pool.request();
      query.parameters.forEach((value, index) => {
        request.input(`p${index + 1}`, value);
      });
      const result = await request.query(query.text);
      return result.recordset ?? [];
    },
  };
}
