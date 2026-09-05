Aggregations compute summary statistics over grouped rows — counts, sums, averages, min/max values. zmdb provides a typed aggregate API that returns compile-time typed results based on your
aggregation specification.

## Defining an Aggregate

Use `AggregateSpec<S>` to declare what you want to compute:

```ts
import { aggregateSelectFrom } from '@zmdb/query-compiler/aggregations';
import type { AggregateResult, AggregateSpec } from '@zmdb/schema-core/dto';

const spec: AggregateSpec<Order> = {
  groupBy: ['status'],
  computed: {
    orderCount: { fn: 'count' },
    totalRevenue: { fn: 'sum', column: 'totalPrice' },
    avgPrice: { fn: 'avg', column: 'totalPrice' },
    minOrder: { fn: 'min', column: 'totalPrice' },
    maxOrder: { fn: 'max', column: 'totalPrice' },
  },
};
```

## Running the Aggregate

Pass a builder function to `aggregate()` — you compose exactly what you need.

```ts
const results = await ordersRepo.aggregate(spec, agg =>
  agg.groupBy('status').count('orderCount').sum('totalRevenue', 'totalPrice').avg('avgPrice', 'totalPrice').min('minOrder', 'totalPrice').max('maxOrder', 'totalPrice').compile(),
);
```

**SQL emitted:**

```sql
SELECT "status",
       COUNT(*) AS "orderCount",
       SUM("totalPrice") AS "totalRevenue",
       AVG("totalPrice") AS "avgPrice",
       MIN("totalPrice") AS "minOrder",
       MAX("totalPrice") AS "maxOrder"
FROM "orders"
GROUP BY "status"
```

## Typed Result

The result type is inferred from the spec:

```ts
type OrderAgg = AggregateResult<Order, typeof spec>;
// {
//   status: 'pending' | 'shipped' | 'delivered';
//   orderCount: number;
//   totalRevenue: number | null;
//   avgPrice: number | null;
//   minOrder: number | null;
//   maxOrder: number | null;
// }
```

> [!IMPORTANT] `sum` and `avg` return `number | null` (NULL if no rows in group). `min` and `max` return the column's type or `null`. `count` always returns `number`.

## Without Grouping

Aggregate over the entire table by omitting `groupBy`:

```ts
const totals = await ordersRepo.aggregate(
  {
    computed: {
      totalOrders: { fn: 'count' },
      revenue: { fn: 'sum', column: 'totalPrice' },
    },
  },
  agg => agg.count('totalOrders').sum('revenue', 'totalPrice').compile(),
);

// totals[0]: { totalOrders: number, revenue: number | null }
```

**SQL emitted:**

```sql
SELECT COUNT(*) AS "totalOrders", SUM("totalPrice") AS "revenue" FROM "orders"
```

## Combining with Where

Filter rows before aggregating by passing a pre-filtered query builder:

```ts
const recentStats = await ordersRepo.aggregate(
  {
    computed: { count: { fn: 'count' } },
  },
  agg => {
    // Filter first
    const q = qb.selectFrom('orders').where('createdAt', '>', '2024-01-01');
    // Then aggregate
    return agg.count('count').compile();
  },
);
```

> [!TIP] Push filters before aggregation for performance — the database evaluates the WHERE clause before the GROUP BY.

## Cross-links

- [Read DTOs](./read-dtos.html) — full DTO family
- [Repository](./repository.html) — CRUD API
- [Query Compiler](./select.html) — aggregation builder
