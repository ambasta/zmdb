import { DatabaseSync } from 'node:sqlite';

import { defineSchema, serial, text, integer, primaryKey, notNull } from '@zmdb/schema-core';
import { describe, it, expect, beforeEach } from 'vitest';

import { BaseRepository, type Driver } from './index.ts';

// #34: integrate populate() into the repository + E2E (real SQLite).

function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async execute(q) {
      const stmt = db.prepare(q.text);
      const params = q.parameters as unknown[];
      if (/^\s*SELECT/i.test(q.text) || /RETURNING/i.test(q.text)) {
        return stmt.all(...params) as Record<string, unknown>[];
      }
      stmt.run(...params);
      return [];
    },
  };
}

const UserSchema = defineSchema('users', {
  id: primaryKey(serial()),
  email: notNull(text()),
});
const OrderSchema = defineSchema('orders', {
  id: primaryKey(serial()),
  userId: notNull(integer()),
  total: notNull(integer()),
});

class UserRepository extends BaseRepository<typeof UserSchema> {
  static override readonly schema = UserSchema;
}
class OrderRepository extends BaseRepository<typeof OrderSchema> {
  static override readonly schema = OrderSchema;
}

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL)');
  db.exec(
    'CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)',
  );
});

describe('populate to-many E2E (real SQLite)', () => {
  it('attaches child orders to each user, as plain rows (no shared refs)', async () => {
    const driver = sqliteDriver(db);
    const users = new UserRepository(driver, 'sqlite');
    const orders = new OrderRepository(driver, 'sqlite');

    const u1 = await users.create({ email: 'a@b.com' });
    const u2 = await users.create({ email: 'c@d.com' });
    await orders.create({ userId: u1.id, total: 10 });
    await orders.create({ userId: u1.id, total: 20 });
    await orders.create({ userId: u2.id, total: 30 });

    const populated = await users.findAllWithMany('orders', 'orders', 'userId');
    const byId = new Map(populated.map(p => [p.id, p]));

    expect((byId.get(u1.id)!.orders as unknown[]).length).toBe(2);
    expect((byId.get(u2.id)!.orders as unknown[]).length).toBe(1);
    expect((byId.get(u2.id)!.orders as { total: number }[])[0]!.total).toBe(30);

    // No shared references: each user's orders array is distinct.
    expect(byId.get(u1.id)!.orders).not.toBe(byId.get(u2.id)!.orders);
  });
});
