// Transactions — implementation (#36 transaction context primitive).
// createTransactionalDb.transaction() issues BEGIN/COMMIT/ROLLBACK and
// tx.savepoint() issues SAVEPOINT / RELEASE / ROLLBACK TO SAVEPOINT.
import { dialectTraits, type CompiledQuery, type DialectTarget } from '@zmdb/query-compiler';

import type { ExecuteOptions } from '../index.js';

export type TransactionState = 'active' | 'closed' | 'committed' | 'rolled_back' | string;

export interface TransactionContext<State extends string = 'active'> {
  readonly _state?: State | undefined;
  readonly dialect?: DialectTarget;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
  savepoint<R>(fn: (tx: TransactionContext<State>) => Promise<R>): Promise<R>;
}

export type ActiveTransactionContext = TransactionContext<'active'>;
export type ClosedTransactionContext = TransactionContext<'closed'>;

export function markTransactionClosed<State extends string = 'active'>(
  tx: TransactionContext<State>,
): ClosedTransactionContext {
  const stream = typeof tx.stream === 'function' ? tx.stream : undefined;
  return {
    _state: 'closed',
    ...(tx.dialect === undefined ? {} : { dialect: tx.dialect }),
    execute: (query, opts) => tx.execute(query, opts),
    ...(stream === undefined
      ? {}
      : {
          stream: (query: CompiledQuery, opts?: ExecuteOptions) => stream.call(tx, query, opts),
        }),
    savepoint: <R>(fn: (ctx: ClosedTransactionContext) => Promise<R>): Promise<R> =>
      tx.savepoint(innerTx => fn(markTransactionClosed(innerTx))),
  };
}

export interface TxConnection {
  readonly dialect?: DialectTarget;
  raw(sql: string): Promise<void>;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}

export interface TransactionalDb {
  transaction<R, State extends string = 'active'>(
    fn: (tx: TransactionContext<State>) => Promise<R>,
    options?: TransactionOptions,
  ): Promise<R>;
}

export interface TransactionRetryPolicy {
  /** Retries after the first failed attempt. The transaction body may run `maxRetries + 1` times. */
  readonly maxRetries: number;
  /** Exponential-backoff starting delay. Defaults to 10 ms. */
  readonly baseDelayMs?: number;
  /** Backoff ceiling. Defaults to 1,000 ms. */
  readonly maxDelayMs?: number;
}

export interface TransactionOptions {
  /**
   * Explicit opt-in only: retrying re-runs the callback, including any side effects
   * outside the database. Keep those effects out of a retrying transaction body.
   */
  readonly retry?: TransactionRetryPolicy;
}

function nonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function retryPolicy(options: TransactionOptions | undefined): Required<TransactionRetryPolicy> | undefined {
  const policy = options?.retry;
  if (policy === undefined) return undefined;
  const baseDelayMs = policy.baseDelayMs ?? 10;
  const maxDelayMs = policy.maxDelayMs ?? 1000;
  nonNegativeInteger('retry.maxRetries', policy.maxRetries);
  nonNegativeInteger('retry.baseDelayMs', baseDelayMs);
  nonNegativeInteger('retry.maxDelayMs', maxDelayMs);
  return { maxRetries: policy.maxRetries, baseDelayMs, maxDelayMs };
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function canRetry(
  retryableCodes: readonly string[] | undefined,
  error: unknown,
  retries: number,
  policy: Required<TransactionRetryPolicy> | undefined,
): policy is Required<TransactionRetryPolicy> {
  if (retryableCodes === undefined || policy === undefined || retries >= policy.maxRetries) return false;
  const code = errorCode(error);
  return code !== undefined && retryableCodes.includes(code);
}

function backoff(policy: Required<TransactionRetryPolicy>, retry: number): number {
  return Math.min(policy.baseDelayMs * 2 ** (retry - 1), policy.maxDelayMs);
}

async function wait(milliseconds: number): Promise<void> {
  if (milliseconds === 0) return;
  await new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

interface ActiveTransactionStream {
  close(): Promise<void>;
}

function transactionClosedError(): Error {
  return new Error('cannot continue a stream after its transaction scope has closed');
}

function trackedTransactionStream(
  source: AsyncIterable<Record<string, unknown>>,
  active: Set<ActiveTransactionStream>,
  isOpen: () => boolean,
): AsyncIterable<Record<string, unknown>> {
  let started = false;
  let closed = false;
  let iterator: AsyncIterator<Record<string, unknown>> | undefined;
  let closing: Promise<void> | undefined;

  const stream: ActiveTransactionStream = {
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      if (closed) return Promise.resolve();
      closed = true;
      active.delete(stream);
      const current = iterator;
      iterator = undefined;
      closing = (async () => {
        if (current?.return !== undefined) await current.return();
      })();
      return closing;
    },
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
      if (started) throw new Error('transaction stream is single-shot');
      if (!isOpen()) throw transactionClosedError();
      started = true;
      iterator = source[Symbol.asyncIterator]();
      active.add(stream);

      return {
        async next(): Promise<IteratorResult<Record<string, unknown>>> {
          if (!isOpen()) throw transactionClosedError();
          const current = iterator;
          if (current === undefined) return { done: true, value: undefined };
          try {
            const result = await current.next();
            if (!isOpen()) {
              await stream.close();
              throw transactionClosedError();
            }
            if (result.done) {
              closed = true;
              iterator = undefined;
              active.delete(stream);
            }
            return result;
          } catch (error) {
            await stream.close();
            throw error;
          }
        },

        async return(): Promise<IteratorResult<Record<string, unknown>>> {
          await stream.close();
          return { done: true, value: undefined };
        },

        async throw(error?: unknown): Promise<IteratorResult<Record<string, unknown>>> {
          const current = iterator;
          try {
            if (current?.throw !== undefined) return await current.throw(error);
            throw error;
          } finally {
            await stream.close();
          }
        },
      };
    },
  };
}

