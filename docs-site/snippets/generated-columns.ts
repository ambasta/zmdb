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
  const genCol = {
    name: 'full_name',
    type: 'VARCHAR(255)',
    expression: "first_name || ' ' || last_name",
    stored: true,
  };

  const ddl = generatedColumnDdl(genCol, 'postgres');
  console.log(ddl);
}
// #endregion snippet-1

// #region snippet-2
{
  const auditLogDef = {
    name: 'duration_ms',
    type: 'INTEGER',
    expression: 'EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000',
    stored: true,
  };
}
// #endregion snippet-2

// #region snippet-3
{
  const jsonExtractionDef = {
    name: 'user_email',
    type: 'VARCHAR(255)',
    expression: "(payload->>'user')::text",
    stored: true,
  };
}
// #endregion snippet-3

// #region snippet-4
{
  const totalPriceDef = {
    name: 'total_price',
    type: 'NUMERIC(10,2)',
    expression: 'unit_price * quantity',
    stored: true,
  };
}
// #endregion snippet-4

// #region snippet-5
export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  unit_price: number & Sql<'numeric'> & Numeric<10, 2>;
  quantity: number & Sql<'integer'>;
  // total_price is generated — it lives in the migration, not here
}
// #endregion snippet-5

// #region snippet-6
{
  const compiler = createQueryCompiler('postgres');

  const query = compiler.selectFrom('orders').select(['id', 'unit_price', 'quantity', 'total_price']).compile();

  console.log(query.text);
}
// #endregion snippet-6
