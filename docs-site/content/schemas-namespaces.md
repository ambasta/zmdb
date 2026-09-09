Database schemas provide a namespace for organizing database objects. In PostgreSQL, schemas allow you to group tables, views, and other objects into logical units, enabling multiple teams or
applications to use the same database without naming collisions.

> [!IMPORTANT] zmdb supports schema creation through pure DDL functions on PostgreSQL and SQL Server. MySQL and SQLite do not expose this namespace shape through the dialect (they use databases and
> database files respectively).

## Creating a Schema

Use `createSchemaDdl` to generate the DDL for creating a new schema (namespace).

<!-- snippet: schemas-namespaces.ts#snippet-1 -->

```sql
CREATE SCHEMA "analytics"
```

## Qualifying Objects with Schemas

When working with multiple schemas, you need to reference objects using fully-qualified names. The `qualify` function generates properly quoted identifiers.

<!-- snippet: schemas-namespaces.ts#snippet-2 -->

```sql
"analytics"."events"
```

## Using Qualified Names in Queries

Use the qualified table name when compiling queries that span schemas.

<!-- snippet: schemas-namespaces.ts#snippet-3 -->

```sql
SELECT "event_id", "event_type", "occurred_at" FROM "analytics"."events" WHERE "event_type" = $1 LIMIT 100
-- parameters: ['page_view']
```

## Schema Organization Patterns

### Multi-Tenant Architecture

Each tenant can have their own schema, providing strong isolation.

<!-- snippet: schemas-namespaces.ts#snippet-4 -->

```sql
CREATE SCHEMA "acme_corp";
CREATE SCHEMA "globex";
CREATE SCHEMA "soylent"
```

> [!TIP] For multi-tenant applications, consider using row-level security (RLS) within a single schema instead of managing dozens of schemas. See the [RLS](./rls.html) documentation.

### Team-Based Organization

Separate schemas for different teams or domains within an organization.

<!-- snippet: schemas-namespaces.ts#snippet-5 -->

```sql
CREATE SCHEMA "auth";
CREATE SCHEMA "billing";
CREATE SCHEMA "analytics"
```

## Default Schema Search Path

PostgreSQL uses a `search_path` to resolve unqualified object names. The default is `$user, public`. You can set a custom search path to control which schema is searched first.

<!-- snippet: schemas-namespaces.ts#snippet-6 -->

> [!NOTE] This DDL is a session-level setting. For permanent changes, use `ALTER DATABASE` or `ALTER ROLE`.

## Dropping Schemas

Schemas can be dropped with `CASCADE` to also drop all contained objects, or `RESTRICT` (default) to refuse if objects exist.

<!-- snippet: schemas-namespaces.ts#snippet-7 -->

```sql
DROP SCHEMA IF EXISTS "staging" CASCADE
```

## Related

- [RLS](./rls.html) — row-level security for tenant isolation
- [Views](./views.html) — creating views within specific schemas
- [Schema Declaration](./schema-declaration.html) — defining tables that belong to schemas
