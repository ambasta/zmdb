import { defineSchema, serial, text, defineEntityStateMachine } from '@zmdb/schema-core';

import { markTransactionClosed, type ActiveTransactionContext, type ClosedTransactionContext } from '../index.ts';

export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export type Expect<T extends true> = T;

// Closed context type assertion
declare const activeTx: ActiveTransactionContext;
const closedTx = markTransactionClosed(activeTx);
type _TestClosedTx = Expect<Equal<typeof closedTx, ClosedTransactionContext>>;

function processActiveTx(tx: ActiveTransactionContext) {
  return tx;
}

// @ts-expect-error - ClosedTransactionContext cannot be passed where ActiveTransactionContext is required
processActiveTx(closedTx);

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  customerEmail: text().notNull(),
  status: text().notNull(),
});

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
