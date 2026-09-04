// zmdb/transactions — explicit named re-exports.
export { batch, createTransactionalDb, markTransactionClosed } from '@zmdb/repository/transactions';
export type {
  ActiveTransactionContext,
  ClosedTransactionContext,
  TransactionContext,
  TransactionalDb,
  TransactionState,
  TxConnection,
} from '@zmdb/repository/transactions';
