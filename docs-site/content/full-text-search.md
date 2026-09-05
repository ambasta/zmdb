PostgreSQL full-text search is expressible directly in the query builder, and a typed [SearchDTO](./read-dtos.html) layers ranking + paging on top.

## Match a term

```ts
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';

ftsSelectFrom('products', 'postgres').whereMatch('description', 'wireless headphones').compile();
```

```sql
SELECT * FROM "products"
WHERE to_tsvector("description") @@ to_tsquery($1)
```

## Through the repository

```ts
await products.findByFullText('description', 'wireless headphones');
```

## Ranked search with SearchDTO

```ts
import { buildSearchResult, type SearchDTO } from '@zmdb/schema-core/dto';

const search: SearchDTO<Product> = {
  query: 'wireless',
  columns: ['description'],
  rank: true,
};
const result = buildSearchResult(hits, { limit: 20 }); // items carry an optional _score
```

> [!IMPORTANT] FTS is dialect-specific. On SQLite (no arbitrary-column FTS without FTS5), `findByFullText` throws an explicit `UnsupportedFeatureError` rather than silently running a wrong query. This
> is one of the routes exercised against real Postgres in the [benchmarks](../benchmarks/index.html).
