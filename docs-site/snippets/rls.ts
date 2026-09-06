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
  const ddl = enableRlsDdl('orders', 'postgres');
  console.log(ddl);
}
// #endregion snippet-1

// #region snippet-2
{
  const policy = {
    name: 'users_can_see_own_orders',
    table: 'orders',
    using: 'user_id = current_user_id()',
    command: 'SELECT',
  };

  const ddl = createPolicyDdl(policy, 'postgres');
  console.log(ddl);
}
// #endregion snippet-2

// #region snippet-3
{
  // Policy for all operations
  const allPolicy = {
    name: 'tenant_isolation_all',
    table: 'documents',
    using: 'tenant_id = current_tenant_id()',
    command: 'ALL',
  };

  const selectOnlyPolicy = {
    name: 'read_only_access',
    table: 'reports',
    using: 'true', // everyone can read
    command: 'SELECT',
  };
}
// #endregion snippet-3

// #region snippet-4
{
  // Complete RLS setup for a multi-tenant table
  const policies = [
    // Enable RLS on the table
    enableRlsDdl('tenants', 'postgres'),

    // Policy for SELECT - users can only see their tenant
    createPolicyDdl(
      {
        name: 'tenant_select',
        table: 'tenants',
        using: "id = current_setting('app.tenant_id', true)::uuid",
        command: 'SELECT',
      },
      'postgres',
    ),

    // Policy for INSERT - can only insert for their tenant
    createPolicyDdl(
      {
        name: 'tenant_insert',
        table: 'tenants',
        using: "id = current_setting('app.tenant_id', true)::uuid",
        command: 'INSERT',
      },
      'postgres',
    ),

    // Policy for UPDATE - can only update their tenant
    createPolicyDdl(
      {
        name: 'tenant_update',
        table: 'tenants',
        using: "id = current_setting('app.tenant_id', true)::uuid",
        command: 'UPDATE',
      },
      'postgres',
    ),

    // Policy for DELETE - can only delete their tenant
    createPolicyDdl(
      {
        name: 'tenant_delete',
        table: 'tenants',
        using: "id = current_setting('app.tenant_id', true)::uuid",
        command: 'DELETE',
      },
      'postgres',
    ),
  ];

  console.log(policies.join(';\n'));
}
// #endregion snippet-4

// #region snippet-5
{
  // Admin role bypass (run as superuser or owner)
  const bypassPolicy = {
    name: 'admin_bypass',
    table: 'orders',
    using: "current_user = 'admin'",
    command: 'ALL',
  };

  // Note: BYPASS requires superuser or BYPASSRLS attribute
  // This is typically handled at the role level, not in the policy
}
// #endregion snippet-5

// #region snippet-6
{
  const disableRlsDdl = `ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY`;
}
// #endregion snippet-6
