import type { CompiledQuery, SqlDialect } from '@zmdb/query-compiler';
import type { ExecuteOptions, SelectedDriver, TransactionalDriver } from '@zmdb/repository';

export interface PgQueryable {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  query(config: {
    readonly name?: string;
    readonly queryMode?: 'extended';
    readonly text: string;
    readonly values?: readonly unknown[];
  }): Promise<{ rows: Record<string, unknown>[] }>;
  connect?(): Promise<PgConnection>;
}

export interface PgConnection extends PgQueryable {
  release?(): void;
}

export interface PgOptions {
  readonly prepared?: boolean;
  readonly maxCacheSize?: number;
  /** A queryable guaranteed to use a connection other than the running backend. */
  readonly cancelVia?: PgQueryable;
}

interface PgPoolClient extends PgConnection {
  release(): void;
}

interface PgPoolQueryable extends PgQueryable {
  readonly totalCount: number;
  readonly idleCount: number;
  connect(): Promise<PgPoolClient>;
}

interface PreparedState {
  readonly names: Map<string, string>;
  sequence: number;
}

export function postgresFamilyDriver<Name extends string>(
  dialect: SqlDialect<Name>,
  client: PgQueryable,
  options?: PgOptions,
): TransactionalDriver<Name> {
  return createPostgresDriver(dialect, client, options, false, new WeakMap());
}

function createPostgresDriver<Name extends string>(
  dialect: SqlDialect<Name>,
  client: PgQueryable,
  options: PgOptions | undefined,
  pinned: boolean,
  preparedStates: WeakMap<PgQueryable, PreparedState>,
): TransactionalDriver<Name> {
  const prepared = options?.prepared ?? false;
  const maxCacheSize = options?.maxCacheSize ?? 1000;
  if (!Number.isSafeInteger(maxCacheSize) || maxCacheSize < 0) {
    throw new RangeError('maxCacheSize must be a non-negative safe integer');
  }
  let cursorSequence = 0;

  const stateFor = (target: PgQueryable): PreparedState => {
    const current = preparedStates.get(target);
    if (current !== undefined) return current;
    const created = { names: new Map<string, string>(), sequence: 0 };
    preparedStates.set(target, created);
    return created;
  };

  const preparedName = async (target: PgQueryable, text: string): Promise<string> => {
    const preparedState = stateFor(target);
    const cached = maxCacheSize > 0 ? preparedState.names.get(text) : undefined;
    if (cached !== undefined) {
      preparedState.names.delete(text);
      preparedState.names.set(text, cached);
      return cached;
    }

    const name = `zmdb_${(preparedState.sequence++).toString(36)}`;
    if (maxCacheSize > 0) {
      if (preparedState.names.size >= maxCacheSize) {
        const oldestSql = preparedState.names.keys().next().value;
        if (oldestSql !== undefined) {
          const oldestName = preparedState.names.get(oldestSql);
          preparedState.names.delete(oldestSql);
          if (oldestName !== undefined) await target.query(`DEALLOCATE ${oldestName}`);
        }
      }
      preparedState.names.set(text, name);
    }
    return name;
  };

  const executeOn = async (target: PgQueryable, query: CompiledQuery): Promise<readonly Record<string, unknown>[]> => {
    const result = !prepared
      ? await target.query(query.text, query.parameters)
      : maxCacheSize === 0
        ? await target.query({
            queryMode: 'extended',
            text: query.text,
            values: query.parameters,
          })
        : await target.query({
            name: await preparedName(target, query.text),
            text: query.text,
            values: query.parameters,
          });
    return result.rows;
  };

  const driver: TransactionalDriver<Name> = {
    dialect,
    async execute(query, executeOptions) {
      const signal = executeOptions?.signal;
      signal?.throwIfAborted();

      const cancelVia = options?.cancelVia;
      if (signal === undefined || cancelVia === undefined) {
        const ownsPreparedConnection = prepared && !pinned && isPool(client);
        const target = ownsPreparedConnection ? await client.connect() : client;
        try {
          const rows = await executeOn(target, query);
          signal?.throwIfAborted();
          return rows;
        } finally {
          if (ownsPreparedConnection) release(target);
        }
      }

      const ownsConnection = !pinned && isPool(client);
      const connection = ownsConnection ? await client.connect() : client;
      try {
        signal.throwIfAborted();
        const pid = await backendPid(connection);
        signal.throwIfAborted();
        const removeAbort = forwardAbort(signal, pid, cancelVia);
        try {
          const rows = await executeOn(connection, query);
          signal.throwIfAborted();
          return rows;
        } catch (error) {
          if (signal.aborted) signal.throwIfAborted();
          throw error;
        } finally {
          removeAbort();
        }
      } finally {
        if (ownsConnection) release(connection);
      }
    },
    ...(pinned || isPool(client)
      ? {
          stream(query: CompiledQuery, executeOptions?: ExecuteOptions): AsyncIterable<Record<string, unknown>> {
            return streamPostgres(
              client,
              query,
              executeOptions,
              options?.cancelVia,
              pinned,
              `zmdb_${(cursorSequence++).toString(36)}`,
            );
          },
        }
      : {}),
    async transaction<Result>(run: (transaction: SelectedDriver<Name>) => Promise<Result>): Promise<Result> {
      if (!isPool(client)) {
        return runTransaction(dialect, client, options, preparedStates, run);
      }
      const connection = await client.connect();
      try {
        return await runTransaction(dialect, connection, options, preparedStates, run);
      } finally {
        connection.release();
      }
    },
  };
  return driver;
}

