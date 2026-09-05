A virtual entity is a read model backed by a query rather than a table. zmdb has no `virtual: true` option — you get one by pairing a view with a declaration, and the composition below is the entire
feature.

## The pattern

```ts
import { defineRepository } from '@zmdb/repository';
import { createViewDdl } from '@zmdb/query-compiler/schema-objects';
import { schemaOf } from 'zmdb';
import type { PrimaryKey, Sql, Table } from 'zmdb/tags';

// 1. the query, as a view
const ddl = createViewDdl(
  {
    name: 'order_summary',
    select: `
    SELECT o.id, o.created_at, c.name AS customer_name, SUM(i.price) AS total
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_items i ON i.order_id = o.id
    GROUP BY o.id, o.created_at, c.name
  `,
  },
  'postgres',
);

// 2. the shape it returns, as a declared type
export interface OrderSummary extends Table<'order_summary'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'>;
  customerName: string & Sql<'text'>;
  total: number & Sql<'integer'>;
}

// 3. a repository over it
export const orderSummaryRepo = defineRepository(schemaOf<OrderSummary>(), driver, { dialect: 'postgres' });
```

Note the `PrimaryKey` on `id`: a view has no key, but every declaration needs one, because `findById` builds its `WHERE` out of it and an empty key compiles to a statement with no conditions. Pick the
column that is unique in the result and treat it as one.

From there it behaves like any other read source — `find`, `findOne`, `list` with `where` / `orderBy` / `page`, `aggregate`, [projections](./projections.html), typed [filters](./filters.html), and an
OpenAPI component derived from the same declaration.

```ts
const page = await repo.list({
  where: { total: { gte: 10_000 } },
  orderBy: [{ column: 'createdAt', dir: 'desc' }],
  page: { limit: 25 },
});
```

## Without a view

If you cannot create a view — a read replica you do not own DDL on, a query that takes parameters — compile the SQL directly and validate the rows:

```ts
import { assert } from '@zmdb/aot-validator/utilities';
import type { Entity } from 'zmdb/derive';

async function orderSummaries(minTotal: number) {
  const rows = await driver.execute({
    text: `SELECT o.id, ... HAVING SUM(i.price) >= $1`,
    parameters: [minTotal],
  });
  return rows.map(r => assert<Entity<OrderSummary>>(r));
}
```

The `assert` is doing real work here: hand-written SQL is the one place where the column list is not derived from the declaration, so it is the one place where they can disagree. Checking the rows
against `Entity<OrderSummary>` turns "the view drifted" from a mystery `undefined` into a validation error naming the column.

## What you do not get

**No `expression` in the declaration.** The SQL lives in the view definition or the raw query, and a type cannot hold a query, so `snapshot()` / `diff()` do not track it. A change to the view is a
[hand-written migration](./migrations-custom.html).

**Writes are not blocked.** `BaseRepository` has `create` / `update` / `delete` regardless of what the declaration points at. The database rejects them; if you want the error earlier, override them.

**No relations from a virtual entity.** `populate` needs a foreign key on a real column. Put the join in the view instead — which is usually why you reached for a virtual entity.

> [!NOTE] MikroORM's virtual entities exist partly to keep read models out of the identity map. zmdb has no identity map, so a read model is just another declared type — there is nothing to opt out
> of. See [Why fetched rows are inert](./inert-rows.html).

---

See also: [Views](./views.html) · [Materialized Views](./materialized-views.html) · [Projections](./projections.html)
