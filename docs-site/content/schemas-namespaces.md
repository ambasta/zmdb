Database schemas provide a namespace for organizing database objects. In PostgreSQL, schemas allow you to group tables, views, and other objects into logical units, enabling multiple teams or
applications to use the same database without naming collisions.

> [!IMPORTANT] zmdb supports schema creation through pure DDL functions on PostgreSQL and SQL Server. MySQL and SQLite do not expose this namespace shape through the dialect (they use databases and
> database files respectively).

## Creating a Schema

Use `createSchemaDdl` to generate the DDL for creating a new schema (namespace).

```ts {"mode":"compile","id":"example-001"}
import { postgres } from '@zmdb/postgres';
import { createSchemaDdl } from '@zmdb/sql/schema-objects';

const ddl = createSchemaDdl('analytics', postgres);
console.log(ddl);
```

```sql
CREATE SCHEMA "analytics"
```

## Qualifying Objects with Schemas

When working with multiple schemas, you need to reference objects using fully-qualified names. The `qualify` function generates properly quoted identifiers.

```ts {"mode":"compile","id":"example-002"}
import { postgres } from '@zmdb/postgres';
import { qualify } from '@zmdb/sql/schema-objects';

// Fully qualify a table name
const tableRef = qualify('analytics', 'events', postgres);
console.log(tableRef);
```

```sql
"analytics"."events"
```

## Using Qualified Names in Queries

Use the qualified table name when compiling queries that span schemas.

```ts {"mode":"compile","id":"example-003"}
import { createQueryCompiler, trustedTable } from '@zmdb/sql';
import { postgres } from '@zmdb/postgres';

const compiler = createQueryCompiler(postgres);

// Query a table in a specific schema
const query = compiler.selectFrom(trustedTable('analytics.events')).select(['event_id', 'event_type', 'occurred_at']).where('event_type', '=', 'page_view').limit(100).compile();

console.log(query.text);
console.log(query.parameters);
```

```sql
SELECT "event_id", "event_type", "occurred_at" FROM "analytics"."events" WHERE "event_type" = $1 LIMIT 100
-- parameters: ['page_view']
```

## Schema Organization Patterns

### Multi-Tenant Architecture

Each tenant can have their own schema, providing strong isolation.

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies createSchemaDdl; this excerpt does not repeat those declarations."}
// Creating schemas for each tenant
const tenantSchemas = ['acme_corp', 'globex', 'soylent'];

const createAllDdl = tenantSchemas.map(tenant => createSchemaDdl(tenant, 'postgres')).join(';\n');

console.log(createAllDdl);
```

```sql
CREATE SCHEMA "acme_corp";
CREATE SCHEMA "globex";
CREATE SCHEMA "soylent"
```

> [!TIP] For multi-tenant applications, consider using row-level security (RLS) within a single schema instead of managing dozens of schemas. See the [RLS](./rls.html) documentation.

### Team-Based Organization

Separate schemas for different teams or domains within an organization.

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies createSchemaDdl; this excerpt does not repeat those declarations."}
const teamSchemas = [
  { name: 'auth', description: 'Authentication and users' },
  { name: 'billing', description: 'Payments and invoices' },
  { name: 'analytics', description: 'Event tracking and reporting' },
];

const ddl = teamSchemas.map(t => createSchemaDdl(t.name, 'postgres')).join(';\n');
console.log(ddl);
```

```sql
CREATE SCHEMA "auth";
CREATE SCHEMA "billing";
CREATE SCHEMA "analytics"
```

## Default Schema Search Path

PostgreSQL uses a `search_path` to resolve unqualified object names. The default is `$user, public`. You can set a custom search path to control which schema is searched first.

```ts {"mode":"compile","id":"example-006"}
// Setting search path (run as migration or initial setup)
const setSearchPathDdl = `SET search_path TO analytics, public`;
```

> [!NOTE] This DDL is a session-level setting. For permanent changes, use `ALTER DATABASE` or `ALTER ROLE`.

## Dropping Schemas

Schemas can be dropped with `CASCADE` to also drop all contained objects, or `RESTRICT` (default) to refuse if objects exist.

```ts {"mode":"compile","id":"example-007"}
const dropSchemaDdl = `DROP SCHEMA IF EXISTS "staging" CASCADE`;
```

```sql
DROP SCHEMA IF EXISTS "staging" CASCADE
```

## Related

- [RLS](./rls.html) — row-level security for tenant isolation
- [Views](./views.html) — creating views within specific schemas
- [Schema Declaration](./schema-declaration.html) — defining tables that belong to schemas
