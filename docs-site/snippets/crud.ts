import { assert, is, validate } from '@zmdb/aot-validator';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { BaseRepository, type Driver } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/sqlite';
import { defineRepository, inc, schemaOf } from 'zmdb';
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
  views: number & Sql<'integer'> & HasDefault;
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
    const user = await users.create({
      email: 'alice@example.com',
      role: 'user', // optional, 'user' is the default
    });
    // user: Entity<UserSchema> — includes generated id, createdAt
  })();
}
// #endregion snippet-1

// #region snippet-2
{
  (async () => {
    // By primary key — the fastest path
    const user = await users.findById(1);
    // user: Entity<UserSchema> | undefined

    // By arbitrary columns
    const admin = await users.findOne({ role: 'admin' });
    // admin: Entity<UserSchema> | undefined

    // All rows — use with caution on large tables
    const allUsers = await users.findAll();
    // allUsers: readonly Entity<UserSchema>[]
  })();
}
// #endregion snippet-2

// #region snippet-3
{
  (async () => {
    const updated = await users.update(1, { role: 'admin' });
    // updated: Entity<UserSchema> | undefined (undefined if id not found)

    const post = await posts.increment(1, 'views');
    const affected = await posts.updateMany({ authorId: 7 }, { views: inc(1) });
  })();
}
// #endregion snippet-3

// #region snippet-4
{
  (async () => {
    const user = await users.findById(1);
    user.role = 'admin'; // ❌ This does NOTHING

    await users.update(1, { role: 'admin' }); // ✅ Explicit update required
  })();
}
// #endregion snippet-4

// #region snippet-5
{
  (async () => {
    const deleted = await users.delete(1);
    // deleted: boolean
  })();
}
// #endregion snippet-5

// #region snippet-6
{
  (async () => {
    // This throws — id is auto-increment
    await users.create({ id: 999, email: 'test@example.com' });

    // This throws — missing required field
    await users.create({}); // email is required
  })();
}
// #endregion snippet-6
