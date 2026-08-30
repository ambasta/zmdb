import { describe, it, expect, expectTypeOf } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineSchema, serial, text, integer } from '@zmdb/schema-core';
import { oneToMany } from '@zmdb/schema-core/relations';
import type { Entity } from '@zmdb/schema-core';
import { BaseRepository } from '../index.ts';
import { sqliteDriver } from '../drivers/sqlite.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
});
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: integer().notNull(),
});
type Order = Entity<typeof OrderSchema>;

class UserRepository extends BaseRepository<typeof UserSchema> {
  static override readonly schema = UserSchema;
  static readonly relations = {
    orders: { meta: oneToMany('orders', 'userId'), entity: OrderSchema, cardinality: 'one-to-many', childTable: 'orders', childFk: 'userId', parentKey: 'id' },
  } as const;
}

function seed(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)');
  db.exec("INSERT INTO users (id,name) VALUES (1,'Ada'),(2,'Alan')");
  db.exec('INSERT INTO orders (id,userId,total) VALUES (10,1,5),(11,1,7),(12,2,9)');
  return db;
}

describe('typed populate (#217)', () => {
  it('findById(id, { populate }) attaches the typed to-many relation', async () => {
    const repo = new UserRepository(sqliteDriver(seed()), 'sqlite');
    const user = await repo.findById(1, { populate: ['orders'] });
    expect(user?.name).toBe('Ada');
    expect(user?.orders).toHaveLength(2);
    expect((user?.orders as Order[]).map((o) => o.total).sort()).toEqual([5, 7]);
  });

  it('without populate, the result is a plain entity (no relation key)', async () => {
    const repo = new UserRepository(sqliteDriver(seed()), 'sqlite');
    const user = await repo.findById(1);
    expect(user).not.toHaveProperty('orders');
  });

  it('type-level: populated result carries the relation as an array', () => {
    const repo = new UserRepository(sqliteDriver(seed()), 'sqlite');
    // The populated overload returns a parent widened with `orders: ...`.
    expectTypeOf(repo.findById(1, { populate: ['orders'] })).resolves.toHaveProperty('orders');
  });
});
