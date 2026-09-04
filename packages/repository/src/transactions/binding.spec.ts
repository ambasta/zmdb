import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect } from 'vitest';

import { BaseRepository, defineRepository, type Driver } from '../index.js';
import { createTransactionalDb } from './index.js';
import { recordingConn } from './recording-conn.js';

// #37: transaction-scoped repository binding.

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

const { User: UserSchema } = schemasFrom<{ User: User }>(import.meta.url, ['User']);

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

class CustomRepoWithPrivateState extends BaseRepository<User> {
  static override readonly schema = UserSchema;
  #privatePrefix = 'USER';
  #privateCounter = 0;

  #formatEmail(email: string) {
    this.#privateCounter++;
    return `${this.#privatePrefix}:${this.#privateCounter}:${email}`;
  }

  async findFormatted(id: number) {
    const user = await this.findById(id);
    if (!user) return undefined;
    return {
      ...user,
      formattedEmail: this.#formatEmail((user as { email: string }).email),
    };
  }

  getFormattedArrow = async (id: number) => {
    return this.findFormatted(id);
  };
}

// A connection that records every raw + executed statement in order.
const boundConn = () => recordingConn({ label: q => `EXEC:${q.text}`, rows: [{ id: 1, email: 'a@b.com' }] });

describe('transaction-scoped repository binding', () => {
  it('routes repository SQL through the active transaction', async () => {
    const conn = boundConn();
    const db = createTransactionalDb(conn);

    await db.transaction(async tx => {
      // Bind the repository to the transaction: all its SQL runs on tx.
      const users = new UserRepository({} as Driver).withTransaction(tx);
      await users.findById(1);
    });

    // Read happened between BEGIN and COMMIT, on the tx connection.
    expect(conn.log[0]).toBe('BEGIN');
    expect(conn.log.at(-1)).toBe('COMMIT');
    expect(conn.log.some(l => l.startsWith('EXEC:SELECT'))).toBe(true);
  });

  it('two writes in one tx both roll back on failure', async () => {
    const conn = boundConn();
    const db = createTransactionalDb(conn);

    await expect(
      db.transaction(async tx => {
        const users = new UserRepository({} as Driver).withTransaction(tx);
        await users.findById(1);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(conn.log.at(-1)).toBe('ROLLBACK');
  });

  it('accesses private instance variables and methods without throwing runtime errors', async () => {
    const conn = boundConn();
    const db = createTransactionalDb(conn);
    const parent = new CustomRepoWithPrivateState({} as Driver);

    await db.transaction(async tx => {
      const scoped = parent.withTransaction(tx);
      const res = await scoped.findFormatted(1);
      expect(res).toEqual({ id: 1, email: 'a@b.com', formattedEmail: 'USER:1:a@b.com' });
      const res2 = await scoped.getFormattedArrow(1);
      expect(res2).toEqual({ id: 1, email: 'a@b.com', formattedEmail: 'USER:2:a@b.com' });
    });
  });

  it('leaves parent repository instance and driver state completely unmodified', async () => {
    const parentLog: string[] = [];
    const parentDriver: Driver = {
      async execute(q) {
        parentLog.push(q.text);
        return [];
      },
    };
    const parent = new UserRepository(parentDriver);

    const conn = boundConn();
    const db = createTransactionalDb(conn);

    await db.transaction(async tx => {
      const scoped = parent.withTransaction(tx);
      await scoped.findById(1);
    });

    // Parent driver should NOT have logged any queries
    expect(parentLog).toHaveLength(0);
    expect(conn.log.some(l => l.startsWith('EXEC:SELECT'))).toBe(true);
  });

  it('retains the schema on a dynamically generated subclass', async () => {
    // This used to assert a static `relations` map survived the re-instantiation too. It
    // has one thing to check now: the schema is where the relations live, so a scoped repo
    // that still has the schema still has them. (`typed-population-join.spec.ts` populates
    // through a transaction, which is the same claim from the other end.)
    const dynamicParent = defineRepository(UserSchema, {} as Driver, { dialect: 'sqlite' });

    const conn = boundConn();
    const db = createTransactionalDb(conn);

    await db.transaction(async tx => {
      const scoped = dynamicParent.withTransaction(tx);

      expect((scoped as unknown as { schema: unknown }).schema).toBe(UserSchema);

      // Verify findById executes on tx driver with sqlite qb dialect
      await scoped.findById(1);
    });

    expect(conn.log.some(l => l.startsWith('EXEC:SELECT'))).toBe(true);
  });
});
