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
const payload = {} as any;
const userTypeIr = {} as any;

// #region snippet-1
{
  // Authored code
  const ok = is<{ email: string }>(input);

  // Compiled output (no runtime parser)
  const ok = typeof input === 'object' && input !== null && typeof input.email === 'string';
}
// #endregion snippet-1

// #region snippet-2
{
  // vite.config.ts

  export default defineConfig({
    plugins: [await zmdbAot()],
  });
}
// #endregion snippet-2

// #region snippet-3
{
  const ok = is<{ n: number; s: string }>(input);
}
// #endregion snippet-3

// #region snippet-4
{
  const ok = typeof input === 'object' && input !== null && typeof input.n === 'number' && typeof input.s === 'string';
}
// #endregion snippet-4

// #region snippet-5
{
  const v = assert<{ s: string }>(input);
}
// #endregion snippet-5

// #region snippet-6
{
  const v = (() => {
    if (!(typeof input === 'object' && input !== null && typeof input.s === 'string'))
      throw new AssertError('assertion failed');
    return input;
  })();
}
// #endregion snippet-6

// #region snippet-7
{
  // Input
  const ok = is<{ user: { email: string } }>(input);

  // Output
  const ok =
    typeof input === 'object' &&
    input !== null &&
    typeof input.user === 'object' &&
    input.user !== null &&
    typeof input.user.email === 'string';
}
// #endregion snippet-7

// #region snippet-8
{
  // vite.config.ts
  export default defineConfig({
    plugins: [
      zmdbAot({
        // Optional: additional excludes
        exclude: [/node_modules/, /dist/],
      }),
    ],
  });
}
// #endregion snippet-8

// #region snippet-9
{
  const ok = is(payload, userTypeIr);
}
// #endregion snippet-9
