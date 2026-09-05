// zmdb/transactions — explicit named re-exports.
export { batch, createTransactionalDb, markTransactionClosed } from '@zmdb/orm/transactions';
export type {
  ActiveTransactionContext,
  ClosedTransactionContext,
  TransactionContext,
  TransactionalDb,
  TransactionState,
  TxConnection,
} from '@zmdb/orm/transactions';
