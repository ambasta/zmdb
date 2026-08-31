import { describe, it, expect } from 'vitest';

import { createTransactionalDb } from './index.ts';
import { recordingConn } from './recording-conn.ts';

// RED PHASE (#35 spec freeze): transaction lifecycle SQL ordering.

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

  // Rolling an inner savepoint back while the outer transaction still commits is
  // covered by `savepoints.spec.ts`, which owns the #38 nesting rules.
});
