// Transactions — API stubs (red phase). Implementation in #36–#39.
import type { CompiledQuery } from '@zmdb/query-compiler';

const NOT_IMPL = 'not implemented';

export interface TransactionContext {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  savepoint<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R>;
}

// A connection capable of raw SQL (BEGIN/COMMIT/etc are issued as raw strings).
export interface TxConnection {
  raw(sql: string): Promise<void>;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface TransactionalDb {
  transaction<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R>;
}

export function createTransactionalDb(_conn: TxConnection): TransactionalDb {
  throw new Error(NOT_IMPL);
}
