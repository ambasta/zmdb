import type { CompiledQuery, SqlDialect } from '@zmdb/query-compiler';
import type { ExecuteOptions, SelectedDriver, TransactionalDriver } from '@zmdb/repository';

export interface MysqlResultHeader {
  readonly affectedRows: number;
  readonly insertId: number | string | bigint;
  readonly warningStatus?: number;
}

export type MysqlQueryResult = readonly Readonly<Record<string, unknown>>[] | MysqlResultHeader;

export type MysqlParameter =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | Uint8Array
  | MysqlParameter[]
  | { readonly [key: string]: MysqlParameter };

/**
 * The mysql2/promise surface used by the adapter. It is deliberately structural:
 * importing @zmdb/mysql does not resolve or load mysql2.
 */
export interface MysqlQueryable {
  execute(sql: string, values?: MysqlParameter[]): Promise<readonly [unknown, readonly unknown[]]>;
  /** Optional mysql2 text protocol for metadata statements that the prepared protocol rejects. */
  query?(sql: string, values?: MysqlParameter[]): Promise<readonly [unknown, readonly unknown[]]>;
}

export interface MysqlConnection extends MysqlQueryable {
  beginTransaction(): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
  release?(): void;
}

export interface MysqlPool extends MysqlQueryable {
  getConnection(): Promise<MysqlConnection>;
}

export interface MysqlOptions {
  /** Optional application-to-wire conversion applied before mysql2 receives a value. */
  readonly mapParameter?: (value: unknown, index: number) => MysqlParameter;
}

export type MysqlExecutionResult =
  | {
      readonly kind: 'rows';
      readonly rows: readonly Readonly<Record<string, unknown>>[];
    }
  | {
      readonly kind: 'command';
      readonly affectedRows: number;
      readonly insertId: number | string | bigint;
      readonly warningStatus?: number;
    };

export interface MysqlDriver<Name extends string = 'mysql'> extends TransactionalDriver<Name> {
  readonly dialect: SqlDialect<Name>;
  executeResult(query: CompiledQuery, options?: ExecuteOptions): Promise<MysqlExecutionResult>;
}

function isPool(client: MysqlQueryable): client is MysqlPool {
  return typeof Reflect.get(client, 'getConnection') === 'function';
}

function isConnection(client: MysqlQueryable): client is MysqlConnection {
  return (
    typeof Reflect.get(client, 'beginTransaction') === 'function' &&
    typeof Reflect.get(client, 'commit') === 'function' &&
    typeof Reflect.get(client, 'rollback') === 'function'
  );
}

function resultHeader(value: unknown): MysqlResultHeader {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('mysql2 returned neither rows nor a result header');
  }
  const affectedRows = Reflect.get(value, 'affectedRows');
  const insertId = Reflect.get(value, 'insertId');
  const warningStatus = Reflect.get(value, 'warningStatus');
  if (typeof affectedRows !== 'number' || !Number.isSafeInteger(affectedRows) || affectedRows < 0) {
    throw new TypeError('mysql2 result header affectedRows must be a non-negative safe integer');
  }
  if (
    (typeof insertId !== 'number' || !Number.isSafeInteger(insertId)) &&
    typeof insertId !== 'string' &&
    typeof insertId !== 'bigint'
  ) {
    throw new TypeError('mysql2 result header insertId must be a safe integer, string, or bigint');
  }
  if (
    warningStatus !== undefined &&
    (typeof warningStatus !== 'number' || !Number.isSafeInteger(warningStatus) || warningStatus < 0)
  ) {
    throw new TypeError('mysql2 result header warningStatus must be a non-negative safe integer');
  }
  return {
    affectedRows,
    insertId,
    ...(warningStatus === undefined ? {} : { warningStatus }),
  };
}

function isPlainRecord(value: object): value is Readonly<Record<string, unknown>> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mysqlParameter(value: unknown, label: string): MysqlParameter {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    value instanceof Date ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => mysqlParameter(entry, `${label}[${String(index)}]`));
  }
  if (typeof value === 'object' && isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mysqlParameter(entry, `${label}.${key}`)]),
    );
  }
  throw new TypeError(`${label} is not a mysql2 execute parameter`);
}

function mapParameters(query: CompiledQuery, options: MysqlOptions | undefined): MysqlParameter[] {
  const map = options?.mapParameter;
  return query.parameters.map((value, index) =>
    map === undefined ? mysqlParameter(value, `query parameter ${String(index + 1)}`) : map(value, index),
  );
}

async function runTransaction<Name extends string, Result>(
  dialect: SqlDialect<Name>,
  connection: MysqlConnection,
  options: MysqlOptions | undefined,
  run: (driver: SelectedDriver<Name>) => Promise<Result>,
): Promise<Result> {
  await connection.beginTransaction();
  const transactionDriver = createMysqlDriver(dialect, connection, options, true);
  try {
    const result = await run(transactionDriver);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function createMysqlDriver<Name extends string>(
  dialect: SqlDialect<Name>,
  client: MysqlQueryable,
  options: MysqlOptions | undefined,
  pinned: boolean,
): MysqlDriver<Name> {
  const driver: MysqlDriver<Name> = {
    dialect,
    async executeResult(query, executeOptions) {
      const signal = executeOptions?.signal;
      signal?.throwIfAborted();
      const parameters = mapParameters(query, options);
      const textQuery = /^\s*(?:SHOW|DESCRIBE)\b/iu.test(query.text) ? client.query : undefined;
      const [result] =
        textQuery === undefined
          ? await client.execute(query.text, parameters)
          : await textQuery.call(client, query.text, parameters);
      signal?.throwIfAborted();
      if (Array.isArray(result)) {
        if (result.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) {
          throw new TypeError('mysql2 row results must contain objects');
        }
        return { kind: 'rows', rows: result };
      }
      return { kind: 'command', ...resultHeader(result) };
    },
    async execute(query, executeOptions) {
      const result = await driver.executeResult(query, executeOptions);
      return result.kind === 'rows' ? result.rows : [];
    },
    async transaction<Result>(run: (transactionDriver: SelectedDriver<Name>) => Promise<Result>): Promise<Result> {
      if (pinned) {
        if (!isConnection(client)) throw new TypeError('a pinned mysql transaction lost its connection');
        return runTransaction(dialect, client, options, run);
      }
      if (isPool(client)) {
        const connection = await client.getConnection();
        try {
          return await runTransaction(dialect, connection, options, run);
        } finally {
          connection.release?.();
        }
      }
      if (!isConnection(client)) {
        throw new TypeError('mysqlDriver.transaction requires a mysql2 pool or connection');
      }
      return runTransaction(dialect, client, options, run);
    },
  };
  return driver;
}

export function mysqlFamilyDriver<Name extends string>(
  dialect: SqlDialect<Name>,
  client: MysqlQueryable,
  options?: MysqlOptions,
): MysqlDriver<Name> {
  return createMysqlDriver(dialect, client, options, false);
}
