> **ToDo / partial feature gap.** A `vector(n)` column, ordered extension
> installation, and HNSW/IVFFlat index DDL are supported. Typed distance
> projection and ordering are not yet available, so similarity queries still use
> raw SQL.

## Declare the column

```ts
import type { Ext, PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface Embedding extends Table<'embeddings'> {
  id: number & Sql<'integer'> & PrimaryKey;
  documentId: number & Sql<'integer'>;
  chunk: string & Sql<'text'>;
  embedding: readonly number[] & Ext<'vector', 'vector', [1536]>;
}
```

The migration snapshot records `vector` once and emits:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE TABLE "embeddings" (
  "chunk" TEXT NOT NULL,
  "documentId" INTEGER NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "id" INTEGER PRIMARY KEY
);
```

The derived JSON Schema describes the embedding as a numeric array with `minItems` and `maxItems` both set to `1536`. Database reads accept either a driver-parsed array or pgvector's text form without partially parsing malformed values.

## Create the index

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const indexSql = createIndexDdl(
  {
    name: 'embeddings_hnsw',
    table: 'embeddings',
    method: 'hnsw',
    columns: [{ column: 'embedding', opclass: 'vector_cosine_ops' }],
    with: { m: 16, ef_construction: 64 },
  },
  'postgres',
);
```

The result is:

```sql
CREATE INDEX "embeddings_hnsw" ON "embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
```

Use `ivfflat` with `{ lists: N }`, or `hnsw` with `m` and `ef_construction`. An option belonging to another method is refused before migration execution. The operator class must match the query operator — `vector_cosine_ops` for `<=>`, `vector_l2_ops` for `<->`.

## Insert and search

Writes still need the pgvector text encoding at the driver boundary:

```ts
await driver.execute({
  text: 'INSERT INTO embeddings ("documentId", chunk, embedding) VALUES ($1, $2, $3)',
  parameters: [docId, chunk, JSON.stringify(vector)],
});
```

`pgvector` accepts the `[0.1,0.2,...]` form that `JSON.stringify(number[])` produces.

The typed query builder does not yet project or order by a distance expression, so search remains raw SQL:

```ts
const rows = await driver.execute({
  text: `SELECT id, chunk, 1 - (embedding <=> $1::vector) AS similarity
         FROM embeddings
         WHERE "documentId" = ANY($2)
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
  parameters: [JSON.stringify(queryVector), allowedDocIds, 10],
});
```

Two details are easy to get wrong:

- **Order by the raw distance expression.** Ordering by the projected `similarity` alias prevents the approximate index from serving the order.
- **`<=>` is cosine distance.** Smaller is closer; `1 - distance` is similarity. Sort the distance ascending.

## Filtering and recall

A `WHERE` alongside an approximate index reduces recall: HNSW walks the graph and then your filter discards candidates, so a narrow filter can return fewer rows than `LIMIT`.

- Raise `hnsw.ef_search` (`SET LOCAL hnsw.ef_search = 100`).
- Partition or use a partial index for a tenant-scoped filter.
- Post-filter a larger result set and trim in the application.

Tenant isolation still belongs in a parameterised server-side predicate. A client-supplied tenant id must never decide which rows enter a RAG context.

## Typing raw results

```ts
interface Hit {
  id: string;
  chunk: string;
  similarity: number;
}
const hits = rows.map(r => assert<Hit>(r));
```

Raw SQL results are outside the declared row type, so validate rather than cast them.

## Which extension

|                   |                                                                               |
| ----------------- | ----------------------------------------------------------------------------- |
| `pgvector`        | the default; HNSW and IVFFlat, works on most managed Postgres                 |
| `pgvectorscale`   | pgvector plus a disk-backed index, for large corpora                          |
| A vector database | Pinecone, Qdrant, Weaviate — a separate system to operate and keep consistent |

---

See also: [Database Extensions](./db-extensions.html) · [PostGIS](./guide-postgis.html) · [Raw SQL](./raw-sql.html)
