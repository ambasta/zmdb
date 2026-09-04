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
  // Generate 100 rows with the default seed (1)
  const rows = seedRows(userSchema, { count: 100 });

  // rows => CreateDTO<User>[]
  // [{ name: 's3k1w9d', email: 's2m5p8k', age: 34, active: true }, ...]
}
// #endregion snippet-1

// #region snippet-2
{
  // Same seed = same rows every time
  const rows1 = seedRows(userSchema, { seed: 42, count: 10 });
  const rows2 = seedRows(userSchema, { seed: 42, count: 10 });

  // rows1 and rows2 are structurally equal
}
// #endregion snippet-2

// #region snippet-3
interface SeedOptions {
  seed?: number; // PRNG seed (default: 1)
  count: number; // number of rows to generate
}
// #endregion snippet-3

// #region snippet-4
export interface Thing extends Table<'things'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey; // absent — the database assigns it
  createdAt: Date & Sql<'timestamp'> & HasDefault; //    absent — the default assigns it
  name: string & Sql<'text'>; //                         generated
  active: boolean & Sql<'boolean'>; //                   generated
}
// #endregion snippet-4

// #region snippet-5
export interface Account extends Table<'accounts'> {
  slug: string & Sql<'text'> & Pattern<'^[a-z]+$'>;
}

seedRows(accountSchema, { count: 1 });
// Error: cannot sample `.slug`: a sample cannot be built from a pattern;
//        nothing here inverts a regular expression
// #endregion snippet-5

// #region snippet-6
{
  const accounts = Array.from({ length: 10 }, (_, i) => ({ slug: `account-${i}` }));
}
// #endregion snippet-6

// #region snippet-7
{
  (async () => {
    const rng = makeRng(42);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

    const authorIds = (await authorRepo.findAll()).map(a => a.id);
    for (const post of seedRows(postSchema, { count: 500, seed: 42 })) {
      await postRepo.create({ ...post, authorId: pick(authorIds) });
    }
  })();
}
// #endregion snippet-7

// #region snippet-8
{
  async function seedDatabase(repo: UserRepository, count: number) {
    for (const row of seedRows(userSchema, { count })) {
      await repo.create(row);
    }
  }
}
// #endregion snippet-8

// #region snippet-9
{
  (async () => {
    const q = createQueryCompiler('postgres').insertInto('users').values(rows).compile();
    await driver.execute(q);
  })();
}
// #endregion snippet-9
