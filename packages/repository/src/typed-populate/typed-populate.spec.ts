import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect } from 'vitest';

import { sqliteDriver } from '../drivers/sqlite.js';
import { BaseRepository } from '../index.js';
import { UserSchema, type User } from './fixtures.js';

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

function seed(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
  db.exec(
    'CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)',
  );
  db.exec("INSERT INTO users (id,name) VALUES (1,'Ada'),(2,'Alan')");
  db.exec('INSERT INTO orders (id,userId,total) VALUES (10,1,5),(11,1,7),(12,2,9)');
  return db;
}

// The result *types* are asserted in `typed-populate.type-test.ts`; note that
// `o.total` below needs no cast, which is the ergonomic half of the same claim.
describe('typed populate (#217)', () => {
  it('findById(id, { populate }) attaches the typed to-many relation', async () => {
    const repo = new UserRepository(sqliteDriver(seed()), 'sqlite');
    const user = await repo.findById(1, { populate: ['orders'] });
    expect(user?.name).toBe('Ada');
    expect(user?.orders).toHaveLength(2);
    expect(user?.orders.map(o => o.total).toSorted()).toEqual([5, 7]);
  });

  it('find(where, { populate }) attaches relations to every matching row', async () => {
    const repo = new UserRepository(sqliteDriver(seed()), 'sqlite');
    const rows = await repo.find({}, { populate: ['orders'] });
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.orders.length).toSorted()).toEqual([1, 2]);
  });

  it('without populate, the result is a plain entity (no relation key)', async () => {
    const repo = new UserRepository(sqliteDriver(seed()), 'sqlite');
    const user = await repo.findById(1);
    expect(user).not.toHaveProperty('orders');
  });

  it('an unknown relation name is rejected at runtime too', async () => {
    const repo = new UserRepository(sqliteDriver(seed()), 'sqlite');
    // @ts-expect-error — 'nope' is not a relation `User` declares. The runtime
    // guard below is the defence for callers who reach this method untyped.
    await expect(repo.findById(1, { populate: ['nope'] })).rejects.toThrow(/unknown relation "nope"/);
  });
});
