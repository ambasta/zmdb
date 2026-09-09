Table aliases let you give a table a short name in a query — essential for **self-joins** and for disambiguating columns when the same table appears twice. Pass the alias separately to
`selectFrom(schema, alias)` or `leftJoin(schema, alias, conditions)`; the compiler quotes it per dialect.

> [!NOTE] Select an explicit output name with `{ column: 'r.id', alias: 'recipientId' }`. A qualified selection such as `'r.id'` retains that qualified result key through SQL `AS`.
> [`aliasRow`](./populate-results.html) can also rename fields after the rows return.

## Table aliases in joins

Both the base table and joined tables can be aliased, and columns are referenced through the alias. These physical-table examples use `trustedTable`; pass declared schema values for typed columns and
results.

```ts {"mode":"compile","id":"example-001"}
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
-- parameters: [1]
```

## Self-joins

The same table joined to itself is the canonical case for aliases — without them the two references would be ambiguous.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies joinableSelectFrom; this excerpt does not repeat those declarations."}
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler, trustedTable } from '@zmdb/sql';

createQueryCompiler(postgres)
  .selectFrom(trustedTable('categories'), 'c')
  .leftJoin(trustedTable('categories'), 'parent', [{ leftCol: 'parent.id', rightCol: 'c.parent_id' }])
  .compile();
```

```sql
SELECT * FROM "categories" AS "c"
LEFT JOIN "categories" AS "parent" ON "parent"."id" = "c"."parent_id"
```

## Renaming aliased columns in the result

When a join produces columns you want under cleaner keys (e.g. mapping `r_id`/`r_name` to `recipientId`/`recipientName`), use `aliasRow` on the rows — this is the typed, runtime equivalent of a
`SELECT ... AS` rename.

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies Employee, Recipient, row; this excerpt does not repeat those declarations."}
import { aliasRow, type JoinRow } from '@zmdb/orm/relations';

type Row = JoinRow<Employee, Recipient, 'left'>; // Employee & Partial<Recipient>
const clean = aliasRow(row, { r_id: 'recipientId', r_name: 'recipientName' });
```

## Dialect quoting

Aliases are quoted with the dialect's identifier quoting — `"…"` on PostgreSQL/SQLite, backticks on MySQL and brackets on SQL Server.

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies joinableSelectFrom; this excerpt does not repeat those declarations."}
import { mysql } from '@zmdb/mysql';
import { createQueryCompiler, trustedTable } from '@zmdb/sql';

createQueryCompiler(mysql).selectFrom(trustedTable('users'), 'u').compile();
// SELECT * FROM `users` AS `u`
```

> [!TIP] Prefer table aliases whenever a query touches a table more than once. For single-table reads you rarely need them — see [Select](./select.html).

- [Joins](./joins.html) — inner/left joins that use these aliases
- [Typed populate & join results](./populate-results.html) — `JoinRow` + `aliasRow`
- [Projections](./projections.html) — narrowing/reshaping selected columns
