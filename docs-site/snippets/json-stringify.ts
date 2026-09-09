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
  stringify({ name: 'alice', age: 30, active: true });
  // '{"name":"alice","age":30,"active":true}'

  stringify([1, 2, 3]); // '[1,2,3]'
  stringify({ user: { email: 'a@b.com' } }); // '{"user":{"email":"a@b.com"}}'
  stringify(null); // 'null'
  stringify(undefined); // undefined — not a string, exactly as JSON.stringify
}
// #endregion snippet-1

// #region snippet-2
{
  stringify({ id: 123n });
  // TypeError: Do not know how to serialize a BigInt
}
// #endregion snippet-2

// #region snippet-3
export interface Event extends Table<'events'> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
}
// Entity<Event>['id'] is bigint; the JSON body carries "9007199254740993"
// #endregion snippet-3

// #region snippet-4
{
  const json = assertStringify(payload, ir); // throws AssertError if payload is wrong
}
// #endregion snippet-4

// #region snippet-5
{
  const json = stringify(assert<CreateDTO<User>>(payload));
}
// #endregion snippet-5
