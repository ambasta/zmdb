import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach } from 'vitest';

import { createTransactionalDb, batch, type TxConnection } from './index.ts';

// #39: explicit write-batching helper + E2E (real SQLite atomicity).

// A TxConnection backed by node:sqlite.
function sqliteTxConn(db: DatabaseSync): TxConnection {
  return {
    async raw(sql: string) {
      db.exec(sql);
    },
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as unknown[];
      if (/^\s*SELECT/i.test(q.text)) return stmt.all(...params) as Record<string, unknown>[];
      stmt.run(...params);
      return [];
    },
  };
}

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)');
});

function count(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n;
}

describe('batch E2E (real SQLite)', () => {
  it('commits all writes in a batch', async () => {
    const dbx = createTransactionalDb(sqliteTxConn(db));
    await batch(dbx, [
      tx => tx.execute({ text: 'INSERT INTO t(id, v) VALUES (?, ?)', parameters: [1, 10] }),
      tx => tx.execute({ text: 'INSERT INTO t(id, v) VALUES (?, ?)', parameters: [2, 20] }),
    ]);
    expect(count()).toBe(2);
  });

  it('persists nothing when any op in the batch fails (all-or-nothing)', async () => {
    const dbx = createTransactionalDb(sqliteTxConn(db));
    await expect(
      batch(dbx, [
        tx => tx.execute({ text: 'INSERT INTO t(id, v) VALUES (?, ?)', parameters: [1, 10] }),
        // Duplicate PK → constraint violation → whole batch rolls back.
        tx => tx.execute({ text: 'INSERT INTO t(id, v) VALUES (?, ?)', parameters: [1, 99] }),
      ]),
    ).rejects.toBeTruthy();
    expect(count()).toBe(0);
  });
});
