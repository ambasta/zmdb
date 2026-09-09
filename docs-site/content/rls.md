Row-Level Security (RLS) is a PostgreSQL feature that restricts which rows users can access based on their session characteristics. It's the recommended approach for multi-tenant applications,
providing security at the database level without relying solely on application logic.

> [!IMPORTANT] zmdb's RLS DDL surface is available only on the `'postgres'` dialect. Cockroach is refused because deployed server versions vary; MySQL, SingleStore, and SQLite do not provide this
> policy shape. SQL Server has native RLS, but it requires predicate functions and security policies that `RlsPolicy` cannot represent. Every other dialect throws `UnsupportedFeatureError`.

## Enabling Row-Level Security

Use `enableRlsDdl` to enable RLS on a table. This is the first step before creating any policies.

<!-- snippet: rls.ts#snippet-1 -->

```sql
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY
```

> [!WARNING] Once RLS is enabled, all queries against the table are subject to RLS policies. If no policy exists, no rows will be returned. Always create at least one policy after enabling RLS.

## Creating RLS Policies

Use `createPolicyDdl` to define a policy. The policy specifies which rows are visible based on a USING expression.

<!-- snippet: rls.ts#snippet-2 -->

```sql
CREATE POLICY "users_can_see_own_orders" ON "orders" FOR SELECT USING (user_id = current_user_id())
```

## Policy Commands

Policies can be scoped to specific SQL commands: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or `ALL` (default).

<!-- snippet: rls.ts#snippet-3 -->

```sql
CREATE POLICY "tenant_isolation_all" ON "documents" FOR ALL USING (tenant_id = current_tenant_id())
CREATE POLICY "read_only_access" ON "reports" FOR SELECT USING (true)
```

## Multi-Tenant Isolation

The most common use case for RLS is multi-tenant data isolation. Each tenant's data is protected at the database level.

<!-- snippet: rls.ts#snippet-4 -->

```sql
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select" ON "tenants" FOR SELECT USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_insert" ON "tenants" FOR INSERT USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_update" ON "tenants" FOR UPDATE USING (id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_delete" ON "tenants" FOR DELETE USING (id = current_setting('app.tenant_id', true)::uuid)
```

> [!TIP] Set the tenant context using `SET LOCAL app.tenant_id = 'uuid-here'` in your transaction, then execute queries. The RLS policy automatically filters rows.

## Bypass for Service Accounts

Some operations (like batch imports or admin tools) may need to bypass RLS. Use `FORCE` to make policies mandatory or bypass them with `BYPASS`.

<!-- snippet: rls.ts#snippet-5 -->

```sql
CREATE POLICY "admin_bypass" ON "orders" FOR ALL USING (current_user = 'admin')
```

> [!NOTE] Bypassing RLS is a powerful privilege that should be granted sparingly. Create separate service accounts for admin operations rather than using superuser accounts.

## Disabling RLS

If you need to temporarily disable RLS (for migrations, etc.), use `DISABLE ROW LEVEL SECURITY`.

<!-- snippet: rls.ts#snippet-6 -->

```sql
ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY
```

## Related

- [Schemas & Namespaces](./schemas-namespaces.html) — organizing RLS-protected tables
- [Indexes & Constraints](./indexes-constraints.html) — performance considerations for RLS
- [Relations](./relations.html) — relationship handling with RLS enabled
