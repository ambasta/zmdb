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
  const primary = new PgDriver(pool);
  const replica1 = new PgDriver(replicaPool1);
  const replica2 = new PgDriver(replicaPool2);

  const driver = withReplicas({
    primary,
    replicas: [replica1, replica2],
  });
}
// #endregion snippet-1

// #region snippet-2
{
  (async () => {
    // All repository operations use this driver
    const repo = new UserRepository(driver);
    const user = await repo.findById(1); // May hit a replica
    await repo.create({ name: 'Alice' }); // Always hits primary
  })();
}
// #endregion snippet-2

// #region snippet-3
{
  isWrite('SELECT * FROM users'); // false
  isWrite('INSERT INTO users ...'); // true
  isWrite('UPDATE users SET ...'); // true
  isWrite('DELETE FROM users ...'); // true
}
// #endregion snippet-3

// #region snippet-4
{
  const driver = withReplicas({
    primary,
    replicas: [replica1, replica2, replica3],
    pick: (replicas, nextIndex) => {
      // Example: weighted random, health-based, or latency-based
      return replicas[nextIndex % replicas.length];
    },
  });
}
// #endregion snippet-4

// #region snippet-5
{
  class ResilientDriver implements Driver {
    constructor(
      private driver: Driver,
      private retries = 3,
    ) {}

    async execute(query: CompiledQuery) {
      for (let i = 0; i < this.retries; i++) {
        try {
          return await this.driver.execute(query);
        } catch (e) {
          if (i === this.retries - 1) throw e;
          await new Promise(r => setTimeout(r, 100 * (i + 1)));
        }
      }
      throw new Error('Unreachable');
    }
  }
}
// #endregion snippet-5

// #region snippet-6
{
  const driver = withReplicas({
    primary,
    replicas: [], // All queries hit primary
  });
}
// #endregion snippet-6
