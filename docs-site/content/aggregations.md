Grouped aggregates — `count`, `sum`, `avg`, `min`, `max` with `GROUP BY` and
`HAVING` — compiled to real SQL and verified against PostgreSQL in the
[benchmarks](../benchmarks/index.html).

## Count

```ts
import { aggregateSelectFrom } from '@zmdb/query-compiler/aggregations';

aggregateSelectFrom('orders', 'postgres').count('id', 'orderCount').compile();
```

```sql
SELECT COUNT("id") AS "orderCount" FROM "orders"
```

## Group by + multiple aggregates

```ts
aggregateSelectFrom('orders', 'postgres')
  .select(['userId'])
  .count('id', 'orderCount')
  .sum('total', 'revenue')
  .groupBy(['userId'])
  .compile();
```

```sql
SELECT "userId", COUNT("id") AS "orderCount", SUM("total") AS "revenue"
FROM "orders" GROUP BY "userId"
```

## Having

Filter on an aggregate with `having`:

```ts
aggregateSelectFrom('orders', 'postgres')
  .select(['userId'])
  .count('id', 'orderCount')
  .groupBy(['userId'])
  .having('orderCount', '>', 5)
  .compile();
```

```sql
SELECT "userId", COUNT("id") AS "orderCount" FROM "orders"
GROUP BY "userId" HAVING COUNT("id") > $1
```

> [!TIP]
> The result row is **typed** from the spec — group-key columns plus one field
> per computed aggregate, with correct `number` / `number | null` typing. See
> [Typed aggregate results](./aggregate-results.html).
