Read Data Transfer Objects provide typed query inputs and result shapes for fetching data. zmdb derives all read types from your schema — any change to the schema automatically updates the DTOs,
eliminating drift between your API contracts and database queries.

## WhereDTO — Typed Filters

Filter rows with column-level operators. Types are inferred from your schema.

<!-- snippet: read-dtos.ts#snippet-1 -->

**SQL emitted:**

```sql
SELECT * FROM "users" WHERE
  "role" = $1 AND "age" >= $2 AND "age" < $3
  AND "email" LIKE $4 AND "status" IN ($5, $6)
  AND "deletedAt" IS NULL
```

## OrderByDTO — Typed Sorting

Specify columns and direction with compile-time type checking.

<!-- snippet: read-dtos.ts#snippet-2 -->

**SQL emitted:** `ORDER BY "createdAt" DESC, "id" ASC`

## PaginationDTO — Cursor and Offset

Both offset and cursor-based pagination are supported.

<!-- snippet: read-dtos.ts#snippet-3 -->

## GetDTO — Single Row Fetch

Narrow results to specific columns with optional population.

<!-- snippet: read-dtos.ts#snippet-4 -->

## ListDTO + ListResult — Paginated Lists

Full-featured list queries with filtering, sorting, pagination.

<!-- snippet: read-dtos.ts#snippet-5 -->

> [!IMPORTANT] `total` is only present when you explicitly request it. `hasMore` is computed from limit+1 fetch.

## SearchDTO — Full-Text Search

Full-text search with ranking scores.

<!-- snippet: read-dtos.ts#snippet-6 -->

## Projection Helper

Use `project()` to narrow row types at runtime.

<!-- snippet: read-dtos.ts#snippet-7 -->

## Cross-links

- [Projections](./projections.html) — column narrowing
- [Pagination](./pagination.html) — detailed pagination
- [Repository](./repository.html) — CRUD with DTOs
