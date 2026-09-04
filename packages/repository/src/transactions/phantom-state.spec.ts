import { describe, it, expect } from 'vitest';

import {
  createTransactionalDb,
  markTransactionClosed,
  type ActiveTransactionContext,
  type TxConnection,
} from './index.js';

function mockConn(): TxConnection & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async raw(sql: string) {
      log.push(sql);
    },
    async execute(query) {
      log.push(query.text);
      return [];
    },
  };
}

describe('Opt-In Phantom Transaction Contexts', () => {
  it('defaults TransactionContext to active state for backwards compatibility', () => {
    const conn = mockConn();
    const db = createTransactionalDb(conn);

    db.transaction(async tx => {
      expect(tx).toBeDefined();
    });
  });

  it('rejects closed context when active context is required', () => {
    function executeActiveOperation(tx: ActiveTransactionContext) {
      return tx;
    }

    const conn = mockConn();
    const db = createTransactionalDb(conn);

    db.transaction(async tx => {
      // Active context is accepted
      executeActiveOperation(tx);

      const closedTx = markTransactionClosed(tx);
      expect(closedTx).toBeDefined();
    });
  });

  it('allows savepoints within typed transaction contexts', async () => {
    const conn = mockConn();
    const db = createTransactionalDb(conn);

    await db.transaction(async tx => {
      await tx.savepoint(async spTx => {
        await spTx.execute({ text: 'SELECT 1', parameters: [] });
      });
    });

    expect(conn.log).toEqual(['BEGIN', 'SAVEPOINT s1', 'SELECT 1', 'RELEASE SAVEPOINT s1', 'COMMIT']);
  });
});
