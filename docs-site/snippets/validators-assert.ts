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
    interface Player {
      username: string & MaxLength<20>;
      score: number & Min<0>;
    }

    // Success — returns the value, typed
    const player = assert<Player>(await req.json());
    player.score; // number

    // Failure — throws
    try {
      assert<Player>({ username: 'thisusernameistoolong', score: -5 });
    } catch (e) {
      // e instanceof AssertError, and e.issues has both failures
    }
  })();
}
// #endregion snippet-1

// #region snippet-2
{
  class AssertError extends Error {
    readonly name = 'AssertError';
    readonly issues: readonly ValidationIssue[];
  }

  interface ValidationIssue {
    readonly path: string; // 'input.score'
    readonly message: string; // 'expected minimum 0'
    readonly expected?: string; // 'minimum 0'
    readonly value?: unknown; // -5
  }
}
// #endregion snippet-2

// #region snippet-3
{
  app.post('/users', async (req, reply) => {
    const dto = assert<CreateDTO<User>>(await req.body); // throws on a bad body
    const row: Entity<User> = await users.create(dto);
    return reply.send(row);
  });
}
// #endregion snippet-3

// #region snippet-4
interface Item {
  id: number;
  name: string;
}

assertEquals<Item>({ id: 1, name: 'test' }); // OK
assertEquals<Item>({ id: 1, name: 'test', extra: 'oops' }); // throws
// issues: [{ path: 'input', expected: 'no excess properties', /* ... */ }]
// #endregion snippet-4

// #region snippet-5
{
  type Email = string & Pattern<'^[^@]+@[^@]+$'>;

  const email = assert<Email>(input); // string, and it matched
}
// #endregion snippet-5

// #region snippet-6
{
  // authored
  const n = assert<number & Min<0>>(value);
}
// #endregion snippet-6
