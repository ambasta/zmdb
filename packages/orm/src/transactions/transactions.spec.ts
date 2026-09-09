// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createTransactionalDb } from '@zmdb/orm/transactions';
import { describe, it, expect } from 'vitest';

import { cockroachDialect, mssqlDialect, mysqlDialect, sqliteDialect } from '../testing/official-dialects.fixture.js';
import { recordingConn } from './recording-conn.js';

// RED PHASE (#35 spec freeze): transaction lifecycle SQL ordering.

class DriverError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// The shapes the drivers actually throw. `pg` is `DriverError` above; the other three put the database's
// own number somewhere other than `code`, which is what `canRetry` has to read.
function driverError(message: string, properties: Readonly<Record<string, string | number>>): Error {
  return Object.assign(new Error(message), properties);
}

describe('transaction lifecycle', () => {
  it('commits on success (BEGIN … COMMIT)', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);
    await db.transaction(async tx => {
      await tx.execute({
        effects: { operation: 'UNKNOWN', requiresPrimary: true, returnsRows: false },
        text: 'X',
        parameters: [],
      });
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
        await inner.execute({
          effects: { operation: 'UNKNOWN', requiresPrimary: true, returnsRows: false },
          text: 'X',
          parameters: [],
        });
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

  // Rolling an inner savepoint back while the outer transaction still commits is
  // covered by `savepoints.spec.ts`, which owns the #38 nesting rules.
});

describe('retryable codes across driver error shapes', () => {
  const retry = { retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } } as const;

  it('retries a mysql2 deadlock, which names the error on code and numbers it on errno', async () => {
    const conn = recordingConn({ dialect: mysqlDialect });
    const db = createTransactionalDb(conn);
    let attempts = 0;

    const result = await db.transaction(async () => {
      attempts++;
      if (attempts < 2) {
        throw driverError('Deadlock found when trying to get lock', {
          code: 'ER_LOCK_DEADLOCK',
          errno: 1213,
          sqlState: '40001',
        });
      }
      return 'committed';
    }, retry);

    expect(result).toBe('committed');
    expect(attempts).toBe(2);
  });

  it('retries a node:sqlite busy error, which carries the result code on errcode', async () => {
    const conn = recordingConn({ dialect: sqliteDialect });
    const db = createTransactionalDb(conn);
    let attempts = 0;

    const result = await db.transaction(async () => {
      attempts++;
      if (attempts < 2) {
        throw driverError('database is locked', {
          code: 'ERR_SQLITE_ERROR',
          errcode: 5,
          errstr: 'database is locked',
        });
      }
      return 'committed';
    }, retry);

    expect(result).toBe('committed');
    expect(attempts).toBe(2);
  });

  it('retries an mssql deadlock victim, which carries the number on number', async () => {
    const conn = recordingConn({ dialect: mssqlDialect });
    const db = createTransactionalDb(conn);
    let attempts = 0;

    const result = await db.transaction(async () => {
      attempts++;
      if (attempts < 2) throw driverError('Transaction was deadlocked', { code: 'EREQUEST', number: 1205 });
      return 'committed';
    }, retry);

    expect(result).toBe('committed');
    expect(attempts).toBe(2);
  });

  it('does not retry a constraint violation that shares the drivers-put-it-elsewhere shape', async () => {
    const conn = recordingConn({ dialect: mysqlDialect });
    const db = createTransactionalDb(conn);
    let attempts = 0;

    await expect(
      db.transaction(async () => {
        attempts++;
        throw driverError('Duplicate entry', { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000' });
      }, retry),
    ).rejects.toThrow('Duplicate entry');

    expect(attempts).toBe(1);
    expect(conn.log).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('classifies lock contention on every official dialect', () => {
    for (const dialect of [cockroachDialect, mssqlDialect, mysqlDialect, sqliteDialect]) {
      expect(dialect.traits.retryableCodes.length).toBeGreaterThan(0);
    }
  });
});
