Real SQL joins across tables, compiled to parameterized, dialect-correct SQL and typed against the participating schemas. Joins also power the to-one relation [populate](./relations.html) strategy.

The examples use `orders(id, userId, status)` joined to `users(id, email)` through the explicit `trustedTable` boundary. Pass declared schema values to the same methods for typed columns and results.

## Inner join

```ts {"mode":"compile","id":"example-001"}
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler, trustedTable } from '@zmdb/sql';

createQueryCompiler(postgres)
  .selectFrom(trustedTable('orders'))
  .innerJoin(trustedTable('users'), 'users', [{ leftCol: 'orders.userId', rightCol: 'users.id' }])
  .where('orders.status', '=', 'shipped')
  .compile();
```

```sql
SELECT * FROM "orders"
INNER JOIN "users" ON "orders"."userId" = "users"."id"
WHERE "orders"."status" = $1
```

## Left join

A left join keeps base rows even when there is no match. With declared schemas, the inferred types of joined columns include `null`.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies joinableSelectFrom; this excerpt does not repeat those declarations."}
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler, trustedTable } from '@zmdb/sql';

createQueryCompiler(postgres)
  .selectFrom(trustedTable('employees'), 'e')
  .leftJoin(trustedTable('employees'), 'r', [{ leftCol: 'r.id', rightCol: 'e.recipient_id' }])
  .where('e.id', '=', 1)
  .compile();
```

```sql
SELECT * FROM "employees" AS "e"
LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"
WHERE "e"."id" = $1
```

## Self-join & aliases

As above, the separate alias arguments let a table join itself. Use explicit selection aliases or [`aliasRow`](./populate-results.html) to rename the aliased columns into a clean typed shape.

## Through the repository

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies orders; this excerpt does not repeat those declarations."}
await orders.findJoined({ target: 'users', leftCol: 'orders.userId', rightCol: 'users.id', kind: 'inner' }, { col: 'orders.status', op: '=', value: 'shipped' });
```

> [!TIP] Joined rows come back as **flat plain objects** (no nested proxies). For typed nested relation shapes use [populate](./relations.html); for a typed flat join row use
> [`JoinRow`](./populate-results.html).

This is one of the routes exercised in the drizzle-benchmarks harness against real PostgreSQL — see the [benchmarks](../benchmarks/index.html).
