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
  const seqDef = {
    name: 'order_number_seq',
    start: 1000,
    increment: 1,
  };

  const ddl = createSequenceDdl(seqDef, 'postgres');
  console.log(ddl);
}
// #endregion snippet-1

// #region snippet-2
export interface Order extends Table<'orders'> {
  order_id: number & Sql<'integer'> & PrimaryKey;
  order_number: number & Sql<'integer'> & HasDefault;
  created_at: number & Sql<'integer'>; // timestamp as unix epoch
}
// #endregion snippet-2

// #region snippet-3
{
  // Generating next sequence value via query compiler

  const compiler = createQueryCompiler('postgres');

  const nextValQuery = compiler.selectFrom('order_number_seq').select(['nextval']).compile();

  console.log(nextValQuery.text);
}
// #endregion snippet-3

// #region snippet-4
{
  const dropSequenceDdl = `DROP SEQUENCE IF EXISTS "order_number_seq"`;
}
// #endregion snippet-4
