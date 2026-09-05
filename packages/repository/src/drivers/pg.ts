// pg (node-postgres) driver adapter — see ../drivers/SPEC.md.
import type { CompiledQuery } from '@zmdb/query-compiler';

import type { Driver, ExecuteOptions } from '../index.js';
import type { TransactionalDriver } from './transactional.js';

// Minimal structural type so we don't hard-depend on `pg`'s types at build time.
export interface PgQueryable {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  query(config: {
    name?: string;
    text: string;
    values?: readonly unknown[];
  }): Promise<{ rows: Record<string, unknown>[] }>;
  connect?(): Promise<PgConnection>;
}

export interface PgConnection extends PgQueryable {
  release?(): void;
}

export interface PgOptions {
  prepared?: boolean;
  maxCacheSize?: number;
  /** A queryable able to use a connection other than the running backend. */
  cancelVia?: PgQueryable;
}

interface PgPoolClient extends PgConnection {
  release(): void;
}

interface PgPoolQueryable extends PgQueryable {
  readonly totalCount: number;
  readonly idleCount: number;
  connect(): Promise<PgPoolClient>;
}

/** Wrap a pg Pool/Client as a zmdb Driver. `prepared: true` opts into server-side
 * prepared statements (stable statement name per SQL). Kept opt-in to preserve
 * the zero-state default (see the benchmarks tail trade-off). */
export function pgDriver(client: PgQueryable, opts?: PgOptions): TransactionalDriver {
  return createPgDriver(client, opts, false);
}

function createPgDriver(client: PgQueryable, opts: PgOptions | undefined, pinned: boolean): TransactionalDriver {
  const prepared = opts?.prepared ?? false;
  const maxCacheSize = opts?.maxCacheSize ?? 1000;
  const names = new Map<string, string>();
  let seq = 0;
  let cursorSeq = 0;

  const nameFor = (text: string): string => {
    let n = maxCacheSize > 0 ? names.get(text) : undefined;
    if (!n) {
      n = 'z' + (seq++).toString(36);
      if (maxCacheSize > 0) {
        if (names.size >= maxCacheSize) {
          const oldestKey = names.keys().next().value;
          if (oldestKey !== undefined) {
            const oldestName = names.get(oldestKey);
            names.delete(oldestKey);
            if (oldestName) {
              client.query(`DEALLOCATE ${oldestName}`).catch(() => {});
            }
          }
        }
        names.set(text, n);
      }
    } else if (maxCacheSize > 0) {
      names.delete(text);
      names.set(text, n);
    }
    return n;
  };

  const executeOn = async (target: PgQueryable, query: CompiledQuery): Promise<readonly Record<string, unknown>[]> => {
    const result = prepared
      ? await target.query({ name: nameFor(query.text), text: query.text, values: query.parameters })
      : await target.query(query.text, query.parameters);
    return result.rows;
  };

  const driver: TransactionalDriver = {
    dialect: 'postgres',
    async execute(query, executeOpts) {
      const signal = executeOpts?.signal;
      signal?.throwIfAborted();

      const cancelVia = opts?.cancelVia;
      if (signal === undefined || cancelVia === undefined) {
        const rows = await executeOn(client, query);
        signal?.throwIfAborted();
        return rows;
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
          stream(query: CompiledQuery, executeOpts?: ExecuteOptions): AsyncIterable<Record<string, unknown>> {
            return streamPostgres(
              client,
              query,
              executeOpts,
              opts?.cancelVia,
              pinned,
              `zmdb_${(cursorSeq++).toString(36)}`,
            );
          },
        }
      : {}),
    async transaction<Result>(run: (driver: Driver) => Promise<Result>): Promise<Result> {
      if (!isPool(client)) return runTransaction(client, opts, run);
      const connection = await client.connect();
      try {
        return await runTransaction(connection, opts, run);
      } finally {
        connection.release();
      }
    },
  };
  return driver;
}

async function runTransaction<Result>(
  connection: PgQueryable,
  options: PgOptions | undefined,
  run: (driver: Driver) => Promise<Result>,
): Promise<Result> {
  const transactionDriver = createPgDriver(connection, options, true);
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
    throw new Error('pgDriver could not read a valid pg_backend_pid()');
  }
  return pid;
}

function forwardAbort(signal: AbortSignal, pid: number, cancelVia: PgQueryable): () => void {
  let sent = false;
  const cancel = (): void => {
    if (sent) return;
    sent = true;
    // Rejecting only in JavaScript would leave PostgreSQL doing work for a
    // caller that has already gone away. The cancel must reach a second
    // connection because it would queue behind the query on the busy one.
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
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('batchSize must be a positive integer');
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>, void, unknown> {
      const signal = options?.signal;
      let cleanupFailed = false;
      let cleanupFailure: unknown;
      const generator = (async function* (): AsyncGenerator<Record<string, unknown>, void, unknown> {
        signal?.throwIfAborted();
        const ownsConnection = !pinned && isPool(client);
        const connection = ownsConnection ? await client.connect() : client;
        let transactionOpen = false;
        let cursorOpen = false;
        let bodyFailed = false;
        let bodyFailure: unknown;
        let removeAbort = (): void => {};

        const rememberCleanupFailure = (error: unknown): void => {
          if (!cleanupFailed) cleanupFailure = error;
          cleanupFailed = true;
        };

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

          let exhausted = false;
          while (!exhausted) {
            signal?.throwIfAborted();
            const fetched = await connection.query(`FETCH FORWARD ${batchSize} FROM "${cursorName}"`);
            signal?.throwIfAborted();
            exhausted = fetched.rows.length === 0;
            for (const row of fetched.rows) {
              signal?.throwIfAborted();
              yield row;
            }
          }
        } catch (error) {
          bodyFailed = true;
          bodyFailure = signal?.aborted === true ? signal.reason : error;
        } finally {
          removeAbort();

          if (cursorOpen) {
            try {
              await connection.query(`CLOSE "${cursorName}"`);
            } catch (error) {
              rememberCleanupFailure(error);
            }
          }

          if (transactionOpen) {
            try {
              await connection.query(bodyFailed || cleanupFailed ? 'ROLLBACK' : 'COMMIT');
            } catch (error) {
              rememberCleanupFailure(error);
              try {
                await connection.query('ROLLBACK');
              } catch (rollbackError) {
                rememberCleanupFailure(rollbackError);
              }
            }
          }

          if (ownsConnection) release(connection);
        }

        if (bodyFailed) throw bodyFailure;
        if (cleanupFailed) throw cleanupFailure;
      })();

      return {
        next: () => generator.next(),
        async return() {
          const result = await generator.return(undefined);
          if (cleanupFailed) throw cleanupFailure;
          return result;
        },
        throw: error => generator.throw(error),
      };
    },
  };
}

function release(connection: PgQueryable): void {
  const releaseMethod = Reflect.get(connection, 'release');
  if (typeof releaseMethod === 'function') Reflect.apply(releaseMethod, connection, []);
}

function isPool(client: PgQueryable): client is PgPoolQueryable {
  return (
    'connect' in client &&
    typeof client.connect === 'function' &&
    'totalCount' in client &&
    typeof client.totalCount === 'number' &&
    'idleCount' in client &&
    typeof client.idleCount === 'number'
  );
}
