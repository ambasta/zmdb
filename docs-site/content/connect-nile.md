Dialect: `'postgres'`. Nile is Postgres with tenant isolation built into the database, which makes it an unusually good fit for the [multi-tenancy problem](./entity-filters.html) zmdb does not solve
on its own.

## Setup

```ts
import { Pool } from 'pg';
import { ValidationError } from '@zmdb/schema-core';
import type { Driver } from '@zmdb/repository';

const pool = new Pool({
  connectionString: process.env.NILEDB_URL,
  ssl: { rejectUnauthorized: true },
});

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

## Tenant-aware tables

Nile's model is that a table can be declared tenant-aware, after which the database itself scopes every query to the tenant set on the session. The declaration is DDL, so it goes in a
[migration](./migrations-custom.html):

```ts
{
  version: 2,
  name: 'todos_tenant_aware',
  up: `ALTER TABLE "todos" ADD COLUMN "tenant_id" UUID;
       -- Nile's tenant-aware marker
       ALTER TABLE "todos" ADD CONSTRAINT tenant_fk FOREIGN KEY ("tenant_id") REFERENCES tenants(id);`,
  down: `ALTER TABLE "todos" DROP CONSTRAINT tenant_fk; ALTER TABLE "todos" DROP COLUMN "tenant_id";`,
}
```

Then declare the column on the interface so it appears in the row type:

```ts
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Todo extends Table<'todos'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  tenantId: string & Sql<'text'>;
  title: string & Sql<'text'>;
}

const todos = schemaOf<Todo>();
```

`Sql<'text'>` rather than a UUID type, because `SqlType` has no `uuid` member — the migration above writes `UUID` and the declaration calls it text. That mismatch is deliberate and narrow: it affects
generated DDL for this table, which you are writing by hand anyway, and nothing else reads the column as anything but a string.

## Setting the tenant per request

This is the part that has to be right, and it belongs in the driver — the only layer that owns the connection:

```ts
export function tenantDriver(tenantId: string): Driver {
  return {
    async execute(query) {
      const client = await pool.connect();
      try {
        await client.query('SET LOCAL nile.tenant_id = $1', [tenantId]);
        const result = await client.query(query.text, [...query.parameters]);
        return result.rows;
      } finally {
        client.release();
      }
    },
  };
}
```

Then build repositories per request:

```ts
const tenantId = ctx.headers['x-tenant-id'];
if (tenantId === undefined) throw new ValidationError('missing tenant', []);

const repo = defineRepository(todos, tenantDriver(tenantId), { dialect: 'postgres' });
```

> [!WARNING] `SET LOCAL` is transaction-scoped, so the pattern above only holds if the statement and the `SET` are in the same transaction — with a checked-out client and no explicit `BEGIN`, each
> statement is its own transaction, so the `SET LOCAL` applies to the `SET` statement's own transaction and not the next one. Either wrap both in `BEGIN`/`COMMIT`, or use plain `SET` on a client you
> hold for the whole request. Verify with a test that a query for tenant A returns nothing when the session is tenant B — a tenancy mechanism you have not tried to break is a tenancy mechanism you do
> not have.

## Why this is better than an application-level filter

The [application-level version](./entity-filters.html) requires every read to carry the filter, and a single missed one leaks across tenants. Database-enforced isolation holds even for
[raw SQL](./raw-sql.html), a migration, or a colleague in `psql` — which is the same argument for [Postgres RLS](./connect-supabase.html), and it is the right argument.

## Nile's built-in tables

Nile provides `tenants` and `users` tables of its own. Reference them by name, since there is no declaration to check against:

```ts
tenantId: string & Sql<'text'> & References<'tenants.id'>;
```

`References<'tenants.id'>` is a string literal and nothing validates that the table exists, which is exactly what you want here — the target is Nile's, not yours.

Do not generate migrations that would alter them. Declare a table zmdb does not own only if you intend zmdb to own it, which you do not.

---

See also: [Entity Filters](./entity-filters.html) · [Supabase](./connect-supabase.html) · [Writing a Driver](./custom-driver.html)
