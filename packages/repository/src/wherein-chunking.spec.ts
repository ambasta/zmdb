import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriver } from './drivers/sqlite.ts';
import { defineRepository, BaseRepository, type Driver } from './index.ts';
import { defineSchema, serial, text, integer } from '@zmdb/schema-core';
import { createQueryCompiler, DIALECT_PARAM_LIMITS } from '@zmdb/query-compiler';

const UsersSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
});

const OrdersSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: integer().notNull(),
});

describe('Native Builder whereIn with Parameter Chunking', () => {
  it('exposes dedicated set-matching methods that output parameterized SQL IN clauses', () => {
    const qb = createQueryCompiler('postgres');

    const selectQuery = qb
      .selectFrom('users')
      .whereIn('id', [10, 20, 30])
      .andWhereNotIn('status', ['archived'])
      .compile();

    expect(selectQuery.text).toBe(
      'SELECT * FROM "users" WHERE "id" IN ($1, $2, $3) AND "status" NOT IN ($4)',
    );
    expect(selectQuery.parameters).toEqual([10, 20, 30, 'archived']);

    const updateQuery = qb
      .updateTable('users')
      .set({ status: 'active' })
      .whereIn('id', [1, 2])
      .compile();

    expect(updateQuery.text).toBe('UPDATE "users" SET "status" = $1 WHERE "id" IN ($2, $3)');
    expect(updateQuery.parameters).toEqual(['active', 1, 2]);

    const deleteQuery = qb
      .deleteFrom('users')
      .whereNotIn('id', [100])
      .compile();

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

    const repo = defineRepository(UsersSchema, mockDriver, {
      relations: {
        orders: {
          cardinality: 'one-to-many',
          childTable: 'orders',
          childFk: 'userId',
        },
      },
    });

    const parents = [
      { id: 1, name: 'Alice' },
      { id: null, name: 'NullParent' },
      { id: undefined, name: 'UndefinedParent' },
      { id: 2, name: 'Bob' },
    ];

    // Call attachRelations via private access cast
    await (repo as unknown as { attachRelations(p: Record<string, unknown>[], r: string[]): Promise<void> })
      .attachRelations(parents, ['orders']);

    // Check that the executed query received ONLY [1, 2], not null or undefined
    expect(executedQueries.length).toBe(1);
    expect(executedQueries[0]).toBe('SELECT * FROM "orders" WHERE "userId" IN ($1, $2)');

    // Verify parents mapped correctly
    expect((parents[0] as { orders: unknown[] }).orders).toEqual([{ id: 101, userId: 1, total: 50 }]);
    expect((parents[1] as { orders: unknown[] }).orders).toEqual([]);
    expect((parents[2] as { orders: unknown[] }).orders).toEqual([]);
    expect((parents[3] as { orders: unknown[] }).orders).toEqual([{ id: 102, userId: 2, total: 75 }]);
  });

  it('deduplicates duplicate key values before query construction', async () => {
    const executedQueries: { text: string; params: readonly unknown[] }[] = [];
    const mockDriver: Driver = {
      async execute(q) {
        executedQueries.push({ text: q.text, params: q.parameters });
        return [];
      },
    };

    const repo = defineRepository(UsersSchema, mockDriver, {
      relations: {
        orders: {
          cardinality: 'one-to-many',
          childTable: 'orders',
          childFk: 'userId',
        },
      },
    });

    const parents = [
      { id: 10, name: 'A' },
      { id: 10, name: 'A_duplicate' },
      { id: 20, name: 'B' },
      { id: 10, name: 'A_triplicate' },
      { id: 20, name: 'B_duplicate' },
    ];

    await (repo as unknown as { attachRelations(p: Record<string, unknown>[], r: string[]): Promise<void> })
      .attachRelations(parents, ['orders']);

    expect(executedQueries.length).toBe(1);
    expect(executedQueries[0]!.text).toBe('SELECT * FROM "orders" WHERE "userId" IN ($1, $2)');
    expect(executedQueries[0]!.params).toEqual([10, 20]);
  });

  it('issues set-based IN queries instead of OR condition chains during relational population', async () => {
    const executedQueries: string[] = [];
    const mockDriver: Driver = {
      async execute(q) {
        executedQueries.push(q.text);
        return [];
      },
    };

    const repo = defineRepository(UsersSchema, mockDriver, {
      relations: {
        orders: {
          cardinality: 'one-to-many',
          childTable: 'orders',
          childFk: 'userId',
        },
      },
    });

    await (repo as unknown as { attachRelations(p: Record<string, unknown>[], r: string[]): Promise<void> })
      .attachRelations([{ id: 1 }, { id: 2 }, { id: 3 }], ['orders']);

    expect(executedQueries[0]).not.toContain('OR');
    expect(executedQueries[0]).toContain('WHERE "userId" IN ($1, $2, $3)');
  });

  it('splits requests exceeding parameter thresholds into chunked queries and aggregates seamlessly (real SQLite)', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, userId INTEGER, total INTEGER);
    `);

    const driver = sqliteDriver(db);
    const userRepo = defineRepository(UsersSchema, driver, {
      dialect: 'sqlite',
      relations: {
        orders: {
          cardinality: 'one-to-many',
          childTable: 'orders',
          childFk: 'userId',
        },
      },
    });

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
    const mutableParents = allUsers.map((u) => ({ ...u }));
    await (userRepo as unknown as { attachRelations(p: Record<string, unknown>[], r: string[]): Promise<void> })
      .attachRelations(mutableParents, ['orders']);

    // Verify all 2,500 parents received their corresponding orders seamlessly
    expect(mutableParents.length).toBe(totalUsers);
    for (let i = 0; i < totalUsers; i++) {
      const parent = mutableParents[i] as { id: number; orders: { id: number; userId: number; total: number }[] };
      expect(parent.orders.length).toBe(1);
      expect(parent.orders[0]!.userId).toBe(parent.id);
      expect(parent.orders[0]!.total).toBe(parent.id * 10);
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
      expect(row.orders[0]!.userId).toBe(row.id);
      expect(row.orders[0]!.total).toBe(row.id * 100);
    }
  });
});
