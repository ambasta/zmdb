Grouped aggregates — `count`, `sum`, `avg`, `min`, `max` with `GROUP BY` and `HAVING` — compiled to real SQL and verified against PostgreSQL in the [benchmarks](../benchmarks/index.html).

## Count

<!-- snippet: aggregations.ts#snippet-1 -->

```sql
SELECT COUNT("id") AS "orderCount" FROM "orders"
```

## Group by + multiple aggregates

<!-- snippet: aggregations.ts#snippet-2 -->

```sql
SELECT "userId", COUNT("id") AS "orderCount", SUM("total") AS "revenue"
FROM "orders" GROUP BY "userId"
```

## Having

Filter on an aggregate with `having`:

<!-- snippet: aggregations.ts#snippet-3 -->

```sql
SELECT "userId", COUNT("id") AS "orderCount" FROM "orders"
GROUP BY "userId" HAVING COUNT("id") > $1
```

> [!TIP] The result row is **typed** from the spec — group-key columns plus one field per computed aggregate, with correct `number` / `number | null` typing. See
> [Typed aggregate results](./aggregate-results.html).
