Dialect: `'postgres'`. Prisma Postgres is a managed Postgres, and you connect to it with an ordinary Postgres client — not the Prisma Client, which is a different abstraction over the same database.

## Setup

Prisma Postgres exposes a standard connection string. With `pg`:

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

If your plan gives you only the Accelerate-style HTTP endpoint, use `@prisma/adapter-*` or their serverless driver and wrap it the same way — a `Driver` has one required method over whatever transport you have.

## Migrating away from Prisma Client

The database does not change; what changes is who defines the schema. Two orders of operations:

**Keep Prisma Migrate, add zmdb for queries.** Prisma owns `schema.prisma` and the migration history; you write matching zmdb schema objects for the query and validation layers. Low risk, and the drift between the two is your problem — add the [drift test](./schema-first.html), because nothing else will catch a column added in `schema.prisma` and not in your schema object.

**Move migrations to zmdb.** Take a baseline snapshot of the current shape and generate forward from there:

```ts
writeFileSync('migrations/snapshot.json', JSON.stringify(snapshot(allSchemas), null, 2));
```

Commit that with no corresponding migration file — it means "this already exists". Then stop running `prisma migrate` and start running [`runCli`](./cli-up.html). Prisma's `_prisma_migrations` table stays behind harmlessly; zmdb records into its own.

Do not run both migration systems against one database. Each will consider the other's changes to be drift.

## The mapping

The full API table is on [Migrating from Prisma](./migrate-from-prisma.html). The parts specific to hosting:

- **No `prisma generate`.** Nothing is generated into your repository, so there is no client to regenerate after a schema change and no build step to remember.
- **No query engine binary.** Prisma Client ships a native engine; zmdb ships text manipulation. On a serverless platform this removes both the binary from your bundle and its cold start. See [Serverless Performance](./perf-serverless.html).
- **Connection limits are yours to manage.** Prisma Accelerate pooled for you; a raw connection string does not. Keep `max` low per instance and use their pooler if available. See [Postgres](./connect-postgres.html).

## Running both at once

They coexist fine — two clients against one database — which makes an incremental migration practical:

```ts
const user = await prisma.user.findUnique({ where: { id } }); // old path
const posts = await postRepo.find({ authorId: { eq: id } }); // new path
```

What you cannot share is a transaction: `prisma.$transaction` and `createTransactionalDb` hold different connections. Keep any single unit of work entirely on one side.

---

See also: [Migrating from Prisma](./migrate-from-prisma.html) · [Dialect: Postgres](./dialect-postgres.html) · [Schema-first](./schema-first.html)
