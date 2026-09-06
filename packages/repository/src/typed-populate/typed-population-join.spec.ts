import { DatabaseSync } from 'node:sqlite';

import { sqliteDriver } from '@zmdb/sqlite';
import { describe, it, expect } from 'vitest';

import { BaseRepository, defineRepository } from '../index.js';
import { sqliteDialect } from '../testing/official-dialects.fixture.js';
import { OrderSchema, UserSchema, type User } from './fixtures.js';

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

function seedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
  db.exec(
    'CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)',
  );
  db.exec('CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, bio TEXT NOT NULL)');

  db.exec("INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Alan')");
  db.exec('INSERT INTO orders (id, userId, total) VALUES (10, 1, 50), (11, 1, 75), (12, 2, 90)');
  db.exec("INSERT INTO profiles (id, userId, bio) VALUES (100, 1, 'Pioneer in computing')");
  return db;
}

// Result types and compile error assertions live in `typed-population-join.type-test.ts`.
describe('Balanced Typed Population and Join Derivation', () => {
  it('populates to-many and to-one relations returning widened entity types', async () => {
    const db = seedDatabase();
    const repo = new UserRepository(sqliteDriver(db), sqliteDialect);

    const userWithOrders = await repo.findById(1, { populate: ['orders'] });
    expect(userWithOrders?.name).toBe('Ada');
    expect(userWithOrders?.orders).toHaveLength(2);
    expect(userWithOrders?.orders.map(o => o.total).toSorted((a, b) => a - b)).toEqual([50, 75]);

    const userWithProfile = await repo.findById(1, { populate: ['profile'] });
    expect(userWithProfile?.profile?.bio).toBe('Pioneer in computing');

    const userWithBoth = await repo.findById(1, { populate: ['orders', 'profile'] });
    expect(userWithBoth?.orders).toHaveLength(2);
    expect(userWithBoth?.profile?.bio).toBe('Pioneer in computing');
  });

  it('enforces declared relation names and returns typed relation collections for batch relation loading', async () => {
    const db = seedDatabase();
    const repo = new UserRepository(sqliteDriver(db), sqliteDialect);

    const usersWithOrders = await repo.findAllWithMany('orders');
    expect(usersWithOrders).toHaveLength(2);

    const ada = usersWithOrders.find(u => u.id === 1);
    expect(ada?.orders).toHaveLength(2);
    expect(ada?.orders[0]?.total).toBeDefined();
  });

  it('accepts target schema configurations for join operations and derives typed join result rows', async () => {
    const db = seedDatabase();
    const repo = new UserRepository(sqliteDriver(db), sqliteDialect);

    const innerJoined = await repo.findJoined(
      { target: OrderSchema, leftCol: 'users.id', rightCol: 'orders.userId', kind: 'inner' },
      { col: 'users.id', op: '=', value: 1 },
    );

    expect(innerJoined.length).toBeGreaterThan(0);
    expect(innerJoined[0]!.name).toBe('Ada');
    expect(innerJoined[0]!.total).toBe(50);

    const leftJoined = await repo.findJoined({
      target: OrderSchema,
      leftCol: 'users.id',
      rightCol: 'orders.userId',
      kind: 'left',
    });

    expect(leftJoined.length).toBeGreaterThan(0);
    expect(leftJoined[0]!.name).toBe('Ada');
  });

  it('factory functions retain declared relation types when constructing repository instances', async () => {
    const db = seedDatabase();
    const repo = defineRepository(UserSchema, sqliteDriver(db), { dialect: sqliteDialect });

    const userWithOrders = await repo.findById(1, { populate: ['orders'] });
    expect(userWithOrders?.orders).toHaveLength(2);
  });

  it('a read that does not populate attaches nothing', async () => {
    // The "no lazy getters" guarantee, from the runtime side. `User` declares two
    // relations, and a read that did not ask for them comes back without the keys — not
    // with an empty array, not with a getter that would fetch on access.
    const db = seedDatabase();
    const repo = new UserRepository(sqliteDriver(db), sqliteDialect);

    const user = await repo.findById(1);
    expect(user?.name).toBe('Ada');
    expect(user).not.toHaveProperty('orders');
    expect(user).not.toHaveProperty('profile');

    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('preserves generic relation declarations across transaction helpers', async () => {
    const db = seedDatabase();
    const repo = new UserRepository(sqliteDriver(db), sqliteDialect);

    const txRepo = repo.withTransaction({
      execute: q => sqliteDriver(db).execute(q),
    });

    const userWithOrders = await txRepo.findById(1, { populate: ['orders'] });
    expect(userWithOrders?.orders).toHaveLength(2);
  });
});
