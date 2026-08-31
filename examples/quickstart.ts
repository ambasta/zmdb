// Runnable zmdb quickstart — zero external dependencies (uses node:sqlite).
//   node --experimental-strip-types examples/quickstart.ts
// Defines a schema, wires a typed repository with defineRepository + the built-in
// sqlite driver, and does typed CRUD + list + populate. No proxies, no identity map.
import { DatabaseSync } from 'node:sqlite';

import { defineRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { defineSchema, serial, text, integer } from '@zmdb/schema-core';
import { oneToMany } from '@zmdb/schema-core/relations';

// 1 — define your schema once
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

// 2 — a database + tables (node:sqlite, in-memory here)
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, age INTEGER NOT NULL)');
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)');

// 3 — one call wires a fully typed repository (no subclass, no hand-written driver)
const users = defineRepository(UserSchema, sqliteDriver(db), {
  dialect: 'sqlite',
  relations: {
    orders: {
      meta: oneToMany('orders', 'userId'),
      entity: OrderSchema,
      cardinality: 'one-to-many',
      childTable: 'orders',
      childFk: 'userId',
      parentKey: 'id',
    },
  },
});

// 4 — typed CRUD + query + populate
const u = await users.create({ email: 'ada@zmdb.dev', age: 36 }); // validated first
db.exec(`INSERT INTO orders (userId,total) VALUES (${u.id},5),(${u.id},7)`);

const page = await users.list({ where: { age: { gte: 18 } }, page: { limit: 10 } });
const withOrders = await users.findById(u.id, { populate: ['orders'] });

console.log('created:', u);
console.log('list:', page.items, 'hasMore:', page.hasMore);
console.log('populated orders:', withOrders?.orders);
