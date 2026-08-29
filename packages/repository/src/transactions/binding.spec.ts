import { describe, it, expect } from 'vitest';
import { BaseRepository, type Driver } from '../index.ts';
import { createTransactionalDb, type TxConnection } from './index.ts';
import type { CoreSchema } from '@zmdb/schema-core';

// #37: transaction-scoped repository binding. Tests written BEFORE impl (TDD).

const UserSchema = {
  table: 'users',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    email: { type: 'text', flags: { nullable: false } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'users'>;

class UserRepository extends BaseRepository<typeof UserSchema> {
  static override readonly schema = UserSchema;
}

// A connection that records every raw + executed statement in order.
function recordingConn(): TxConnection & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async raw(sql: string) {
      log.push(sql);
    },
    async execute(q) {
      log.push(`EXEC:${q.text}`);
      return [{ id: 1, email: 'a@b.com' }];
    },
  };
}

describe('transaction-scoped repository binding', () => {
  it('routes repository SQL through the active transaction', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);

    await db.transaction(async (tx) => {
      // Bind the repository to the transaction: all its SQL runs on tx.
      const users = new UserRepository({} as Driver).withTransaction(tx);
      await users.findById(1);
    });

    // Read happened between BEGIN and COMMIT, on the tx connection.
    expect(conn.log[0]).toBe('BEGIN');
    expect(conn.log.at(-1)).toBe('COMMIT');
    expect(conn.log.some((l) => l.startsWith('EXEC:SELECT'))).toBe(true);
  });

  it('two writes in one tx both roll back on failure', async () => {
    const conn = recordingConn();
    const db = createTransactionalDb(conn);

    await expect(
      db.transaction(async (tx) => {
        const users = new UserRepository({} as Driver).withTransaction(tx);
        await users.findById(1);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(conn.log.at(-1)).toBe('ROLLBACK');
  });
});
