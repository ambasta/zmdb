// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createTransactionalDb } from '@zmdb/orm/transactions';
import { describe, it, expect } from 'vitest';

import { recordingConn } from './recording-conn.js';

// #38: savepoints / nested transactions.

describe('nested transactions / savepoints', () => {
  it('nested savepoints use distinct names and release on success', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);
    await db.transaction(async tx => {
      await tx.savepoint(async inner => {
        await inner.savepoint(async innermost => {
          await innermost.execute({
            effects: { operation: 'UNKNOWN', requiresPrimary: true, returnsRows: false },
            text: 'X',
            parameters: [],
          });
        });
      });
    });
    expect(conn.log).toEqual([
      'BEGIN',
      'SAVEPOINT s1',
      'SAVEPOINT s2',
      'EXEC',
      'RELEASE SAVEPOINT s2',
      'RELEASE SAVEPOINT s1',
      'COMMIT',
    ]);
  });

  it('inner savepoint rollback preserves outer writes (outer commits)', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);
    await db.transaction(async tx => {
      await tx.execute({
        effects: { operation: 'UNKNOWN', requiresPrimary: true, returnsRows: false },
        text: 'OUTER',
        parameters: [],
      });
      await tx
        .savepoint(async () => {
          throw new Error('inner failed');
        })
        .catch(() => {});
    });
    expect(conn.log).toEqual(['BEGIN', 'EXEC', 'SAVEPOINT s1', 'ROLLBACK TO SAVEPOINT s1', 'COMMIT']);
  });
});
