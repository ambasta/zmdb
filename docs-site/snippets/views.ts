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
  const viewDef = {
    name: 'user_with_post_count',
    select: `SELECT u.id, u.email, COUNT(p.id) AS post_count 
             FROM users u 
             LEFT JOIN posts p ON u.id = p.author_id 
             GROUP BY u.id, u.email`,
  };

  const ddl = createViewDdl(viewDef, 'postgres');
  console.log(ddl);
}
// #endregion snippet-1

// #region snippet-2
{
  // Only works on PostgreSQL
  const materializedDef = {
    name: 'sales_summary',
    select: `SELECT region, SUM(amount) AS total_sales 
             FROM sales 
             GROUP BY region`,
    materialized: true,
  };

  const ddl = createViewDdl(materializedDef, 'postgres');
  console.log(ddl);
}
// #endregion snippet-2

// #region snippet-3
{
  const dropDdl = dropViewDdl('user_with_post_count', 'postgres');
  console.log(dropDdl);
}
// #endregion snippet-3

// #region snippet-4
{
  const compiler = createQueryCompiler('postgres');

  const query = compiler
    .selectFrom('user_with_post_count')
    .select(['id', 'email', 'post_count'])
    .where('post_count', '>', 5)
    .orderBy('post_count', 'desc')
    .limit(10)
    .compile();

  console.log(query.text);
  console.log(query.parameters);
}
// #endregion snippet-4
