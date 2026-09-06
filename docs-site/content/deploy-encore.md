Encore is infrastructure-from-code: you declare services and resources in TypeScript, and Encore provisions the database, the topics and the deployment. That overlaps with zmdb in one place and
complements it everywhere else.

## What overlaps and what does not

|                                    | Encore                                | zmdb                                 |
| ---------------------------------- | ------------------------------------- | ------------------------------------ |
| Provisioning the database          | yes                                   | no                                   |
| Service definitions, API endpoints | yes                                   | `@zmdb/web`                          |
| Request validation                 | from the endpoint's types             | AOT validators                       |
| Migrations                         | its own runner, `migrations/*.up.sql` | [its own runner](./cli-migrate.html) |
| Schema declaration                 | plain SQL                             | a tagged `interface`                 |
| Typed queries                      | tagged templates                      | query compiler + repository          |
| Tracing, dashboards                | built in                              | none                                 |

So the sensible arrangement is: **Encore owns infrastructure, endpoints and migrations; zmdb owns the schema, the queries and the row types.** Do not run two migration systems against one database,
and do not wrap Encore's endpoints in `@zmdb/web` — you would lose the tracing and typed clients that are the reason to use Encore.

## A driver over Encore's database

```ts
import { SQLDatabase } from 'encore.dev/storage/sqldb';
import type { Driver } from '@zmdb/repository';

const db = new SQLDatabase('app', { migrations: './migrations' });

export const driver: Driver = {
  async execute(query) {
    const rows: Record<string, unknown>[] = [];
    for await (const row of db.rawQuery(query.text, ...query.parameters)) rows.push(row);
    return rows;
  },
};
```

`rawQuery` is variadic rather than array-taking, hence the spread. `CompiledQuery.parameters` is a `readonly unknown[]`, which spreads fine.

Everything downstream now works: `defineRepository`, `Entity<S>`, `CreateDTO<S>`, `populate`, `aggregate`.

## Migrations: use Encore's

Encore provisions the database and expects to own its schema, and it applies `migrations/1_x.up.sql` on deploy. Generate the SQL from your schemas and commit it:

```ts
// scripts/emit-migration.ts
import { diff, emitUp, snapshot } from 'zmdb/migrations';
import { writeFileSync } from 'node:fs';
import { allSchemas } from '../src/schema.js';

const ops = diff(previousSnapshot, snapshot(allSchemas));
writeFileSync('migrations/2_add_posts.up.sql', ops.map(o => emitUp(o, 'postgres')).join(';\n') + ';\n');
```

You keep the declaration as the source of truth and Encore keeps its own runner. Review the emitted SQL before committing — the generated form is correct but not always what you would write by hand,
and Encore's migrations are irreversible in production.

Do **not** also call `runCli('up', ...)`. Two runners with two version tables against one database is a schema you cannot reason about.

## Validation

Encore derives validation from an endpoint's request type, which covers the boundary. So the AOT validators are largely redundant here — and Encore compiles with its own toolchain, so the transformer
does not run:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false); // expect this to fail under Encore
});
```

Rely on Encore's endpoint validation, and use zmdb's `assert` only in modules you compile yourself. Do not assume `assert` is checking anything inside an Encore service. See
[AOT Setup](./aot-setup.html).

## Transactions

```ts
await using tx = await db.begin();
```

Encore's transaction handle is its own. Since zmdb's `withTransaction` needs a driver bound to the transaction, build one per transaction:

```ts
function txDriver(tx: Transaction): Driver {
  return {
    async execute(query) {
      const rows: Record<string, unknown>[] = [];
      for await (const row of tx.rawQuery(query.text, ...query.parameters)) rows.push(row);
      return rows;
    },
  };
}

const repo = defineRepository(posts, txDriver(tx));
```

The repository is an object over a driver, so constructing one per transaction costs nothing. This is the general pattern for any framework that owns its own transaction handle. See
[Transactions](./transactions.html).

## Where the fit is genuinely poor

- **`@zmdb/web`.** Encore's endpoints give you tracing, typed clients and generated API docs. Replacing them with controllers throws that away for no gain.
- **The OpenAPI generator.** Encore generates its own API documentation and clients.
- **The AOT validators.** No transformer, as above.

What is left is the part worth having: one typed schema definition, derived DTOs, a query compiler that produces plain SQL, and a repository that does not need an engine. Encore provides the rest.

---

See also: [Writing a Driver](./custom-driver.html) · [Transactions](./transactions.html) · [Deployment](./deployment.html)
