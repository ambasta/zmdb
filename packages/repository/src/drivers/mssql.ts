import type { Driver } from '../index.js';
import type { TransactionalDriver } from './transactional.js';

/** The node-mssql Request surface used by this adapter. */
export interface MssqlRequest {
  input(name: string, value: unknown): MssqlRequest;
  query(text: string): Promise<{
    readonly recordset?: readonly Record<string, unknown>[];
  }>;
}

/** The node-mssql Transaction surface used by this adapter. */
export interface MssqlTransaction {
  begin(): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
  request(): MssqlRequest;
}

/** A connected node-mssql ConnectionPool, expressed structurally. */
export interface MssqlPool {
  request(): MssqlRequest;
  transaction(): MssqlTransaction;
}

/**
 * Wrap a connected node-mssql pool as a zmdb Driver.
 *
 * The compiler keeps parameters as a positional array while SQL Server SQL
 * names them `@p1` through `@pN`. node-mssql's `input()` takes the name without
 * the `@`, so this is the one boundary that maps array position to `pN`.
 */
export function mssqlDriver(pool: MssqlPool): TransactionalDriver {
  const driver = requestDriver(pool);
  return {
    ...driver,
    async transaction<Result>(run: (driver: Driver) => Promise<Result>): Promise<Result> {
      const transaction = pool.transaction();
      await transaction.begin();
      try {
        const result = await run(requestDriver(transaction));
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },
  };
}

interface MssqlRequestSource {
  request(): MssqlRequest;
}

function requestDriver(source: MssqlRequestSource): Driver {
  return {
    dialect: 'mssql',
    async execute(query) {
      const request = source.request();
      query.parameters.forEach((value, index) => {
        request.input(`p${index + 1}`, value);
      });
      const result = await request.query(query.text);
      return result.recordset ?? [];
    },
  };
}
