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
  assert<string | number>(input); // string | number
  validate<string | null>(input); // the nullable-column shape
}
// #endregion snippet-1

// #region snippet-2
{
  validate<string | number>(true);
  // errors: [{ path: 'input', expected: 'string | number', message: 'expected string | number', value: true }]
}
// #endregion snippet-2

// #region snippet-3
{
  type Payment = { type: 'credit'; cardNumber: string } | { type: 'debit'; bankCode: string } | { type: 'cash' };

  const payment = assert<Payment>(body);
  if (payment.type === 'credit') payment.cardNumber; // narrowed, as TypeScript narrows it
}
// #endregion snippet-3

// #region snippet-4
{
  validate<Payment>({ type: 'crypto' });
  // errors: [{ path: 'input.type', expected: '"credit" | "debit" | "cash"', value: 'crypto' }]
}
// #endregion snippet-4

// #region snippet-5
{
  validate<Payment>({ type: 'credit', cardNumber: 42 });
  // errors: [{ path: 'input.cardNumber', expected: 'string', value: 42 }]
}
// #endregion snippet-5

// #region snippet-6
interface Node {
  value: number;
  next: Node | null;
}

assert<Node>(input); // walks the whole chain
// #endregion snippet-6

// #region snippet-7
export interface Account extends Table<'accounts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  iban: string & Sql<'varchar'> & Rule<'iban'>;
}
// #endregion snippet-7

// #region snippet-8
type Adult = number & Min<18> & Max<120>;
type Slug = string & MinLength<1> & MaxLength<64> & Pattern<'^[a-z0-9-]+$'>;

assert<Adult>(age);
assert<Slug>(slug);
// #endregion snippet-8

// #region snippet-9
{
  const adult = refine(v => typeof v === 'number' && v >= 18, 'must be at least 18');

  validateObject({ age: 17 }, { age: adult }, 'strict');
  // { success: false, issues: [{ path: 'input.age', expected: '<the predicate source>',
  //                             message: 'must be at least 18', value: 17 }] }
}
// #endregion snippet-9

// #region snippet-10
{
  type UserId = Brand<number, 'UserId'>;
  type OrderId = Brand<number, 'OrderId'>;

  const userId = 123 as UserId;
  const orderId = 456 as OrderId;
  // userId = orderId; // type error, though both are numbers at runtime
}
// #endregion snippet-10
