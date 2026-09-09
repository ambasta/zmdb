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
  (async () => {
    // Given `interface User` with columns: id, email, role, createdAt
    type UserRow = Entity<User>;
    // UserRow = { id: number; email: string; role: string; createdAt: Date }

    // Select only email and role — type narrows automatically
    const minimal = await users.findById(1, { select: ['email', 'role'] as const });
    // Type: { email: string; role: string } | undefined
  })();
}
// #endregion snippet-1

// #region snippet-2
{
  const row = { id: 1, email: 'a@b.com', role: 'admin', createdAt: new Date() };

  const narrow = project(row, ['email', 'role'] as const);
  // narrow = { email: 'a@b.com', role: 'admin' }

  // Passing undefined returns the row unchanged
  const full = project(row, undefined);
  // full = { id: 1, email: 'a@b.com', role: 'admin', createdAt: ... }
}
// #endregion snippet-2

// #region snippet-3
{
  const q = qb.selectFrom('users').select(['email', 'role']).where('id', '=', 1).compile();

  console.log(q.text);
  // SELECT "email", "role" FROM "users" WHERE "id" = $1
}
// #endregion snippet-3

// #region snippet-4
{
  (async () => {
    // Expose only public-safe user data
    const publicUser = await users.findById(id, {
      select: ['id', 'email', 'role'] as const,
    });
    // Never leaks internal fields like password_hash
  })();
}
// #endregion snippet-4
