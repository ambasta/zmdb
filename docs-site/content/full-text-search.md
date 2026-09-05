PostgreSQL full-text search is expressible directly in the query builder, and a typed [SearchDTO](./read-dtos.html) layers ranking + paging on top.

## Match a term

<!-- snippet: full-text-search.ts#snippet-1 -->

```sql
SELECT * FROM "products"
WHERE to_tsvector("description") @@ to_tsquery($1)
```

## Through the repository

<!-- snippet: full-text-search.ts#snippet-2 -->

## Ranked search with SearchDTO

<!-- snippet: full-text-search.ts#snippet-3 -->

> [!IMPORTANT] FTS is dialect-specific. On SQLite (no arbitrary-column FTS without FTS5), `findByFullText` throws an explicit `UnsupportedFeatureError` rather than silently running a wrong query. This
> is one of the routes exercised against real Postgres in the [benchmarks](../benchmarks/index.html).
