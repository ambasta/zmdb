Projections let you narrow the result set to specific columns, reducing payload size and improving query performance. zmdb provides compile-time type narrowing and a runtime helper for applying
projections to fetched rows.

## Narrowing Select Results

The repository's read methods accept a `select` option that narrows the returned row type. This is type-safe — only valid column keys from the schema are allowed.

<!-- snippet: projections.ts#snippet-1 -->

## Runtime Projection Helper

The `project()` function applies a column selection to a fetched row, returning a new object with only the specified keys.

<!-- snippet: projections.ts#snippet-2 -->

## SQL Emitted

When you specify `select` in a repository call, the compiler emits only those columns in the SELECT clause.

<!-- snippet: projections.ts#snippet-3 -->

> [!IMPORTANT] Projections are compile-time checked against the schema. If you reference a column that doesn't exist, TypeScript will error before your code runs.

## Use Cases

- API responses that expose only public-safe fields
- Dashboard queries fetching only display columns
- Reducing memory footprint for large result sets

<!-- snippet: projections.ts#snippet-4 -->

> [!TIP] Combine projections with pagination to minimize data transfer. Fetch only what you display.

## Cross-links

- [Read DTOs](./read-dtos.html) — full GetDTO/ListDTO/SearchDTO documentation
- [Aliases](./aliases.html) — column renaming with AS
- [Repository](./repository.html) — CRUD with projection support
