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
  const indexDef = {
    name: 'idx_users_email',
    table: 'users',
    columns: ['email'],
  };

  const ddl = createIndexDdl(indexDef, 'postgres');
  console.log(ddl);
}
// #endregion snippet-1

// #region snippet-2
{
  const uniqueIndex = {
    name: 'idx_users_email_unique',
    table: 'users',
    columns: ['email'],
    unique: true,
  };

  const ddl = createIndexDdl(uniqueIndex, 'postgres');
  console.log(ddl);
}
// #endregion snippet-2

// #region snippet-3
{
  const compositeIndex = {
    name: 'idx_orders_tenant_status',
    table: 'orders',
    columns: ['tenant_id', 'status', 'created_at'],
  };

  const ddl = createIndexDdl(compositeIndex, 'postgres');
  console.log(ddl);
}
// #endregion snippet-3

// #region snippet-4
{
  const partialIndex = {
    name: 'idx_orders_pending',
    table: 'orders',
    columns: ['id'],
    where: "status = 'pending'",
  };

  const ddl = createIndexDdl(partialIndex, 'postgres');
  console.log(ddl);
}
// #endregion snippet-4

// #region snippet-5
{
  const constraint = {
    name: 'chk_users_age',
    table: 'users',
    expression: 'age >= 18',
  };

  const ddl = checkConstraintDdl('users', 'chk_users_age', 'age >= 18', 'postgres');
  console.log(ddl);
}
// #endregion snippet-5

// #region snippet-6
{
  const positiveConstraint = checkConstraintDdl('products', 'chk_product_price', 'price > 0', 'postgres');
}
// #endregion snippet-6

// #region snippet-7
{
  const enumConstraint = checkConstraintDdl(
    'orders',
    'chk_order_status',
    "status IN ('pending', 'processing', 'completed', 'cancelled')",
    'postgres',
  );
}
// #endregion snippet-7

// #region snippet-8
{
  const lengthConstraint = checkConstraintDdl('users', 'chk_username_length', 'char_length(username) >= 3', 'postgres');
}
// #endregion snippet-8

// #region snippet-9
{
  // Lowercase email index for case-insensitive lookups
  const expressionIndex = {
    name: 'idx_users_email_lower',
    table: 'users',
    columns: [{ expr: 'lower("email")' }],
  };

  const ddl = createIndexDdl(expressionIndex, 'postgres');
  console.log(ddl);
}
// #endregion snippet-9

// #region snippet-10
{
  const dropIndexDdl = `DROP INDEX IF EXISTS "idx_users_email"`;
  const dropConstraintDdl = `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_age"`;
}
// #endregion snippet-10
