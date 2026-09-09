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
  const ddl = createSchemaDdl('analytics', 'postgres');
  console.log(ddl);
}
// #endregion snippet-1

// #region snippet-2
{
  // Fully qualify a table name
  const tableRef = qualify('analytics', 'events', 'postgres');
  console.log(tableRef);
}
// #endregion snippet-2

// #region snippet-3
{
  const compiler = createQueryCompiler('postgres');

  // Query a table in a specific schema
  const query = compiler
    .selectFrom('analytics.events')
    .select(['event_id', 'event_type', 'occurred_at'])
    .where('event_type', '=', 'page_view')
    .limit(100)
    .compile();

  console.log(query.text);
  console.log(query.parameters);
}
// #endregion snippet-3

// #region snippet-4
{
  // Creating schemas for each tenant
  const tenantSchemas = ['acme_corp', 'globex', 'soylent'];

  const createAllDdl = tenantSchemas.map(tenant => createSchemaDdl(tenant, 'postgres')).join(';\n');

  console.log(createAllDdl);
}
// #endregion snippet-4

// #region snippet-5
{
  const teamSchemas = [
    { name: 'auth', description: 'Authentication and users' },
    { name: 'billing', description: 'Payments and invoices' },
    { name: 'analytics', description: 'Event tracking and reporting' },
  ];

  const ddl = teamSchemas.map(t => createSchemaDdl(t.name, 'postgres')).join(';\n');
  console.log(ddl);
}
// #endregion snippet-5

// #region snippet-6
{
  // Setting search path (run as migration or initial setup)
  const setSearchPathDdl = `SET search_path TO analytics, public`;
}
// #endregion snippet-6

// #region snippet-7
{
  const dropSchemaDdl = `DROP SCHEMA IF EXISTS "staging" CASCADE`;
}
// #endregion snippet-7
