Dialect: `'postgres'`. Supabase is Postgres, so connect with an ordinary Postgres client — not the `supabase-js` SDK, which speaks to PostgREST rather than to the database.

## Setup

```ts
import { Pool } from 'pg';
import type { Driver } from '@zmdb/repository';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

## Which connection string

Supabase gives you three, and the choice matters:

|                             | Port | Pooling     | Use for                          |
| --------------------------- | ---- | ----------- | -------------------------------- |
| Direct                      | 5432 | none        | long-running servers, migrations |
| Supavisor, session mode     | 5432 | session     | long-running servers behind IPv4 |
| Supavisor, transaction mode | 6543 | transaction | serverless, edge functions       |

Run **migrations against the direct connection**. Transaction-mode pooling breaks multi-statement DDL and session state, and a migration is exactly that.

Use **transaction mode for serverless**, and disable prepared statements — see [Postgres](./connect-postgres.html) for what transaction pooling costs you.

## Row Level Security

This is the important interaction. Supabase enables RLS on tables created through its dashboard, and its policies are written against `auth.uid()`. A table created by a zmdb migration has **no RLS and no policies**, which means:

- Your server-side driver (using the service role or the postgres user) reads and writes normally.
- The `anon` and `authenticated` roles that `supabase-js` uses can read and write everything, because there is no policy denying them.

If any client talks to your database through PostgREST, you must add the policies yourself, in a migration:

```ts
{
  version: 5,
  name: 'posts_rls',
  up: `
    ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "read own" ON "posts" FOR SELECT
      USING (auth.uid() = user_id);
    CREATE POLICY "write own" ON "posts" FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  `,
  down: `DROP POLICY "write own" ON "posts"; DROP POLICY "read own" ON "posts";
         ALTER TABLE "posts" DISABLE ROW LEVEL SECURITY;`,
}
```

> [!WARNING]
> A table with RLS enabled and no policies denies everything to non-superusers —
> including, silently, a client you forgot about. A table with RLS disabled
> allows everything. Neither default is what you want by accident. If your
> architecture is "zmdb server only, no direct client access", RLS is optional;
> if `supabase-js` is in your frontend, it is mandatory.

## Referencing `auth.users`

Supabase's users live in the `auth` schema, which a `Table<…>` declaration cannot describe — a table name is one identifier, not a qualified pair.

```ts
userId: string & Sql<'text'>; // FK to auth.users.id, added in a migration
```

`References<'auth.users.id'>` does not work: the tag is parsed as `table.column`, so a three-part name is refused. Declare the column without a reference tag and add the constraint in a [custom migration](./migrations-custom.html):

```sql
ALTER TABLE profiles ADD CONSTRAINT profiles_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
```

You lose the compile-time check the tag would give you, which is the trade-off — there is no declaration for `auth.users` to check against.

## Edge Functions

Supabase Edge Functions run on Deno. The compiler and validators work unchanged; use `postgres.js` over the transaction-mode pooler and expect a connection per invocation. See [Deploy to Supabase Edge](./deploy-supabase-edge.html).

---

See also: [Dialect: Postgres](./dialect-postgres.html) · [Deploy to Supabase Edge](./deploy-supabase-edge.html) · [Entity Filters](./entity-filters.html)
