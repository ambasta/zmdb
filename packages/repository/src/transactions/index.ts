// Transactions — implementation (#36 transaction context primitive).
// createTransactionalDb.transaction() issues BEGIN/COMMIT/ROLLBACK and
// tx.savepoint() issues SAVEPOINT / RELEASE / ROLLBACK TO SAVEPOINT.
import type { CompiledQuery } from '@zmdb/query-compiler';

export type TransactionState = 'active' | 'closed' | 'committed' | 'rolled_back' | string;

export interface TransactionContext<State extends string = 'active'> {
  readonly _state?: State;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  savepoint<R>(fn: (tx: TransactionContext<State>) => Promise<R>): Promise<R>;
}

export type ActiveTransactionContext = TransactionContext<'active'>;
export type ClosedTransactionContext = TransactionContext<'closed'>;

export function markTransactionClosed<State extends string = 'active'>(
  tx: TransactionContext<State>,
): ClosedTransactionContext {
  // boundary: _state is a phantom type parameter on TransactionContext; re-branding tx to ClosedTransactionContext updates the compile-time state brand to 'closed' without runtime overhead or object mutation.
  return tx as ClosedTransactionContext;
}

export interface TxConnection {
  raw(sql: string): Promise<void>;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface TransactionalDb {
  transaction<R, State extends string = 'active'>(fn: (tx: TransactionContext<State>) => Promise<R>): Promise<R>;
}

export function createTransactionalDb(conn: TxConnection): TransactionalDb {
  let savepointSeq = 0;

  const makeContext = <State extends string = 'active'>(): TransactionContext<State> => ({
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
    ): Promise<R> {
      savepointSeq = 0;
      await conn.raw('BEGIN');
      try {
        const result = await fn(makeContext<State>());
        await conn.raw('COMMIT');
        return result;
      } catch (err) {
        await conn.raw('ROLLBACK');
        throw err;
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
