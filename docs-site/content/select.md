zmdb's query builder is **SQL-first**: it maps directly to SQL rather than hiding it behind an object graph. Pass a declared schema value, such as `schemaOf<User>()`, to type builder calls against
that schema. The physical-table examples below use the explicit `trustedTable` boundary, whose result is `UnknownRow`. `.compile()` returns a parameterized `{ text, parameters }` — nothing runs until
you hand it to a driver.

The examples below assume this schema:

```ts {"mode":"compile","id":"example-001"}
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: 'admin' | 'user';
  createdAt: Date & Sql<'timestamp'>;
}
```

## Basic select

Select every column from a table:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies qc; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

const q = qc.selectFrom(trustedTable('users')).compile();
// q.text, q.parameters — pass to your driver
```

```sql
SELECT * FROM "users"
```

Through a repository you usually call `findAll()` / `findById()` instead, which return `Entity<S>` objects.

## Partial select (projection)

Pass the columns you want. Combined with the DTO `project`/`select` helpers this also **narrows the result type** to the chosen columns.

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies qc; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

qc.selectFrom(trustedTable('users')).select(['id', 'email']).compile();
```

```sql
SELECT "id", "email" FROM "users"
```

> [!NOTE] zmdb lists columns explicitly rather than emitting `SELECT *` when you project, so the column order in the result is deterministic. See [Projections](./projections.html) for the typed
> `Projection<S, K>` narrowing.

## Filtering

`where(column, operator, value)` adds a predicate; chained `where`/`andWhere` are ANDed and `orWhere` is ORed. Values are always parameterized.

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies qc; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

qc.selectFrom(trustedTable('users')).where('role', '=', 'admin').andWhere('email', 'like', '%@corp.com').compile();
```

```sql
SELECT * FROM "users" WHERE "role" = $1 AND "email" LIKE $2
-- parameters: ['admin', '%@corp.com']
```

For a typed, schema-derived filter object (operator sets, AND/OR groups), use [`compileWhere` + WhereDTO](./filters.html).

## Ordering

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies qc; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

qc.selectFrom(trustedTable('users')).orderBy('createdAt', 'desc').orderBy('id', 'asc').compile();
```

```sql
SELECT * FROM "users" ORDER BY "createdAt" DESC, "id" ASC
```

## Limit & offset

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies qc; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

qc.selectFrom(trustedTable('users')).orderBy('id', 'asc').limit(20).offset(40).compile();
```

```sql
SELECT * FROM "users" ORDER BY "id" ASC LIMIT 20 OFFSET 40
```

See [Ordering & pagination](./pagination.html) for typed `OrderByDTO` / `PaginationDTO` and keyset (cursor) pagination.

## Dialect differences

The same builder emits dialect-correct SQL. Identifiers and placeholders differ:

| dialect  | quoting         | placeholder   |
| -------- | --------------- | ------------- |
| postgres | `"col"`         | `$1, $2, …`   |
| mysql    | backtick-quoted | `?`           |
| sqlite   | `"col"`         | `?`           |
| mssql    | `[col]`         | `@p1, @p2, …` |

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies createQueryCompiler; this excerpt does not repeat those declarations."}
import { trustedTable } from '@zmdb/sql';

import { mysql } from '@zmdb/mysql';

createQueryCompiler(mysql).selectFrom(trustedTable('users')).where('id', '=', 1).compile();
// text: SELECT * FROM `users` WHERE `id` = ?   parameters: [1]
```

SQL Server pagination uses `OFFSET … ROWS FETCH NEXT … ROWS ONLY` and requires an explicit `.orderBy(...)`; an unordered paginated query is refused.

## Next steps

- [Filters & operators](./filters.html) — the full operator set + typed WhereDTO
- [Joins](./joins.html) and [aggregations](./aggregations.html)
- [Read/Query DTOs](./read-dtos.html) — Get/List/Search result shapes