export function createTransactionalDb(conn: TxConnection): TransactionalDb {
  let savepointSeq = 0;
  const retryableCodes = conn.dialect === undefined ? undefined : dialectTraits(conn.dialect).retryableCodes;

  const makeContext = <State extends string = 'active'>(): {
    readonly context: TransactionContext<State>;
    readonly close: () => Promise<void>;
  } => {
    let open = true;
    const activeStreams = new Set<ActiveTransactionStream>();
    const connectionStream = typeof conn.stream === 'function' ? conn.stream : undefined;

    const assertOpen = (): void => {
      if (!open) throw transactionClosedError();
    };

    const close = async (): Promise<void> => {
      if (!open) return;
      open = false;
      let firstFailure: unknown;
      let failed = false;
      for (const stream of activeStreams) {
        try {
          await stream.close();
        } catch (error) {
          if (!failed) firstFailure = error;
          failed = true;
        }
      }
      if (failed) throw firstFailure;
    };

    const context: TransactionContext<State> = {
      ...(conn.dialect === undefined ? {} : { dialect: conn.dialect }),
      execute: (query, opts) => {
        assertOpen();
        return conn.execute(query, opts);
      },
      ...(connectionStream === undefined
        ? {}
        : {
            stream: (query: CompiledQuery, opts?: ExecuteOptions) => {
              assertOpen();
              return trackedTransactionStream(connectionStream.call(conn, query, opts), activeStreams, () => open);
            },
          }),
      savepoint: async <R>(fn: (tx: TransactionContext<State>) => Promise<R>): Promise<R> => {
        assertOpen();
        const name = `s${++savepointSeq}`;
        await conn.raw(`SAVEPOINT ${name}`);
        const nested = makeContext<State>();
        try {
          const result = await fn(nested.context);
          await nested.close();
          await conn.raw(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          let failure = error;
          try {
            await nested.close();
          } catch (closeError) {
            failure = closeError;
          }
          await conn.raw(`ROLLBACK TO SAVEPOINT ${name}`);
          throw failure;
        }
      },
    };

    return { context, close };
  };

  return {
    async transaction<R, State extends string = 'active'>(
      fn: (tx: TransactionContext<State>) => Promise<R>,
      options?: TransactionOptions,
    ): Promise<R> {
      const policy = retryPolicy(options);
      let retries = 0;
      while (true) {
        savepointSeq = 0;
        await conn.raw('BEGIN');
        const scope = makeContext<State>();
        try {
          const result = await fn(scope.context);
          await scope.close();
          await conn.raw('COMMIT');
          return result;
        } catch (error) {
          let failure = error;
          try {
            await scope.close();
          } catch (closeError) {
            failure = closeError;
          }
          await conn.raw('ROLLBACK');
          if (!canRetry(retryableCodes, failure, retries, policy)) throw failure;
          retries++;
          await wait(backoff(policy, retries));
        }
      }
    },
  };
}

// #39 — explicit write-batching helper. Runs the given operations inside a
// single transaction / one flush: all-or-nothing. Each op receives the tx
// context and performs its own execute(s).
export function batch<R, State extends string = 'active'>(
  db: TransactionalDb,
  ops: readonly ((tx: TransactionContext<State>) => Promise<R>)[],
): Promise<R[]> {
  return db.transaction<R[], State>(async tx => {
    const results: R[] = [];
    for (const op of ops) results.push(await op(tx));
    return results;
  });
}
