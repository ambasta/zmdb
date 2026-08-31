import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect } from 'vitest';

import { sqliteDriver } from '../drivers/sqlite.ts';
import { defineRepository } from '../index.ts';
import { UserSchema, userRelations } from './fixtures.ts';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, age INTEGER NOT NULL)');
  d.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)');
  return d;
}

// The derived types are asserted in `quickstart.type-test.ts`.
describe('DX quickstart via defineRepository (#222)', () => {
  it('wires a typed repo with no subclass and round-trips CRUD + list + populate', async () => {
    const d = db();
    const users = defineRepository(UserSchema, sqliteDriver(d), {
      dialect: 'sqlite',
      relations: userRelations,
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
});
