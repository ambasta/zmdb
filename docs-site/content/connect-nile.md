Dialect: `'postgres'`. Nile is Postgres with tenant isolation built into the database, which makes it an unusually good fit for the [multi-tenancy problem](./entity-filters.html) zmdb does not solve on its own.

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

Nile's model is that a table can be declared tenant-aware, after which the database itself scopes every query to the tenant set on the session. The declaration is DDL, so it goes in a [migration](./migrations-custom.html):

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

Then declare the column in the schema object so it appears in the row type:

```ts
export const todos = defineSchema('todos', {
  id: serial().primaryKey(),
  tenantId: text().notNull(),
  title: text().notNull(),
});
```

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

> [!WARNING]
> `SET LOCAL` is transaction-scoped, so the pattern above only holds if the
> statement and the `SET` are in the same transaction — with a checked-out client
> and no explicit `BEGIN`, each statement is its own transaction, so the `SET
LOCAL` applies to the `SET` statement's transaction and not the next one.
> Either wrap both in `BEGIN`/`COMMIT`, or use plain `SET` on a client you hold
> for the whole request. Verify with a test that a query for tenant A returns
> nothing when the session is tenant B — a tenancy mechanism you have not tried
> to break is a tenancy mechanism you do not have.

## Why this is better than an application-level filter

The [application-level version](./entity-filters.html) requires every read to carry the filter, and a single missed one leaks across tenants. Database-enforced isolation holds even for [raw SQL](./raw-sql.html), a migration, or a colleague in `psql` — which is the same argument for [Postgres RLS](./connect-supabase.html), and it is the right argument.

## Nile's built-in tables

Nile provides `tenants` and `users` tables of its own. Reference them by name, since there is no schema object to check against:

```ts
tenantId: references(text(), 'tenants.id').notNull(),
```

Do not generate migrations that would alter them — declare them in a schema object only if you intend zmdb to own them, which you do not.

---

See also: [Entity Filters](./entity-filters.html) · [Supabase](./connect-supabase.html) · [Writing a Driver](./custom-driver.html)
