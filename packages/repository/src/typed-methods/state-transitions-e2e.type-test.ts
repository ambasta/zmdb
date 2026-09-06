import { schemasFrom } from '@zmdb/compiler/testing';
import { defineEntityStateMachine } from '@zmdb/schema-core';
import type { Equal, Expect } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

import { markTransactionClosed, type ActiveTransactionContext, type ClosedTransactionContext } from '../index.js';

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
