import { describe, it, expect } from 'vitest';

import { cockroachDialect, postgresDialect } from '../testing/official-dialects.fixture.js';
import { createTransactionalDb } from './index.js';
import { recordingConn } from './recording-conn.js';

// RED PHASE (#35 spec freeze): transaction lifecycle SQL ordering.

class DriverError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
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

  it('does not retry a transaction unless the caller opts in', async () => {
    const conn = recordingConn({ dialect: cockroachDialect });
    const db = createTransactionalDb(conn);
    let attempts = 0;

    await expect(
      db.transaction(async () => {
        attempts++;
        throw new DriverError('40001');
      }),
    ).rejects.toThrow('40001');

    expect(attempts).toBe(1);
    expect(conn.log).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('retries a serialisation failure the specified number of times', async () => {
    const conn = recordingConn({ dialect: cockroachDialect });
    const db = createTransactionalDb(conn);
    let attempts = 0;

    const result = await db.transaction(
      async () => {
        attempts++;
        if (attempts < 3) throw new DriverError('40001');
        return 'committed';
      },
      { retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } },
    );

    expect(result).toBe('committed');
    expect(attempts).toBe(3);
    expect(conn.log).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
  });

  it('does not retry a code the dialect does not classify as retryable', async () => {
    const conn = recordingConn({ dialect: cockroachDialect });
    const db = createTransactionalDb(conn);
    let attempts = 0;

    await expect(
      db.transaction(
        async () => {
          attempts++;
          throw new DriverError('23505');
        },
        { retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } },
      ),
    ).rejects.toThrow('23505');

    expect(attempts).toBe(1);
    expect(conn.log).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('propagates dialect metadata across transaction contexts', async () => {
    const conn = { ...recordingConn(), dialect: postgresDialect };
    const db = createTransactionalDb(conn);
    await db.transaction(async tx => {
      expect(tx.dialect).toBe(postgresDialect);
      await tx.savepoint(async inner => {
        expect(inner.dialect).toBe(postgresDialect);
      });
    });
  });

  // Rolling an inner savepoint back while the outer transaction still commits is
  // covered by `savepoints.spec.ts`, which owns the #38 nesting rules.
});
