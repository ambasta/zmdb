// Runnable zmdb quickstart — zero external dependencies (uses node:sqlite).
//   node --experimental-strip-types examples/quickstart.ts
// Declares two tables as interfaces, wires a typed repository with defineRepository + the
// built-in sqlite driver, and does typed CRUD + list + populate. No proxies, no identity map.
//
// One line here is not what an application writes. In a project with a build step the schema
// comes from `schemaOf<User>()`, which the transform replaces with the schema value it
// reflected at compile time — see `fixtures/consumer-cli` for that path end to end. This file
// runs under `node --experimental-strip-types` with nothing in front of it, so it asks for the
// same reflection at startup instead, through `@zmdb/aot-validator/testing`. Same reflection,
// same schema; it just pays about 80ms to open the project rather than nothing at all.
import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import { defineRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import type { OneToMany, PrimaryKey, References, Serial, Sql, Table } from '@zmdb/schema-core/tags';

// 1 — declare your tables once. Everything below is derived from these two interfaces: the
// DTOs, the validation on `create`, the SQL, the JSON Schema. `Sql<'integer'>` is there
// because `integer`, `bigint` and `numeric` are all `number` to TypeScript, and `Serial` says
// the database generates the value — which is why `create` below does not want an `id`.
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'>;
  // A relation is a property too: the cardinality is `Order[]` versus `Order`, and the tag
  // says which table and which column carry the join. `populate: ['orders']` below is checked
  // against this line, and the batched select it runs is built from it.
  orders?: Order[] & OneToMany<'orders', 'userId'>;
}
export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'integer'>;
}

const { User: UserSchema } = schemasFrom<{ User: User; Order: Order }>(import.meta.url, ['User', 'Order']);

// 2 — a database + tables (node:sqlite, in-memory here)
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, age INTEGER NOT NULL)');
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total INTEGER NOT NULL)');

// 3 — one call wires a fully typed repository (no subclass, no hand-written driver)
const users = defineRepository(UserSchema, sqliteDriver(db), { dialect: 'sqlite' });

// 4 — typed CRUD + query + populate
const u = await users.create({ email: 'ada@zmdb.dev', age: 36 }); // validated first
db.exec(`INSERT INTO orders (userId,total) VALUES (${u.id},5),(${u.id},7)`);

const page = await users.list({ where: { age: { gte: 18 } }, page: { limit: 10 } });
const withOrders = await users.findById(u.id, { populate: ['orders'] });

console.log('created:', u);
console.log('list:', page.items, 'hasMore:', page.hasMore);
console.log('populated orders:', withOrders?.orders);
