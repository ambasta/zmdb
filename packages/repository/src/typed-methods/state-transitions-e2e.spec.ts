import { schemasFrom } from '@zmdb/compiler/testing';
import { defineEntityStateMachine, defineStateTransitions, type StateUpdateDTO } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, vi } from 'vitest';

import {
  BaseRepository,
  createTransactionalDb,
  markTransactionClosed,
  type Driver,
  type TransactionContext,
  type ActiveTransactionContext,
} from '../index.js';

// ---------------------------------------------------------------------------
// Domain Workflow 1: Order Processing Lifecycle
// States: draft -> pending -> paid -> fulfilled / cancelled
// ---------------------------------------------------------------------------
export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  customerEmail: string & Sql<'text'>;
  totalAmount: number & Sql<'numeric'>;
  status: string & Sql<'text'>;
}

export interface Article extends Table<'articles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  body: string & Sql<'text'>;
  status: string & Sql<'text'>;
}

const { Order: OrderSchema, Article: ArticleSchema } = schemasFrom<{ Order: Order; Article: Article }>(
  import.meta.url,
  ['Order', 'Article'],
);

class OrderRepository extends BaseRepository<Order> {
  static override readonly schema = OrderSchema;
}

const orderStateMachine = defineEntityStateMachine({
  schema: OrderSchema,
  stateField: 'status',
  transitions: {
    draft: ['pending', 'cancelled'],
    pending: ['paid', 'cancelled'],
    paid: ['fulfilled', 'cancelled'],
    fulfilled: [],
    cancelled: [],
  } as const,
  allowedFields: {
    draft: ['totalAmount', 'status'],
    pending: ['status'],
    paid: ['status'],
  } as const,
});

// ---------------------------------------------------------------------------
// Domain Workflow 2: Content Publishing Lifecycle
// States: draft -> in_review -> published -> archived
// ---------------------------------------------------------------------------
class ArticleRepository extends BaseRepository<Article> {
  static override readonly schema = ArticleSchema;
}

const articleTransitions = defineStateTransitions({
  draft: ['in_review', 'published'],
  in_review: ['published', 'draft'],
  published: ['archived'],
  archived: [],
} as const);

describe('Core Domain Workflows: Opt-In Type-State Validation', () => {
  it('Workflow 1: Order Processing Lifecycle state transitions & repository updates', async () => {
    const execute = vi.fn(async (q: { text: string }) => {
      if (q.text.includes('UPDATE')) {
        return [{ id: 101, customerEmail: 'alice@example.com', totalAmount: 150, status: 'pending' }];
      }
      return [];
    });

    const repo = new OrderRepository({ execute } as Driver);

    // 1. Valid transition from 'draft' to 'pending'
    const pendingPayload = orderStateMachine.createUpdatePayload('draft', 'pending', {
      totalAmount: 150,
    });

    const updatedOrder = await repo.update(101, pendingPayload);
    expect(updatedOrder?.status).toBe('pending');
    expect(execute).toHaveBeenCalledTimes(1);

    // 2. Compile-time check: invalid transition 'draft' -> 'fulfilled' fails
    expect(() =>
      // @ts-expect-error - 'fulfilled' is not an allowed target state from 'draft'
      orderStateMachine.createUpdatePayload('draft', 'fulfilled'),
    ).toThrow('Invalid state transition from "draft" to "fulfilled" for field "status"');

    // 3. Compile-time check: invalid field patch on 'pending' state
    // @ts-expect-error - 'customerEmail' is not allowed to be patched in 'pending' state
    orderStateMachine.createUpdatePayload('pending', 'paid', { customerEmail: 'hacker@example.com' });
  });

  it('Workflow 2: Content Publishing Lifecycle with transaction context state validation', async () => {
    const log: string[] = [];
    const mockConn = {
      async raw(sql: string) {
        log.push(sql);
      },
      async execute(q: { text: string }) {
        log.push(q.text);
        if (q.text.includes('UPDATE')) {
          return [{ id: 1, title: 'JS Design Patterns', body: 'Content', status: 'published' }];
        }
        return [];
      },
    };

    const txDb = createTransactionalDb(mockConn);
    const repo = new ArticleRepository({ execute: q => mockConn.execute(q) } as Driver);

    await txDb.transaction(async (tx: TransactionContext<'active'>) => {
      const txRepo = repo.withTransaction(tx);

      // Construct a valid state transition payload for 'draft' -> 'published'
      const publishPayload: StateUpdateDTO<Article, 'status', 'draft', typeof articleTransitions> = {
        status: 'published',
        title: 'JS Design Patterns',
      };

      const article = await txRepo.update(1, publishPayload);
      expect(article?.status).toBe('published');

      // Helper requiring active transaction context
      function processActiveTx(activeTx: ActiveTransactionContext) {
        expect(activeTx).toBeDefined();
      }

      processActiveTx(tx);

      const closedTx = markTransactionClosed(tx);
      expect(closedTx).toBeDefined();
    });

    expect(log).toContain('BEGIN');
    expect(log).toContain('COMMIT');
  });
});
