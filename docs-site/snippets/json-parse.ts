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
  const result = parse('{"name": "alice", "age": 30}');
  // { success: true, data: { name: 'alice', age: 30 } }

  const bad = parse('not valid json');
  // {
  //   success: false,
  //   issues: [{ path: 'input', expected: 'valid JSON', value: 'not valid json',
  //              message: 'Unexpected token o in JSON at position 0' }],
  // }
}
// #endregion snippet-1

// #region snippet-2
interface ParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues?: readonly ValidationIssue[];
}
// #endregion snippet-2

// #region snippet-3
{
  interface User {
    name: string;
    age: number;
  }

  const result = parse<User>('{"name": "bob", "age": 25}');

  if (result.success) {
    result.data; // User — claimed, not proven
  } else {
    console.error(result.issues?.[0]?.message);
  }
}
// #endregion snippet-3

// #region snippet-4
{
  interface Signup {
    email: string & Pattern<'^[^@]+@[^@]+$'>;
    age: number & Min<18>;
  }

  const parsed = parse(text);
  if (!parsed.success) return reply.status(400).send({ errors: parsed.issues });

  const checked = validate<Signup>(parsed.data);
  if (!checked.success) return reply.status(422).send({ errors: checked.errors });

  checked.data; // Signup — checked, every property
}
// #endregion snippet-4

// #region snippet-5
{
  const ok = decode('{"email": "test@example.com", "age": 25}', ir);
  // { success: true, data: /* ... */ }

  const invalid = decode('{"email": "bad", "age": 15}', ir);
  // { success: false, issues: [ /* validation issues, exact paths */ ] }

  const malformed = decode('not json', ir);
  // { success: false, issues: [{ path: 'input', expected: 'valid JSON', /* ... */ }] }
}
// #endregion snippet-5

// #region snippet-6
interface Payload {
  kind: string;
  attempts: number;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  payload: Payload & Sql<'json'>;
}
// #endregion snippet-6

// #region snippet-7
{
  const raw = row.payload;
  const payload = typeof raw === 'string' ? assert<Payload>(JSON.parse(raw)) : raw;
}
// #endregion snippet-7