async function runTransaction<Name extends string, Result>(
  dialect: SqlDialect<Name>,
  connection: PgQueryable,
  options: PgOptions | undefined,
  preparedStates: WeakMap<PgQueryable, PreparedState>,
  run: (transaction: SelectedDriver<Name>) => Promise<Result>,
): Promise<Result> {
  const transactionDriver = createPostgresDriver(dialect, connection, options, true, preparedStates);
  await connection.query('BEGIN');
  try {
    const result = await run(transactionDriver);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
}

async function backendPid(connection: PgQueryable): Promise<number> {
  const result = await connection.query('SELECT pg_backend_pid() AS pid');
  const pid = result.rows[0]?.['pid'];
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new Error('postgresDriver could not read a valid pg_backend_pid()');
  }
  return pid;
}

function forwardAbort(signal: AbortSignal, pid: number, cancelVia: PgQueryable): () => void {
  let sent = false;
  const cancel = (): void => {
    if (sent) return;
    sent = true;
    void cancelVia.query('SELECT pg_cancel_backend($1)', [pid]).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  return () => signal.removeEventListener('abort', cancel);
}

function streamPostgres(
  client: PgQueryable,
  query: CompiledQuery,
  options: ExecuteOptions | undefined,
  cancelVia: PgQueryable | undefined,
  pinned: boolean,
  cursorName: string,
): AsyncIterable<Record<string, unknown>> {
  const batchSize = options?.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('batchSize must be a positive safe integer');
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>, void, unknown> {
      let cleanupFailure: unknown;
      const generator = (async function* (): AsyncGenerator<Record<string, unknown>, void, unknown> {
        const signal = options?.signal;
        signal?.throwIfAborted();
        const ownsConnection = !pinned && isPool(client);
        const connection = ownsConnection ? await client.connect() : client;
        let transactionOpen = false;
        let cursorOpen = false;
        let bodyFailure: unknown;
        let removeAbort = (): void => {};

        try {
          signal?.throwIfAborted();
          const pid = await backendPid(connection);
          if (signal !== undefined && cancelVia !== undefined) {
            removeAbort = forwardAbort(signal, pid, cancelVia);
          }
          signal?.throwIfAborted();

          if (ownsConnection) {
            await connection.query('BEGIN');
            transactionOpen = true;
          }
          await connection.query({
            text: `DECLARE "${cursorName}" NO SCROLL CURSOR FOR ${query.text}`,
            values: query.parameters,
          });
          cursorOpen = true;

          while (true) {
            signal?.throwIfAborted();
            const fetched = await connection.query(`FETCH FORWARD ${batchSize} FROM "${cursorName}"`);
            signal?.throwIfAborted();
            if (fetched.rows.length === 0) break;
            for (const row of fetched.rows) {
              signal?.throwIfAborted();
              yield row;
            }
          }
        } catch (error) {
          bodyFailure = signal?.aborted === true ? signal.reason : error;
        } finally {
          removeAbort();
          if (cursorOpen) {
            try {
              await connection.query(`CLOSE "${cursorName}"`);
            } catch (error) {
              cleanupFailure ??= error;
            }
          }
          if (transactionOpen) {
            try {
              await connection.query(bodyFailure === undefined && cleanupFailure === undefined ? 'COMMIT' : 'ROLLBACK');
            } catch (error) {
              cleanupFailure ??= error;
              try {
                await connection.query('ROLLBACK');
              } catch (rollbackError) {
                cleanupFailure ??= rollbackError;
              }
            }
          }
          if (ownsConnection) release(connection);
        }

        if (bodyFailure !== undefined) throw bodyFailure;
        if (cleanupFailure !== undefined) throw cleanupFailure;
      })();

      return {
        next: () => generator.next(),
        async return() {
          const result = await generator.return(undefined);
          if (cleanupFailure !== undefined) throw cleanupFailure;
          return result;
        },
        throw: error => generator.throw(error),
      };
    },
  };
}

function release(connection: PgQueryable): void {
  const method = Reflect.get(connection, 'release');
  if (typeof method === 'function') Reflect.apply(method, connection, []);
}

function isPool(client: PgQueryable): client is PgPoolQueryable {
  return (
    typeof client.connect === 'function' &&
    'totalCount' in client &&
    typeof client.totalCount === 'number' &&
    'idleCount' in client &&
    typeof client.idleCount === 'number'
  );
}
