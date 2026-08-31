import {
  markTransactionClosed,
  type TransactionContext,
  type ActiveTransactionContext,
  type ClosedTransactionContext,
} from './index.ts';

export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export type Expect<T extends true> = T;

// 1. TransactionContext defaults to 'active'
type _TestDefaultTxContext = Expect<Equal<TransactionContext, TransactionContext<'active'>>>;
type _TestActiveTxContext = Expect<Equal<TransactionContext, ActiveTransactionContext>>;

// 2. State parameter on context
type ActiveTx = TransactionContext<'active'>;
type ClosedTx = TransactionContext<'closed'>;
type _TestActiveTxState = Expect<Equal<ActiveTx['_state'], 'active' | undefined>>;
type _TestClosedTxState = Expect<Equal<ClosedTx['_state'], 'closed' | undefined>>;

// 3. markTransactionClosed returns ClosedTransactionContext
declare const activeTx: ActiveTransactionContext;
const closedTx = markTransactionClosed(activeTx);
type _TestMarkClosed = Expect<Equal<typeof closedTx, ClosedTransactionContext>>;

// 4. ClosedTransactionContext cannot be passed to function requiring ActiveTransactionContext
function executeActiveOperation(tx: ActiveTransactionContext) {
  return tx;
}
executeActiveOperation(activeTx);

// @ts-expect-error - ClosedTransactionContext is not assignable to ActiveTransactionContext
executeActiveOperation(closedTx);

// 5. Savepoints retain active context
declare const dbTx: TransactionContext<'active'>;
void dbTx.savepoint(async spTx => {
  type _TestSavepointTx = Expect<Equal<typeof spTx, TransactionContext<'active'>>>;
});
