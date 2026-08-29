// Transactions — implementation (#36 transaction context primitive).
// createTransactionalDb.transaction() issues BEGIN/COMMIT/ROLLBACK and
// tx.savepoint() issues SAVEPOINT / RELEASE / ROLLBACK TO SAVEPOINT.
import type { CompiledQuery } from '@zmdb/query-compiler';

export interface TransactionContext {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  savepoint<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R>;
}

export interface TxConnection {
  raw(sql: string): Promise<void>;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface TransactionalDb {
  transaction<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R>;
}

export function createTransactionalDb(conn: TxConnection): TransactionalDb {
  let savepointSeq = 0;

  const makeContext = (): TransactionContext => ({
    execute: (query) => conn.execute(query),
    savepoint: async <R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R> => {
      const name = `s${++savepointSeq}`;
      await conn.raw(`SAVEPOINT ${name}`);
      try {
        const result = await fn(makeContext());
        await conn.raw(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (err) {
        await conn.raw(`ROLLBACK TO SAVEPOINT ${name}`);
        throw err;
      }
    },
  });

  return {
    async transaction<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R> {
      savepointSeq = 0;
      await conn.raw('BEGIN');
      try {
        const result = await fn(makeContext());
        await conn.raw('COMMIT');
        return result;
      } catch (err) {
        await conn.raw('ROLLBACK');
        throw err;
      }
    },
  };
}
