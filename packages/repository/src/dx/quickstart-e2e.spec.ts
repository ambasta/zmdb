import { describe, it, expect, expectTypeOf } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineSchema, serial, text, integer } from '@zmdb/schema-core';
import { oneToMany } from '@zmdb/schema-core/relations';
import type { CreateDTO, Entity } from '@zmdb/schema-core';
import { defineRepository } from '../index.ts';
import { sqliteDriver } from '../drivers/sqlite.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
});
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: integer().notNull(),
});

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, age INTEGER NOT NULL)');
  d.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)');
  return d;
}

describe('DX quickstart via defineRepository (#222)', () => {
  it('wires a typed repo with no subclass and round-trips CRUD + list + populate', async () => {
    const d = db();
    const users = defineRepository(UserSchema, sqliteDriver(d), {
      dialect: 'sqlite',
      relations: { orders: { meta: oneToMany('orders', 'userId'), entity: OrderSchema, cardinality: 'one-to-many', childTable: 'orders', childFk: 'userId', parentKey: 'id' } },
    });

    const u = await users.create({ email: 'a@b.com', age: 30 });
    expect(u.id).toBeGreaterThan(0);
    d.exec(`INSERT INTO orders (userId,total) VALUES (${u.id},5),(${u.id},7)`);

    const found = await users.findById(u.id);
    expect(found?.email).toBe('a@b.com');

    const page = await users.list({ page: { limit: 10 } });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);

    const withOrders = await users.findById(u.id, { populate: ['orders'] });
    expect(withOrders?.orders).toHaveLength(2);

    const updated = await users.update(u.id, { age: 31 });
    expect(updated?.age).toBe(31);
    expect(await users.delete(u.id)).toBe(true);
  });

  it('type-level: defineRepository gives a typed create/findById', () => {
    const users = defineRepository(UserSchema, sqliteDriver(db()), { dialect: 'sqlite' });
    expectTypeOf(users.create).parameter(0).toEqualTypeOf<CreateDTO<typeof UserSchema>>();
    expectTypeOf(users.findById(1)).resolves.toEqualTypeOf<Entity<typeof UserSchema> | undefined>();
  });
});
