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
  interface Account {
    name: string;
    age: number;
    active: boolean;
  }

  const sample = random<Account>();
  // { name: 'k3f9qz', age: 417, active: true }

  is<Account>(sample); // true
}
// #endregion snippet-1

// #region snippet-2
{
  random<boolean>(); // true or false
  random<number>(); // 0 /* ... */ 1000
  random<Date>(); // an arbitrary instant, epoch to roughly 2024
  random<bigint>(); // 417n
  random<'admin' | 'user' | 'guest'>(); // 'user' — one member, at random
  random<null>(); // null
}
// #endregion snippet-2

// #region snippet-3
{
  random<number & Min<100> & Max<200>>(); // 100 /* ... */ 200
  random<string & MinLength<8> & MaxLength<8>>(); // exactly eight characters
}
// #endregion snippet-3

// #region snippet-4
{
  interface Order {
    id: number;
    items: { productId: number; quantity: number & Min<1> }[];
  }

  const order = random<Order>();
  // { id: 88, items: [{ productId: 3, quantity: 12 }, { productId: 91, quantity: 7 }] }
}
// #endregion snippet-4

// #region snippet-5
{
  const input = { ...random<Omit<CreateDTO<User>, 'email'>>(), email: 'a@b.test' };
}
// #endregion snippet-5

// #region snippet-6
{
  export interface User extends Table<'users'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    name: string & Sql<'text'> & MaxLength<100>;
    email: string & Sql<'text'>;
    age: (number & Sql<'integer'> & Min<0> & Max<120>) | null;
  }

  const sampleUser = random<CreateDTO<User>>();
  // { name: 'k3f9qz', email: 'p2m8t1x', age: 25 }
}
// #endregion snippet-6

// #region snippet-7
{
  describe('UserRepository', () => {
    it('creates valid users', async () => {
      const input = random<CreateDTO<User>>();

      // Generated data is guaranteed valid
      is<CreateDTO<User>>(input); // true

      const created = await repo.create(input);

      // The row that came back is exactly an entity — no extra keys, none missing
      assertEquals<Entity<User>>(created);
    });

    it('rejects invalid input', async () => {
      const invalid = { email: 'not-email', name: 'x'.repeat(101), age: 15 };

      await expect(repo.create(invalid)).rejects.toThrow();
    });
  });
}
// #endregion snippet-7

// #region snippet-8
{
  for (let i = 0; i < 1000; i++) {
    const input = random<CreateDTO<User>>();

    // Should always pass — `random` builds the value from the same IR `validate` checks
    const result = validate<CreateDTO<User>>(input);
    if (!result.success) {
      console.error('Generated invalid input:', input, result.errors);
    }
  }
}
// #endregion snippet-8
