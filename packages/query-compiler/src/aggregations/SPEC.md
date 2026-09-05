# Query Builder Aggregations — Frozen Spec (Issue #89)

> Status: **FROZEN** for TDD. Implementation (#90–#93) must satisfy this spec. Part of `@zmdb/query-compiler`. Targets: Node 26+, ESM, TS 7. Motivation: zmdb DNFs the aggregate routes of
> drizzle-benchmarks. This freezes the aggregate / GROUP BY / computed-column grammar.

## 1. Grammar

```ts
qb.selectFrom(table)
  .select(['col', ...])                    // plain columns
  .count(expr, alias)                       // COUNT(expr) AS alias
  .sum(expr, alias) .avg(...) .min(...) .max(...)
  .expr(rawExpr, alias)                     // arbitrary computed expr AS alias
  .groupBy(col, ...)
  .having(col, op, value)
  .orderBy(...) .limit(...) .offset(...)
  .compile()
```

Composes with the JOIN builder (#84). Immutable, pure string compilation, parameterized, dialect-aware.

## 2. Golden SQL (postgres)

```
selectFrom('orders')
  .select(['orders.id'])
  .count('order_details.product_id', 'products_count')
  .groupBy('orders.id')
  .orderBy('orders.id','asc')
  .limit(50).offset(0)
=> SELECT "orders"."id", COUNT("order_details"."product_id") AS "products_count"
   FROM "orders" GROUP BY "orders"."id" ORDER BY "orders"."id" ASC LIMIT 50 OFFSET 0

selectFrom('order_details')
  .sum('quantity', 'qty')
  .having('quantity', '>', 0)
  .groupBy('order_id')
=> SELECT SUM("quantity") AS "qty" FROM "order_details"
   GROUP BY "order_id" HAVING "quantity" > $1
   params: [0]
```

Aggregate functions emit `FN("qualified"."col") AS "alias"`. `expr(raw, alias)` emits `raw AS "alias"` (raw is caller-provided, not quoted — the escape hatch for `sum(qty*price)::real`).

## 3. Result typing

Computed columns are typed via the alias: `count→number`, `sum/avg→number`, `min/max→same as column`, `expr→unknown` (caller annotates).

## 4. Non-goals (rejected)

- No window functions in this epic (future). No implicit GROUP BY inference.
