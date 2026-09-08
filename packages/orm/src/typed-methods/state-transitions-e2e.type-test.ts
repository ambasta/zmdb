import { defineEntityStateMachine } from '@zmdb/app';
import { schemasFrom } from '@zmdb/compiler/testing';
import { markTransactionClosed, type ActiveTransactionContext, type ClosedTransactionContext } from '@zmdb/orm';
import { type Equal, type Expect } from '@zmdb/schema';
import { type PrimaryKey, type Serial, type Sql, type Table } from '@zmdb/schema/tags';

// Closed context type assertion
declare const activeTx: ActiveTransactionContext;
const closedTx = markTransactionClosed(activeTx);
type _TestClosedTx = Expect<Equal<typeof closedTx, ClosedTransactionContext>>;

function processActiveTx(tx: ActiveTransactionContext) {
  return tx;
}

// @ts-expect-error - ClosedTransactionContext cannot be passed where ActiveTransactionContext is required
processActiveTx(closedTx);

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  customerEmail: string & Sql<'text'>;
  status: string & Sql<'text'>;
}

const { Order: OrderSchema } = schemasFrom<{ Order: Order }>(import.meta.url, ['Order']);

const orderStateMachine = defineEntityStateMachine({
  schema: OrderSchema,
  stateField: 'status',
  transitions: {
    draft: ['pending', 'cancelled'],
    pending: ['paid', 'cancelled'],
  } as const,
  allowedFields: {
    draft: ['status'],
    pending: ['status'],
  } as const,
});

// @ts-expect-error - 'fulfilled' is not an allowed target state from 'draft'
orderStateMachine.createUpdatePayload('draft', 'fulfilled');

// @ts-expect-error - 'customerEmail' is not allowed to be patched in 'pending' state
orderStateMachine.createUpdatePayload('pending', 'paid', { customerEmail: 'hacker@example.com' });
