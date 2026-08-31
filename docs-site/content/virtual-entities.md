A virtual entity is a read model backed by a query rather than a table. zmdb has no `virtual: true` option — you get one by pairing a view with a schema object, and the composition below is the entire feature.

## The pattern

```ts
import { defineSchema, integer, text, timestamp } from '@zmdb/schema-core';
import { defineRepository } from '@zmdb/repository';
import { createViewDdl } from '@zmdb/query-compiler/schema-objects';

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

// 2. the shape it returns, as a schema object
export const orderSummary = defineSchema('order_summary', {
  id: integer().primaryKey(),
  createdAt: timestamp().notNull(),
  customerName: text().notNull(),
  total: integer().notNull(),
});

// 3. a repository over it
export const orderSummaryRepo = defineRepository(orderSummary, driver, { dialect: 'postgres' });
```

From there it behaves like any other read source — `find`, `findOne`, `list` with `where` / `orderBy` / `page`, `aggregate`, [projections](./projections.html), typed [filters](./filters.html), and an OpenAPI component derived from the same object.

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
import type { Entity } from '@zmdb/schema-core';

async function orderSummaries(minTotal: number) {
  const rows = await driver.execute({
    text: `SELECT o.id, ... HAVING SUM(i.price) >= $1`,
    parameters: [minTotal],
  });
  return rows.map(r => assert<Entity<typeof orderSummary>>(r));
}
```

The `assert` is doing real work here: hand-written SQL is the one place where the column list is not derived from the schema object, so it is the one place where they can disagree. Checking the rows against the schema type turns "the view drifted" from a mystery `undefined` into a validation error naming the column.

## What you do not get

**No `expression` in the schema object.** The SQL lives in the view definition or the raw query, not in `defineSchema`, so `snapshot()` / `diff()` do not track it. A change to the view is a [hand-written migration](./migrations-custom.html).

**Writes are not blocked.** `BaseRepository` has `create` / `update` / `delete` regardless of what the schema object points at. The database rejects them; if you want the error earlier, override them.

**No relations from a virtual entity.** `populate` needs a foreign key on a real column. Put the join in the view instead — which is usually why you reached for a virtual entity.

> [!NOTE]
> MikroORM's virtual entities exist partly to keep read models out of the identity map. zmdb has no identity map, so a read model is just another schema object — there is nothing to opt out of. See [Why fetched rows are inert](./inert-rows.html).

---

See also: [Views](./views.html) · [Materialized Views](./materialized-views.html) · [Projections](./projections.html)
