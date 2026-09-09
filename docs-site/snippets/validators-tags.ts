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
export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'> & MaxLength<255>;
  age: (number & Sql<'integer'> & Min<0> & Max<150>) | null;
  role: 'admin' | 'user' | 'guest';
}
// #endregion snippet-1

// #region snippet-2
{
  tags.Min(18); // number >= 18
  tags.Max(100); // number <= 100
  tags.MinLength(1); // string length >= 1
  tags.MaxLength(255); // string length <= 255
  tags.Pattern('^\\d+$'); // matches regex
  tags.Enum('admin', 'user', 'guest'); // one of these values
}
// #endregion snippet-2

// #region snippet-3
{
  validate(tags.Min(18), 21); // true
  validate(tags.MaxLength(5), 'too long'); // false
  validate(tags.Enum('admin', 'user'), 'guest'); // false
}
// #endregion snippet-3

// #region snippet-4
{
  validate<Age>(25);
  validate<CreateDTO<User>>(body);
}
// #endregion snippet-4

// #region snippet-5
{
  // Runtime fallback (what runs without AOT):
  function validate(rule: Rule, expr: unknown): boolean {
    switch (rule.kind) {
      case 'Min':
        return typeof expr === 'number' && expr >= rule.args[0];
      case 'Pattern':
        return typeof expr === 'string' && new RegExp(rule.args[0]).test(expr);
      // ...
    }
  }
}
// #endregion snippet-5

// #region snippet-6
{
  // Authored:
  validate(
    tags.Min(18),
    userAge,
  )(
    // AOT output:
    typeof userAge === 'number' && userAge >= 18,
  );
}
// #endregion snippet-6
