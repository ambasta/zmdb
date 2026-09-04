import { assert, is, validate } from '@zmdb/aot-validator';
import { createQueryCompiler, type CompiledQuery, type Dialect } from '@zmdb/query-compiler';
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
export interface Driver {
  readonly dialect?: Dialect;
  readonly queryTelemetry?: true;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}
// #endregion snippet-1

// #region snippet-2
{
  // node:sqlite — no external dependency

  const db = new DatabaseSync('app.db');
  const users = defineRepository(UserSchema, sqliteDriver(db), { dialect: 'sqlite' });
}
// #endregion snippet-2

// #region snippet-3
{
  // pg (node-postgres)

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const users = defineRepository(UserSchema, pgDriver(pool), { dialect: 'postgres' });

  // opt-in server-side prepared statements (caches the plan per SQL text)
  const fast = pgDriver(pool, { prepared: true });
}
// #endregion snippet-3

// #region snippet-4
{
  export function d1Driver(db: D1Database): Driver {
    return {
      dialect: 'sqlite',
      async execute(query) {
        const { results } = await db
          .prepare(query.text)
          .bind(...query.parameters)
          .all();
        return results;
      },
    };
  }
}
// #endregion snippet-4

// #region snippet-5
{
  const driver = loggingDriver(cachingDriver(withReplicas({ primary, replicas }), store, 5_000), sink);
}
// #endregion snippet-5

// #region snippet-6
{
  const users = defineRepository(UserSchema, driver, { dialect: 'postgres' });
}
// #endregion snippet-6

// #region snippet-7
{
  class UserRepository extends BaseRepository<User> {
    static override readonly schema = UserSchema;
  }

  const users = new UserRepository(driver, 'sqlite'); // (driver, dialect?)
}
// #endregion snippet-7

// #region snippet-8
{
  (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const tx = { execute: (q: CompiledQuery) => client.query(q.text, [...q.parameters]).then(r => r.rows) };
      const txUsers = users.withTransaction(tx);
      const txAccounts = accounts.withTransaction(tx);

      await txUsers.create({ email: 'ada@example.com' });
      await txAccounts.update(1, { status: 'active' });

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })();
}
// #endregion snippet-8

// #region snippet-9
{
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
}
// #endregion snippet-9

// #region snippet-10
{
  const calls: CompiledQuery[] = [];
  const spy: Driver = { dialect: 'postgres', execute: async q => (calls.push(q), []) };

  await defineRepository(users, spy, { dialect: 'postgres' }).findAll();
  expect(calls[0]?.text).toContain('SELECT');
}
// #endregion snippet-10
