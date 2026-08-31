Real SQL joins across tables, compiled to parameterized, dialect-correct SQL and
typed against the participating schemas. Joins also power the to-one relation
[populate](./relations.html) strategy.

The examples use `orders(id, userId, status)` joined to `users(id, email)`.

## Inner join

```ts
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';

joinableSelectFrom('orders', 'postgres')
  .innerJoin('users', 'orders.userId', 'users.id')
  .where('orders.status', '=', 'shipped')
  .compile();
```

```sql
SELECT * FROM "orders"
INNER JOIN "users" ON "orders"."userId" = "users"."id"
WHERE "orders"."status" = $1
```

## Left join

A left join keeps base rows even when there is no match — the joined columns may
be null (reflected by `JoinRow<Base, Joined, 'left'>`).

```ts
joinableSelectFrom('employees as e', 'postgres')
  .leftJoin('employees as r', 'r.id', 'e.recipient_id')
  .where('e.id', '=', 1)
  .compile();
```

```sql
SELECT * FROM "employees" AS "e"
LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"
WHERE "e"."id" = $1
```

## Self-join & aliases

As above, table aliases (`table as alias`) let a table join itself. Use
[`aliasRow`](./populate-results.html) to rename the aliased columns into a clean
typed shape.

## Through the repository

```ts
await orders.findJoined(
  { target: 'users', leftCol: 'orders.userId', rightCol: 'users.id', kind: 'inner' },
  { col: 'orders.status', op: '=', value: 'shipped' },
);
```

> [!TIP]
> Joined rows come back as **flat plain objects** (no nested proxies). For typed
> nested relation shapes use [populate](./relations.html); for a typed flat join
> row use [`JoinRow`](./populate-results.html).

This is one of the routes exercised in the drizzle-benchmarks harness against
real PostgreSQL — see the [benchmarks](../benchmarks/index.html).
