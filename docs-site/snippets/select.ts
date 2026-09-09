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
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: 'admin' | 'user';
  createdAt: Date & Sql<'timestamp'>;
}
// #endregion snippet-1

// #region snippet-2
{
  const q = qc.selectFrom('users').compile();
  // q.text, q.parameters — pass to your driver
}
// #endregion snippet-2

// #region snippet-3
{
  qc.selectFrom('users').select(['id', 'email']).compile();
}
// #endregion snippet-3

// #region snippet-4
{
  qc.selectFrom('users').where('role', '=', 'admin').andWhere('email', 'like', '%@corp.com').compile();
}
// #endregion snippet-4

// #region snippet-5
{
  qc.selectFrom('users').orderBy('createdAt', 'desc').orderBy('id', 'asc').compile();
}
// #endregion snippet-5

// #region snippet-6
{
  qc.selectFrom('users').orderBy('id', 'asc').limit(20).offset(40).compile();
}
// #endregion snippet-6

// #region snippet-7
{
  createQueryCompiler('mysql').selectFrom('users').where('id', '=', 1).compile();
  // text: SELECT * FROM `users` WHERE `id` = ?   parameters: [1]
}
// #endregion snippet-7
