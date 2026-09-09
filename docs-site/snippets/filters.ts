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
  const someDate = new Date();
  builder
    .where('role', '=', 'admin')
    .where('createdAt', '>', someDate)
    .where('id', 'in', [1, 2, 3])
    .where('email', 'like', '%@example.com');
}
// #endregion snippet-1

// #region snippet-2
{
  // throws TypeError: invalid unmapped SQL operator …
  qb.selectFrom('users').where('role', "= 'x' OR 1=1 --", 1).compile();
}
// #endregion snippet-2

// #region snippet-3
{
  const where: WhereDTO<User> = {
    age: { gte: 18, lt: 65 }, // ANDed comparisons
    role: 'admin', // bare value ⇒ eq
    email: { like: '%@corp.com' }, // like/ilike only on string fields
    or: [{ id: { in: [1, 2] } }, { email: { isNull: true } }],
  };
  compileWhere(builder, where); // → parameterized WHERE clauses
}
// #endregion snippet-3
