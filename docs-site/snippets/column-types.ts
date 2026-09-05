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
interface Event extends Table<'events'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  kind: 'created' | 'updated' | 'deleted'; // → jsonEnum
  sequence: bigint & Sql<'bigint'>;
  amount: number & Sql<'numeric'> & Numeric<12, 2>;
  label: string & Sql<'varchar'> & Length<80>;
  body: string & Sql<'text'>;
  payload: { source: string; retries: number } & Sql<'json'>;
  live: boolean;
  at: Date & Sql<'timestamp'>;
}
// #endregion snippet-1

// #region snippet-2
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<320> & Unique & Pattern<'^[^@]+@[^@]+\\.[^@]+$'>;
  role: ('admin' | 'user') & HasDefault;
  bio: (string & Sql<'text'>) | null;
  authorId: number & Sql<'integer'> & References<'users.id'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
// #endregion snippet-2
