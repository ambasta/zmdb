zmdb's query builder is **SQL-first**: it maps directly to SQL rather than hiding it behind an object graph. Every builder call is typed against your schema, and `.compile()` returns a parameterized
`{ text, parameters }` — nothing runs until you hand it to a driver.

The examples below assume this schema:

<!-- snippet: select.ts#snippet-1 -->

## Basic select

Select every column from a table:

<!-- snippet: select.ts#snippet-2 -->

```sql
SELECT * FROM "users"
```

Through a repository you usually call `findAll()` / `findById()` instead, which return `Entity<S>` objects.

## Partial select (projection)

Pass the columns you want. Combined with the DTO `project`/`select` helpers this also **narrows the result type** to the chosen columns.

<!-- snippet: select.ts#snippet-3 -->

```sql
SELECT "id", "email" FROM "users"
```

> [!NOTE] zmdb lists columns explicitly rather than emitting `SELECT *` when you project, so the column order in the result is deterministic. See [Projections](./projections.html) for the typed
> `Projection<S, K>` narrowing.

## Filtering

`where(column, operator, value)` adds a predicate; chained `where`/`andWhere` are ANDed and `orWhere` is ORed. Values are always parameterized.

<!-- snippet: select.ts#snippet-4 -->

```sql
SELECT * FROM "users" WHERE "role" = $1 AND "email" LIKE $2
-- parameters: ['admin', '%@corp.com']
```

For a typed, schema-derived filter object (operator sets, AND/OR groups), use [`compileWhere` + WhereDTO](./filters.html).

## Ordering

<!-- snippet: select.ts#snippet-5 -->

```sql
SELECT * FROM "users" ORDER BY "createdAt" DESC, "id" ASC
```

## Limit & offset

<!-- snippet: select.ts#snippet-6 -->

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

<!-- snippet: select.ts#snippet-7 -->

SQL Server pagination uses `OFFSET … ROWS FETCH NEXT … ROWS ONLY` and requires an explicit `.orderBy(...)`; an unordered paginated query is refused.

## Next steps

- [Filters & operators](./filters.html) — the full operator set + typed WhereDTO
- [Joins](./joins.html) and [aggregations](./aggregations.html)
- [Read/Query DTOs](./read-dtos.html) — Get/List/Search result shapes
