import { assert, is, validate } from '@zmdb/aot-validator';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { BaseRepository, type Driver } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/sqlite';
import { defineRepository, schemaOf } from 'zmdb';
import type { CreateDTO, Entity, UpdateDTO, Populated } from 'zmdb/derive';
import type {
  HasDefault,
  Length,
  Max,
  MaxLength,
  Min,
  Pattern,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
  Unique,
} from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\.[^@]+$'>;
  name?: string & Sql<'text'>;
  role: ('admin' | 'user' | 'guest') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'> & Min<0>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  authorId: number & Sql<'integer'> & References<'users.id'>;
}

const db = {} as any;
const driver: Driver = { dialect: 'sqlite', execute: async () => [] };
const users = defineRepository(schemaOf<User>(), sqliteDriver(db), { dialect: 'sqlite' });
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(db), { dialect: 'sqlite' });
const posts = defineRepository(schemaOf<Post>(), sqliteDriver(db), { dialect: 'sqlite' });
const qb = createQueryCompiler('sqlite');
const compiler = qb;
const builder = qb.selectFrom('users');

// #region snippet-1
{
  const compiler = createQueryCompiler('postgres');

  const query1 = compiler.selectFrom('users').select(['id', 'name']).where('active', '=', true).compile();

  const query2 = compiler.selectFrom('archived_users').select(['id', 'name']).compile();

  const combined = setOperation('union', [query1, query2], 'postgres');

  // combined.text => SELECT ... UNION SELECT ...
  // combined.parameters => [...]
}
// #endregion snippet-1

// #region snippet-2
{
  // Active users who have placed orders
  const activeWithOrders = setOperation('intersect', [activeUsersQuery, ordersQuery], 'postgres');

  // Users who have never ordered
  const neverOrdered = setOperation('except', [allUsersQuery, ordersQuery], 'postgres');
}
// #endregion snippet-2

// #region snippet-3
{
  const compiler = createQueryCompiler('postgres');

  const stmt1 = compiler.insertInto('users').values({ name: 'Alice', email: 'alice@example.com' }).compile();

  const stmt2 = compiler.insertInto('users').values({ name: 'Bob', email: 'bob@example.com' }).compile();

  const batchHandle = batch([stmt1, stmt2]);

  // Execute against your driver
  const results = await batchHandle.execute(async statements => {
    // Run all statements in a single transaction or call
    return driver.executeMulti(statements);
  });
}
// #endregion snippet-3

// #region snippet-4
{
  // Two queries with overlapping parameter positions
  const q1 = compiler.selectFrom('orders').where('user_id', '=', 1).compile();
  const q2 = compiler.selectFrom('products').where('category_id', '=', 2).compile();

  // After union, q1's $1 stays $1, q2's $1 becomes $3
  const combined = setOperation('union', [q1, q2], 'postgres');
  // combined.parameters => [1, 2] (assuming q2 had one param)
}
// #endregion snippet-4
