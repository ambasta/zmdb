Aggregations compute summary statistics over grouped rows — counts, sums, averages, min/max values. zmdb provides a typed aggregate API that returns compile-time typed results based on your
aggregation specification.

## Defining an Aggregate

Use `AggregateSpec<S>` to declare what you want to compute:

<!-- snippet: aggregate-results.ts#snippet-1 -->

## Running the Aggregate

Pass a builder function to `aggregate()` — you compose exactly what you need.

<!-- snippet: aggregate-results.ts#snippet-2 -->

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

<!-- snippet: aggregate-results.ts#snippet-3 -->

> [!IMPORTANT] `sum` and `avg` return `number | null` (NULL if no rows in group). `min` and `max` return the column's type or `null`. `count` always returns `number`.

## Without Grouping

Aggregate over the entire table by omitting `groupBy`:

<!-- snippet: aggregate-results.ts#snippet-4 -->

**SQL emitted:**

```sql
SELECT COUNT(*) AS "totalOrders", SUM("totalPrice") AS "revenue" FROM "orders"
```

## Combining with Where

Filter rows before aggregating by passing a pre-filtered query builder:

<!-- snippet: aggregate-results.ts#snippet-5 -->

> [!TIP] Push filters before aggregation for performance — the database evaluates the WHERE clause before the GROUP BY.

## Cross-links

- [Read DTOs](./read-dtos.html) — full DTO family
- [Repository](./repository.html) — CRUD API
- [Query Compiler](./select.html) — aggregation builder
