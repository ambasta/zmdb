zmdb's query builder is **SQL-first**: it maps directly to SQL rather than hiding
it behind an object graph. Every builder call is typed against your schema, and
`.compile()` returns a parameterized `{ text, parameters }` — nothing runs until
you hand it to a driver.

The examples below assume this schema:

```ts
export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull(),
  createdAt: timestamp().notNull(),
});
```

## Basic select

Select every column from a table:

```ts
const q = qc.selectFrom('users').compile();
// q.text, q.parameters — pass to your driver
```

```sql
SELECT * FROM "users"
```

Through a repository you usually call `findAll()` / `findById()` instead, which
return `Entity<S>` objects.

## Partial select (projection)

Pass the columns you want. Combined with the DTO `project`/`select` helpers this
also **narrows the result type** to the chosen columns.

```ts
qc.selectFrom('users').select(['id', 'email']).compile();
```

```sql
SELECT "id", "email" FROM "users"
```

> [!NOTE]
> zmdb lists columns explicitly rather than emitting `SELECT *` when you project,
> so the column order in the result is deterministic. See [Projections](./projections.html)
> for the typed `Projection<S, K>` narrowing.

## Filtering

`where(column, operator, value)` adds a predicate; chained `where`/`andWhere` are
ANDed and `orWhere` is ORed. Values are always parameterized.

```ts
qc.selectFrom('users').where('role', '=', 'admin').andWhere('email', 'like', '%@corp.com').compile();
```

```sql
SELECT * FROM "users" WHERE "role" = $1 AND "email" LIKE $2
-- parameters: ['admin', '%@corp.com']
```

For a typed, schema-derived filter object (operator sets, AND/OR groups), use
[`compileWhere` + WhereDTO](./filters.html).

## Ordering

```ts
qc.selectFrom('users').orderBy('createdAt', 'desc').orderBy('id', 'asc').compile();
```

```sql
SELECT * FROM "users" ORDER BY "createdAt" DESC, "id" ASC
```

## Limit & offset

```ts
qc.selectFrom('users').orderBy('id', 'asc').limit(20).offset(40).compile();
```

```sql
SELECT * FROM "users" ORDER BY "id" ASC LIMIT 20 OFFSET 40
```

See [Ordering & pagination](./pagination.html) for typed `OrderByDTO` /
`PaginationDTO` and keyset (cursor) pagination.

## Dialect differences

The same builder emits dialect-correct SQL. Identifiers and placeholders differ:

| dialect  | quoting         | placeholder |
| -------- | --------------- | ----------- |
| postgres | `"col"`         | `$1, $2, …` |
| mysql    | backtick-quoted | `?`         |
| sqlite   | `"col"`         | `?`         |

```ts
createQueryCompiler('mysql').selectFrom('users').where('id', '=', 1).compile();
// text: SELECT * FROM `users` WHERE `id` = ?   parameters: [1]
```

## Next steps

- [Filters & operators](./filters.html) — the full operator set + typed WhereDTO
- [Joins](./joins.html) and [aggregations](./aggregations.html)
- [Read/Query DTOs](./read-dtos.html) — Get/List/Search result shapes
