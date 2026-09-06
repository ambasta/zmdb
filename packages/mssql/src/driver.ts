import type { CompiledQuery, SqlDialect } from '@zmdb/query-compiler';
import type { SelectedDriver, TransactionalDriver } from '@zmdb/repository';

/** The node-mssql Request surface used by the adapter. */
export interface MssqlRequest {
  input(name: string, value: unknown): MssqlRequest;
  query(text: string): Promise<{
    readonly recordset?: readonly Record<string, unknown>[];
  }>;
}

/** The node-mssql Transaction surface used by the adapter. */
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

/** Per-request customization without importing the node-mssql runtime. */
export interface MssqlOptions {
  readonly queryTelemetry?: true;
  readonly configureRequest?: (request: MssqlRequest, query: CompiledQuery) => void;
}

interface MssqlRequestSource {
  request(): MssqlRequest;
}

function bindValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function requestDriver(
  dialect: SqlDialect<'mssql'>,
  source: MssqlRequestSource,
  options: MssqlOptions,
): SelectedDriver<'mssql'> {
  return {
    dialect,
    ...(options.queryTelemetry === true ? { queryTelemetry: true as const } : {}),
    async execute(query, executeOptions) {
      executeOptions?.signal?.throwIfAborted();
      const request = source.request();
      options.configureRequest?.(request, query);
      query.parameters.forEach((value, index) => {
        request.input(`p${String(index + 1)}`, bindValue(value));
      });
      const result = await request.query(query.text);
      return result.recordset ?? [];
    },
  };
}

export function createMssqlDriver(
  dialect: SqlDialect<'mssql'>,
  pool: MssqlPool,
  options: MssqlOptions = {},
): TransactionalDriver<'mssql'> {
  const driver = requestDriver(dialect, pool, options);
  return {
    ...driver,
    dialect,
    async transaction<Result>(run: (driver: SelectedDriver<'mssql'>) => Promise<Result>): Promise<Result> {
      const transaction = pool.transaction();
      await transaction.begin();
      try {
        const result = await run(requestDriver(dialect, transaction, options));
        await transaction.commit();
        return result;
      } catch (error) {
        try {
          await transaction.rollback();
        } catch {
          // Preserve the query or callback error: rollback failure is secondary.
        }
        throw error;
      }
    },
  };
}
