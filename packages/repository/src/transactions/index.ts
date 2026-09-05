// Transactions — implementation (#36 transaction context primitive).
// createTransactionalDb.transaction() issues BEGIN/COMMIT/ROLLBACK and
// tx.savepoint() issues SAVEPOINT / RELEASE / ROLLBACK TO SAVEPOINT.
import { TRAITS, type CompiledQuery, type Dialect } from '@zmdb/query-compiler';

export type TransactionState = 'active' | 'closed' | 'committed' | 'rolled_back' | string;

export interface TransactionContext<State extends string = 'active'> {
  readonly _state?: State | undefined;
  readonly dialect?: Dialect;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  savepoint<R>(fn: (tx: TransactionContext<State>) => Promise<R>): Promise<R>;
}

export type ActiveTransactionContext = TransactionContext<'active'>;
export type ClosedTransactionContext = TransactionContext<'closed'>;

export function markTransactionClosed<State extends string = 'active'>(
  tx: TransactionContext<State>,
): ClosedTransactionContext {
  return {
    _state: 'closed',
    ...(tx.dialect === undefined ? {} : { dialect: tx.dialect }),
    execute: query => tx.execute(query),
    savepoint: <R>(fn: (ctx: ClosedTransactionContext) => Promise<R>): Promise<R> =>
      tx.savepoint(innerTx => fn(markTransactionClosed(innerTx))),
  };
}

export interface TxConnection {
  readonly dialect?: Dialect;
  raw(sql: string): Promise<void>;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
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
  dialect: Dialect | undefined,
  error: unknown,
  retries: number,
  policy: Required<TransactionRetryPolicy> | undefined,
): policy is Required<TransactionRetryPolicy> {
  if (dialect === undefined || policy === undefined || retries >= policy.maxRetries) return false;
  const code = errorCode(error);
  return code !== undefined && TRAITS[dialect].retryableCodes.includes(code);
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

export function createTransactionalDb(conn: TxConnection): TransactionalDb {
  let savepointSeq = 0;

  const makeContext = <State extends string = 'active'>(): TransactionContext<State> => ({
    ...(conn.dialect === undefined ? {} : { dialect: conn.dialect }),
    execute: query => conn.execute(query),
    savepoint: async <R>(fn: (tx: TransactionContext<State>) => Promise<R>): Promise<R> => {
      const name = `s${++savepointSeq}`;
      await conn.raw(`SAVEPOINT ${name}`);
      try {
        const result = await fn(makeContext<State>());
        await conn.raw(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (err) {
        await conn.raw(`ROLLBACK TO SAVEPOINT ${name}`);
        throw err;
      }
    },
  });

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
        try {
          const result = await fn(makeContext<State>());
          await conn.raw('COMMIT');
          return result;
        } catch (err) {
          await conn.raw('ROLLBACK');
          if (!canRetry(conn.dialect, err, retries, policy)) throw err;
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
