import { describe, it, expect } from 'vitest';

import { createTransactionalDb, type TxConnection } from './index.ts';

// RED PHASE (#35 spec freeze): transaction lifecycle SQL ordering.

function recordingConn(): TxConnection & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async raw(sql: string) {
      log.push(sql);
    },
    async execute() {
      log.push('EXEC');
      return [];
    },
  };
}

describe('transaction lifecycle', () => {
  it('commits on success (BEGIN … COMMIT)', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);
    await db.transaction(async tx => {
      await tx.execute({ text: 'X', parameters: [] });
    });
    expect(conn.log).toEqual(['BEGIN', 'EXEC', 'COMMIT']);
  });

  it('rolls back on throw (BEGIN … ROLLBACK)', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);
    await expect(
      db.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(conn.log).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('savepoint releases on success', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);
    await db.transaction(async tx => {
      await tx.savepoint(async inner => {
        await inner.execute({ text: 'X', parameters: [] });
      });
    });
    expect(conn.log).toEqual(['BEGIN', 'SAVEPOINT s1', 'EXEC', 'RELEASE SAVEPOINT s1', 'COMMIT']);
  });

  it('savepoint rolls back to savepoint on inner throw, outer commits', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);
    await db.transaction(async tx => {
      await tx.execute({ text: 'OUTER', parameters: [] });
      await tx
        .savepoint(async () => {
          throw new Error('inner');
        })
        .catch(() => {});
    });
    expect(conn.log).toEqual(['BEGIN', 'EXEC', 'SAVEPOINT s1', 'ROLLBACK TO SAVEPOINT s1', 'COMMIT']);
  });
});
