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
interface ValidateResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly ValidationIssue[];
}
// #endregion snippet-1

// #region snippet-2
{
  interface Signup {
    email: string & Pattern<'^[^@]+@[^@]+$'>;
    age: number & Min<18>;
  }

  const ok = validate<Signup>({ email: 'user@example.com', age: 25 });
  // { success: true, data: { email: 'user@example.com', age: 25 } }

  const bad = validate<Signup>({ email: 'invalid', age: 15 });
  // { success: false, errors: [ /* ... */ ] }
}
// #endregion snippet-2

// #region snippet-3
{
  const result = validate<Signup>(body);
  if (!result.success) return reply.status(400).send({ errors: result.errors });
  result.data; // Signup
}
// #endregion snippet-3

// #region snippet-4
interface ValidationIssue {
  readonly path: string; // 'input.items[2].name'
  readonly message: string; // human-readable
  readonly expected?: string; // 'string', 'maxLength 50', 'no excess properties'
  //                             a violated bound reads `<keyword> <value>`;
  //                             a wrong type reads the type
  readonly value?: unknown; // the offending value
}
// #endregion snippet-4

// #region snippet-5
interface Roster {
  users: { name: string & MaxLength<10> }[];
}

validate<Roster>({ users: [{ name: 'LongNameTooLong' }] });
// errors[0].path === 'input.users[0].name'
// #endregion snippet-5

// #region snippet-6
{
  export interface User extends Table<'users'> {
    id: number & Sql<'integer'> & Serial & PrimaryKey;
    email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+$'>;
    age: number & Sql<'integer'> & Min<18>;
  }

  const create = validate<CreateDTO<User>>(body); // `id` is absent — it is Serial
  const patch = validate<UpdateDTO<User>>(body); // every column optional, `id` absent
}
// #endregion snippet-6

// #region snippet-7
{
  (async () => {
    await repo.create({ email: 'new@example.com', age: 25 }); // OK
    await repo.create({ email: 'bad', age: 10 }); // throws ValidationError
  })();
}
// #endregion snippet-7

// #region snippet-8
{
  (async () => {
    try {
      await repo.create(payload);
    } catch (err) {
      const issues = validationIssuesOf(err);
      if (issues) return reply.status(400).send({ errors: issues });
      throw err;
    }
  })();
}
// #endregion snippet-8
