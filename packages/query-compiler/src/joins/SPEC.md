# Query Builder JOINs — Frozen Spec (Issue #84)

> Status: **FROZEN** for TDD. Implementation (#85–#88) must satisfy this spec.
> Part of `@zmdb/query-compiler`. Targets: Node 26+, ESM, TS 7.
> Motivation: zmdb DNFs the join routes of drizzle-benchmarks. This freezes the
> join builder grammar + golden SQL.

## 1. Grammar

```ts
qb.selectFrom(table)
  .innerJoin(target, leftCol, rightCol, onPredicates?)
  .leftJoin(target, leftCol, rightCol, onPredicates?)
  .rightJoin(target, leftCol, rightCol, onPredicates?)
  .where(...) .orderBy(...) .limit(...) .offset(...)
  .compile()
```

- `leftCol`/`rightCol` are qualified `table.column` or `alias.column` strings.
- `onPredicates`, when present, are structured predicates appended inside that
  join's `ON`; their parameters share the statement's placeholder sequence.
- Joins compose with existing where/order/limit/offset.
- Aliasing: `selectFrom('employees as e')` and `innerJoin('employees as r', ...)`.
- Builders remain immutable; compilation is pure string building (no runtime
  type resolution), parameterized, dialect-aware.

## 2. Golden SQL (postgres)

```
selectFrom('products')
  .leftJoin('suppliers', 'suppliers.id', 'products.supplier_id')
  .where('products.id','=',7)
=> SELECT * FROM "products"
   LEFT JOIN "suppliers" ON "suppliers"."id" = "products"."supplier_id"
   WHERE "products"."id" = $1
   params: [7]

selectFrom('employees as e')
  .leftJoin('employees as r', 'r.id', 'e.recipient_id')
  .where('e.id','=',5)
=> SELECT * FROM "employees" AS "e"
   LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"
   WHERE "e"."id" = $1
   params: [5]

selectFrom('a').innerJoin('b','b.a_id','a.id')
=> SELECT * FROM "a" INNER JOIN "b" ON "b"."a_id" = "a"."id"
```

## 3. Identifier quoting rule

A qualified reference `x.y` quotes each part: `"x"."y"`. An aliased table
`t as al` compiles to `"t" AS "al"`. Dialect: pg/sqlite double quotes, mysql
backticks (same as existing dialect strategy).

## 4. Non-goals (rejected)

- No lazy proxy relations. No identity-map dedup. Joins are explicit compiled SQL.
