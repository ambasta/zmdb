Row-Level Security (RLS) is a PostgreSQL feature that restricts which rows users can access based on their session characteristics. It's the recommended approach for multi-tenant applications, providing security at the database level without relying solely on application logic.

> [!IMPORTANT]
> zmdb's RLS DDL surface is PostgreSQL-only. MySQL and SQLite do not provide
> that policy shape; SQL Server has native RLS, but it requires predicate
> functions and security policies that `RlsPolicy` cannot represent. On every
> non-PostgreSQL dialect these helpers throw `UnsupportedFeatureError`.

## Enabling Row-Level Security

Use `enableRlsDdl` to enable RLS on a table. This is the first step before creating any policies.

```ts
import { enableRlsDdl, UnsupportedFeatureError } from '@zmdb/query-compiler/schema-objects';

const ddl = enableRlsDdl('orders', 'postgres');
console.log(ddl);
```

```sql
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY
```

> [!WARNING]
> Once RLS is enabled, all queries against the table are subject to RLS policies. If no policy exists, no rows will be returned. Always create at least one policy after enabling RLS.

## Creating RLS Policies

Use `createPolicyDdl` to define a policy. The policy specifies which rows are visible based on a USING expression.

```ts
import { createPolicyDdl } from '@zmdb/query-compiler/schema-objects';

const policy = {
  name: 'users_can_see_own_orders',
  table: 'orders',
  using: 'user_id = current_user_id()',
  command: 'SELECT',
};

const ddl = createPolicyDdl(policy, 'postgres');
console.log(ddl);
```

```sql
CREATE POLICY "users_can_see_own_orders" ON "orders" FOR SELECT USING (user_id = current_user_id())
```

## Policy Commands

Policies can be scoped to specific SQL commands: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or `ALL` (default).

```ts
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
```

```sql
CREATE POLICY "tenant_isolation_all" ON "documents" FOR ALL USING (tenant_id = current_tenant_id())
CREATE POLICY "read_only_access" ON "reports" FOR SELECT USING (true)
```

## Multi-Tenant Isolation

The most common use case for RLS is multi-tenant data isolation. Each tenant's data is protected at the database level.

```ts
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
```

```sql
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select" ON "tenants" FOR SELECT USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_insert" ON "tenants" FOR INSERT USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_update" ON "tenants" FOR UPDATE USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_delete" ON "tenants" FOR DELETE USING (id = current_setting('app.tenant_id', true)::uuid)
```

> [!TIP]
> Set the tenant context using `SET LOCAL app.tenant_id = 'uuid-here'` in your transaction, then execute queries. The RLS policy automatically filters rows.

## Bypass for Service Accounts

Some operations (like batch imports or admin tools) may need to bypass RLS. Use `FORCE` to make policies mandatory or bypass them with `BYPASS`.

```ts
// Admin role bypass (run as superuser or owner)
const bypassPolicy = {
  name: 'admin_bypass',
  table: 'orders',
  using: "current_user = 'admin'",
  command: 'ALL',
};

// Note: BYPASS requires superuser or BYPASSRLS attribute
// This is typically handled at the role level, not in the policy
```

```sql
CREATE POLICY "admin_bypass" ON "orders" FOR ALL USING (current_user = 'admin')
```

> [!NOTE]
> Bypassing RLS is a powerful privilege that should be granted sparingly. Create separate service accounts for admin operations rather than using superuser accounts.

## Disabling RLS

If you need to temporarily disable RLS (for migrations, etc.), use `DISABLE ROW LEVEL SECURITY`.

```ts
const disableRlsDdl = `ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY`;
```

```sql
ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY
```

## Related

- [Schemas & Namespaces](./schemas-namespaces.html) — organizing RLS-protected tables
- [Indexes & Constraints](./indexes-constraints.html) — performance considerations for RLS
- [Relations](./relations.html) — relationship handling with RLS enabled
