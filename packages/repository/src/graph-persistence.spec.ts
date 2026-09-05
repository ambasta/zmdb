import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { OneToMany, OneToOne, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { sqliteDriver } from '@zmdb/sqlite';
import { describe, expect, it } from 'vitest';

import { defineRepository } from './index.js';

// 1. Define Test Table Interfaces
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  orders?: Order[] & OneToMany<'orders', 'userId'>;
  profile?: Profile & OneToOne<'profiles', 'userId'>;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'integer'>;
}

export interface Profile extends Table<'profiles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  bio: string & Sql<'text'>;
}

const { User: UserSchema } = schemasFrom<{ User: User; Order: Order; Profile: Profile }>(import.meta.url, [
  'User',
  'Order',
  'Profile',
]);

function setupDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      total INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    CREATE TABLE profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      bio TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);
  const driver = sqliteDriver(db);
  const userRepo = defineRepository<User>(UserSchema, driver, {
    dialect: 'sqlite',
  });
  return { db, driver, userRepo };
}

describe('Explicit Transactional Graph Persistence Helpers', () => {
  it('creates parent entity with nested child payloads atomically (createGraph)', async () => {
    const { userRepo, driver } = setupDb();

    const created = await userRepo.createGraph({
      name: 'Alice',
      orders: [{ total: 100 }, { total: 200 }],
      profile: { bio: 'Software Developer' },
    });

    expect(created.id).toBe(1);
    expect(created.name).toBe('Alice');
    expect(created.orders).toHaveLength(2);
    expect(created.orders[0]).toMatchObject({ id: 1, userId: 1, total: 100 });
    expect(created.orders[1]).toMatchObject({ id: 2, userId: 1, total: 200 });
    expect(created.profile).toMatchObject({ id: 1, userId: 1, bio: 'Software Developer' });

    // Verify directly from DB
    const dbUsers = await driver.execute({ text: 'SELECT * FROM users', parameters: [] });
    const dbOrders = await driver.execute({ text: 'SELECT * FROM orders', parameters: [] });
    const dbProfiles = await driver.execute({ text: 'SELECT * FROM profiles', parameters: [] });

    expect(dbUsers).toHaveLength(1);
    expect(dbOrders).toHaveLength(2);
    expect(dbProfiles).toHaveLength(1);
  });

  it('rolls back entire transaction on createGraph failure leaving zero orphaned records', async () => {
    const { userRepo, driver } = setupDb();

    await expect(
      userRepo.createGraph({
        name: 'Bob',
        orders: [
          { total: 150 },
          { total: null as unknown as number }, // violates NOT NULL constraint on total
        ],
        profile: { bio: 'Gamer' },
      }),
    ).rejects.toThrow();

    // Verify 0 records were created in DB
    const dbUsers = await driver.execute({ text: 'SELECT * FROM users', parameters: [] });
    const dbOrders = await driver.execute({ text: 'SELECT * FROM orders', parameters: [] });
    const dbProfiles = await driver.execute({ text: 'SELECT * FROM profiles', parameters: [] });

    expect(dbUsers).toHaveLength(0);
    expect(dbOrders).toHaveLength(0);
    expect(dbProfiles).toHaveLength(0);
  });

  it('updates existing parent entity and reconciles nested child records (updateGraph)', async () => {
    const { userRepo, driver } = setupDb();

    // Setup initial graph
    const initial = await userRepo.createGraph({
      name: 'Charlie',
      orders: [{ total: 100 }, { total: 200 }],
      profile: { bio: 'Original Bio' },
    });

    const existingOrderId1 = initial.orders[0]!.id;
    const existingOrderId2 = initial.orders[1]!.id;

    // Update graph: update order 1, remove order 2, add new order 3, update profile, update user name
    const updated = await userRepo.updateGraph(initial.id, {
      name: 'Charlie Updated',
      orders: [
        { id: existingOrderId1, total: 150 }, // updated existing
        { total: 300 }, // newly added
      ],
      profile: { bio: 'Updated Bio' },
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Charlie Updated');
    expect(updated!.orders).toHaveLength(2);

    const updatedOrder1 = updated!.orders.find(o => o.id === existingOrderId1);
    const newOrder = updated!.orders.find(o => o.id !== existingOrderId1);

    expect(updatedOrder1?.total).toBe(150);
    expect(newOrder?.total).toBe(300);
    expect(updated!.profile?.bio).toBe('Updated Bio');

    // Verify removed order 2 is no longer in DB
    const dbOrders = await driver.execute({ text: 'SELECT * FROM orders', parameters: [] });
    expect(dbOrders).toHaveLength(2);
    expect(dbOrders.some((o: Record<string, unknown>) => o.id === existingOrderId2)).toBe(false);
  });

  it('rolls back updateGraph on failure leaving prior database state intact', async () => {
    const { userRepo, driver } = setupDb();

    const initial = await userRepo.createGraph({
      name: 'Dave',
      orders: [{ total: 100 }],
      profile: { bio: 'Dave Bio' },
    });

    await expect(
      userRepo.updateGraph(initial.id, {
        name: 'Dave Changed',
        orders: [
          { id: initial.orders[0]!.id, total: null as unknown as number }, // violates constraint
        ],
      }),
    ).rejects.toThrow();

    // Verify DB still has original state
    const dbUser = (await driver.execute({ text: 'SELECT * FROM users WHERE id = 1', parameters: [] }))[0];
    const dbOrder = (await driver.execute({ text: 'SELECT * FROM orders WHERE id = 1', parameters: [] }))[0];

    expect(dbUser?.name).toBe('Dave');
    expect(dbOrder?.total).toBe(100);
  });

  it('deletes root entity and all related child records in cascading order (deleteGraph)', async () => {
    const { userRepo, driver } = setupDb();

    const created = await userRepo.createGraph({
      name: 'Eve',
      orders: [{ total: 50 }, { total: 75 }],
      profile: { bio: 'Eve Bio' },
    });

    const deleted = await userRepo.deleteGraph(created.id);
    expect(deleted).toBe(true);

    // Verify parent and child records are all removed from DB
    const dbUsers = await driver.execute({ text: 'SELECT * FROM users', parameters: [] });
    const dbOrders = await driver.execute({ text: 'SELECT * FROM orders', parameters: [] });
    const dbProfiles = await driver.execute({ text: 'SELECT * FROM profiles', parameters: [] });

    expect(dbUsers).toHaveLength(0);
    expect(dbOrders).toHaveLength(0);
    expect(dbProfiles).toHaveLength(0);
  });

  it('preserves standard single-entity delete behavior without cascading', async () => {
    const { userRepo, driver } = setupDb();

    const created = await userRepo.createGraph({
      name: 'Frank',
      orders: [{ total: 500 }],
      profile: { bio: 'Frank Bio' },
    });

    // Disable foreign key enforcement temporarily or test standard delete
    // Standard delete calls `DELETE FROM users WHERE id = ?`
    // Note: without DB CASCADE or graph delete, standard delete only targets the root row
    await driver.execute({ text: 'PRAGMA foreign_keys = OFF;', parameters: [] });
    const deletedSingle = await userRepo.delete(created.id);
    expect(deletedSingle).toBe(true);

    const dbUsers = await driver.execute({ text: 'SELECT * FROM users', parameters: [] });
    const dbOrders = await driver.execute({ text: 'SELECT * FROM orders', parameters: [] });

    expect(dbUsers).toHaveLength(0);
    // Standard delete affects ONLY the targeted single table row
    expect(dbOrders).toHaveLength(1);
  });
});
