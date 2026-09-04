import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import { createQueryCompiler } from '@zmdb/query-compiler';
import type { OneToMany, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect } from 'vitest';

import { sqliteDriver } from './drivers/sqlite.js';
import { defineRepository, type Driver } from './index.js';

export interface Users extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  orders?: Orders[] & OneToMany<'orders', 'userId'>;
}

export interface Orders extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'integer'>;
}

const { Users: UsersSchema } = schemasFrom<{ Users: Users; Orders: Orders }>(import.meta.url, ['Users', 'Orders']);

describe('Native Builder whereIn with Parameter Chunking', () => {
  it('exposes dedicated set-matching methods that output parameterized SQL IN clauses', () => {
    const qb = createQueryCompiler('postgres');

    const selectQuery = qb
      .selectFrom('users')
      .whereIn('id', [10, 20, 30])
      .andWhereNotIn('status', ['archived'])
      .compile();

    expect(selectQuery.text).toBe('SELECT * FROM "users" WHERE "id" IN ($1, $2, $3) AND "status" NOT IN ($4)');
    expect(selectQuery.parameters).toEqual([10, 20, 30, 'archived']);

    const updateQuery = qb.updateTable('users').set({ status: 'active' }).whereIn('id', [1, 2]).compile();

    expect(updateQuery.text).toBe('UPDATE "users" SET "status" = $1 WHERE "id" IN ($2, $3)');
    expect(updateQuery.parameters).toEqual(['active', 1, 2]);

    const deleteQuery = qb.deleteFrom('users').whereNotIn('id', [100]).compile();

    expect(deleteQuery.text).toBe('DELETE FROM "users" WHERE "id" NOT IN ($1)');
    expect(deleteQuery.parameters).toEqual([100]);
  });

  it('filters out null and undefined key values before query building in batch relation queries', async () => {
    const executedQueries: string[] = [];
    const mockDriver: Driver = {
      async execute(q) {
        executedQueries.push(q.text);
        if (q.text.includes('orders')) {
          return [
            { id: 101, userId: 1, total: 50 },
            { id: 102, userId: 2, total: 75 },
          ];
        }
        return [];
      },
    };

    const repo = defineRepository(UsersSchema, mockDriver);

    const parents = [
      { id: 1, name: 'Alice' },
      { id: null, name: 'NullParent' },
      { id: undefined, name: 'UndefinedParent' },
      { id: 2, name: 'Bob' },
    ];

    // Call attachRelations via private access cast
    const populated = await (
      repo as unknown as {
        attachRelations(p: Record<string, unknown>[], r: string[]): Promise<Record<string, unknown>[]>;
      }
    ).attachRelations(parents, ['orders']);

    // Check that the executed query received ONLY [1, 2], not null or undefined
    expect(executedQueries.length).toBe(1);
    expect(executedQueries[0]).toBe('SELECT * FROM "orders" WHERE "userId" IN ($1, $2)');

    // Verify parents mapped correctly
    expect((populated[0] as unknown as { orders: unknown[] }).orders).toEqual([{ id: 101, userId: 1, total: 50 }]);
    expect((populated[1] as unknown as { orders: unknown[] }).orders).toEqual([]);
    expect((populated[2] as unknown as { orders: unknown[] }).orders).toEqual([]);
    expect((populated[3] as unknown as { orders: unknown[] }).orders).toEqual([{ id: 102, userId: 2, total: 75 }]);
  });

  it('deduplicates duplicate key values before query construction', async () => {
    const executedQueries: { text: string; params: readonly unknown[] }[] = [];
    const mockDriver: Driver = {
      async execute(q) {
        executedQueries.push({ text: q.text, params: q.parameters });
        return [];
      },
    };

    const repo = defineRepository(UsersSchema, mockDriver);

    const parents = [
      { id: 10, name: 'A' },
      { id: 10, name: 'A_duplicate' },
      { id: 20, name: 'B' },
      { id: 10, name: 'A_triplicate' },
      { id: 20, name: 'B_duplicate' },
    ];

    await (
      repo as unknown as { attachRelations(p: Record<string, unknown>[], r: string[]): Promise<void> }
    ).attachRelations(parents, ['orders']);

    expect(executedQueries.length).toBe(1);
    const executedQuery = executedQueries[0];
    expect(executedQuery?.text).toBe('SELECT * FROM "orders" WHERE "userId" IN ($1, $2)');
    expect(executedQuery?.params).toEqual([10, 20]);
  });

  it('issues set-based IN queries instead of OR condition chains during relational population', async () => {
    const executedQueries: string[] = [];
    const mockDriver: Driver = {
      async execute(q) {
        executedQueries.push(q.text);
        return [];
      },
    };

    const repo = defineRepository(UsersSchema, mockDriver);

    await (
      repo as unknown as { attachRelations(p: Record<string, unknown>[], r: string[]): Promise<void> }
    ).attachRelations([{ id: 1 }, { id: 2 }, { id: 3 }], ['orders']);

    expect(executedQueries[0]).not.toContain('OR');
    expect(executedQueries[0]).toContain('WHERE "userId" IN ($1, $2, $3)');
  });

  it('executes chunk queries sequentially rather than concurrently in attachRelations', async () => {
    const queryExecutionLog: { query: string; time: number }[] = [];
    let queryCount = 0;

    const mockDriver: Driver = {
      async execute(q) {
        queryCount++;
        const currentQuery = queryCount;
        queryExecutionLog.push({ query: `start_${currentQuery}`, time: Date.now() });
        // Simulate slight delay to detect concurrent vs sequential execution
        await new Promise(resolve => setTimeout(resolve, 10));
        queryExecutionLog.push({ query: `end_${currentQuery}`, time: Date.now() });

        if (q.text.includes('orders')) {
          return [
            { id: 101, userId: 1, total: 50 },
            { id: 102, userId: 2, total: 75 },
          ];
        }
        return [];
      },
    };

    const repo = defineRepository(UsersSchema, mockDriver);

    // Create 5 parent IDs
    const parents = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));

    // Mock DIALECT_PARAM_LIMITS temporarily or test attachRelations
    await (
      repo as unknown as {
        attachRelations(p: Record<string, unknown>[], r: string[]): Promise<Record<string, unknown>[]>;
      }
    ).attachRelations(parents, ['orders']);

    // Check log sequence: start_1 -> end_1 -> start_2 ... (strictly sequential, never concurrent start_1 -> start_2 -> end_1)
    for (let i = 0; i < queryExecutionLog.length; i += 2) {
      expect(queryExecutionLog[i]?.query).toBe(`start_${i / 2 + 1}`);
      expect(queryExecutionLog[i + 1]?.query).toBe(`end_${i / 2 + 1}`);
    }
  });

  it('splits requests exceeding parameter thresholds into chunked queries and aggregates seamlessly (real SQLite)', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, userId INTEGER, total INTEGER);
    `);

    const driver = sqliteDriver(db);
    const userRepo = defineRepository(UsersSchema, driver, { dialect: 'sqlite' });

    // Create 2,500 users and corresponding orders
    const totalUsers = 2500;
    const insertUser = db.prepare('INSERT INTO users (id, name) VALUES (?, ?)');
    const insertOrder = db.prepare('INSERT INTO orders (id, userId, total) VALUES (?, ?, ?)');

    db.exec('BEGIN TRANSACTION');
    for (let i = 1; i <= totalUsers; i++) {
      insertUser.run(i, `User ${i}`);
      insertOrder.run(i, i, i * 10);
    }
    db.exec('COMMIT');

    // Fetch all 2,500 users
    const allUsers = await userRepo.findAll();
    expect(allUsers.length).toBe(totalUsers);

    // Perform relation loading across all 2,500 parent records (SQLite param limit is 999)
    const mutableParents = allUsers.map(u => ({ ...u }));
    const populated = await (
      userRepo as unknown as {
        attachRelations(p: Record<string, unknown>[], r: string[]): Promise<Record<string, unknown>[]>;
      }
    ).attachRelations(mutableParents, ['orders']);

    // Verify all 2,500 parents received their corresponding orders seamlessly
    expect(populated.length).toBe(totalUsers);
    for (let i = 0; i < totalUsers; i++) {
      const parent = populated[i] as unknown as {
        id: number;
        orders: { id: number; userId: number; total: number }[];
      };
      expect(parent.orders.length).toBe(1);
      const firstOrder = parent.orders[0];
      expect(firstOrder?.userId).toBe(parent.id);
      expect(firstOrder?.total).toBe(parent.id * 10);
    }
  });

  it('handles chunked relation loading in findAllWithMany seamlessly', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, userId INTEGER, total INTEGER);
    `);

    const driver = sqliteDriver(db);
    const userRepo = defineRepository(UsersSchema, driver, { dialect: 'sqlite' });

    const totalUsers = 1500;
    const insertUser = db.prepare('INSERT INTO users (id, name) VALUES (?, ?)');
    const insertOrder = db.prepare('INSERT INTO orders (id, userId, total) VALUES (?, ?, ?)');

    db.exec('BEGIN TRANSACTION');
    for (let i = 1; i <= totalUsers; i++) {
      insertUser.run(i, `User ${i}`);
      insertOrder.run(i, i, i * 100);
    }
    db.exec('COMMIT');

    const result = await userRepo.findAllWithMany('orders', 'orders', 'userId');
    expect(result.length).toBe(totalUsers);

    for (let i = 0; i < totalUsers; i++) {
      const row = result[i] as { id: number; orders: { userId: number; total: number }[] };
      expect(row.orders.length).toBe(1);
      const firstOrder = row.orders[0];
      expect(firstOrder?.userId).toBe(row.id);
      expect(firstOrder?.total).toBe(row.id * 100);
    }
  });
});
