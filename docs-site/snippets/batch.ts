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

  const stmt1 = compiler.insertInto('users').values({ name: 'Alice', email: 'alice@example.com' }).compile();

  const stmt2 = compiler.insertInto('users').values({ name: 'Bob', email: 'bob@example.com' }).compile();

  const batchHandle = batch([stmt1, stmt2]);
  // batchHandle.statements => [stmt1, stmt2]
}
// #endregion snippet-1

// #region snippet-2
{
  const results = await batchHandle.execute(async statements => {
    // Your driver must support multi-statement execution
    // For PostgreSQL: client.query(text + ';' + text, [...params1, ...params2])
    return driver.executeMulti(statements);
  });
  // results => [result1, result2]
}
// #endregion snippet-2

// #region snippet-3
{
  (async () => {
    const users = [
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Charlie', email: 'charlie@example.com' },
    ];

    const statements = users.map(u => compiler.insertInto('users').values(u).compile());

    const result = await batch(statements).execute(driver.executeMulti.bind(driver));
  })();
}
// #endregion snippet-3

// #region snippet-4
{
  // stmt1.parameters => ['Alice', 'alice@example.com']
  // stmt2.parameters => ['Bob', 'bob@example.com']
  // After batch execute:
  // Combined params => ['Alice', 'alice@example.com', 'Bob', 'bob@example.com']
}
// #endregion snippet-4

// #region snippet-5
{
  const empty = batch([]);
  const result = await empty.execute(async () => {
    throw new Error('Should not run');
  });
  // result => []
}
// #endregion snippet-5
