Table aliases let you give a table a short name in a query — essential for **self-joins** and for disambiguating columns when the same table appears twice. zmdb's join builder accepts a
`'table as alias'` spec and quotes it per dialect.

> [!NOTE] zmdb's builder keeps column selection close to raw SQL: it emits the columns you name (or `*`). It does **not** rewrite result keys with `AS` column aliases — reshape/rename the returned
> rows with [`aliasRow`](./populate-results.html) or a [projection](./projections.html) instead. Table aliases, below, are fully supported.

## Table aliases in joins

Pass `'table as alias'` to the join builder; both the base table and joined tables can be aliased, and columns are referenced through the alias.

<!-- snippet: aliases.ts#snippet-1 -->

```sql
SELECT * FROM "employees" AS "e"
LEFT JOIN "employees" AS "r" ON "r"."id" = "e"."recipient_id"
WHERE "e"."id" = $1
-- parameters: [1]
```

## Self-joins

The same table joined to itself is the canonical case for aliases — without them the two references would be ambiguous.

<!-- snippet: aliases.ts#snippet-2 -->

```sql
SELECT * FROM "categories" AS "c"
LEFT JOIN "categories" AS "parent" ON "parent"."id" = "c"."parent_id"
```

## Renaming aliased columns in the result

When a join produces columns you want under cleaner keys (e.g. mapping `r_id`/`r_name` to `recipientId`/`recipientName`), use `aliasRow` on the rows — this is the typed, runtime equivalent of a
`SELECT ... AS` rename.

<!-- snippet: aliases.ts#snippet-3 -->

## Dialect quoting

Aliases are quoted with the dialect's identifier quoting — `"…"` on PostgreSQL/SQLite, backticks on MySQL and brackets on SQL Server.

<!-- snippet: aliases.ts#snippet-4 -->

> [!TIP] Prefer table aliases whenever a query touches a table more than once. For single-table reads you rarely need them — see [Select](./select.html).

- [Joins](./joins.html) — inner/left joins that use these aliases
- [Typed populate & join results](./populate-results.html) — `JoinRow` + `aliasRow`
- [Projections](./projections.html) — narrowing/reshaping selected columns
