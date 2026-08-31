> **ToDo / feature gap.** `SqlType` is a closed set of ten types —
> `serial integer bigint numeric text varchar boolean timestamp json jsonEnum`.
> There is no `vector`, so a `pgvector` column cannot be declared, and
> `IndexDef` cannot express an HNSW or IVFFlat index with an operator class.

## What works today

Everything except the declaration. `pgvector` is a normal Postgres extension, and the driver is a raw-SQL escape hatch — so a working vector search is a migration plus two queries.

**The migration** ([custom migration](./migrations-custom.html)):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id bigserial PRIMARY KEY,
  document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk text NOT NULL,
  embedding vector(1536) NOT NULL
);

CREATE INDEX embeddings_hnsw ON embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

The operator class must match your distance operator — `vector_cosine_ops` for `<=>`, `vector_l2_ops` for `<->`. Mismatch means the index is silently unused and every query scans.

**Insert:**

```ts
await driver.execute({
  text: 'INSERT INTO embeddings (document_id, chunk, embedding) VALUES ($1, $2, $3)',
  parameters: [docId, chunk, JSON.stringify(vector)],
});
```

`pgvector` accepts the `[0.1,0.2,...]` text form, which `JSON.stringify` on a `number[]` produces exactly.

**Search:**

```ts
const rows = await driver.execute({
  text: `SELECT id, chunk, 1 - (embedding <=> $1::vector) AS similarity
         FROM embeddings
         WHERE document_id = ANY($2)
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
  parameters: [JSON.stringify(queryVector), allowedDocIds, 10],
});
```

Two things that go wrong here:

- **The `ORDER BY` must use the raw distance operator.** `ORDER BY similarity DESC` sorts on the computed alias and the index cannot serve it — you get a full scan plus a sort. Order by `embedding <=> $1` ascending and compute similarity for display only.
- **`<=>` is cosine _distance_.** Smaller is closer, so `1 - distance` is the similarity. Sorting descending on the distance returns the least relevant results, which looks like a broken embedding model rather than a broken query.

## Filtering and recall

A `WHERE` alongside an approximate index reduces recall: HNSW walks the graph and then your filter discards candidates, so a narrow filter can return fewer rows than `LIMIT`. Options, in order:

- Raise `hnsw.ef_search` (`SET LOCAL hnsw.ef_search = 100`) to widen the search.
- Partition or use a partial index per tenant if the filter is tenant-scoped.
- Post-filter with a larger `LIMIT` and trim in the application.

Tenant isolation is the case to be careful about: leaking another tenant's chunk into a RAG context is a data breach, so the filter must be a parameter, applied server-side, and never derived from anything the client sends beyond an authenticated id.

## Typing the results

```ts
interface Hit {
  id: string;
  chunk: string;
  similarity: number;
}
const hits = rows.map(r => assert<Hit>(r));
```

`bigserial` arrives as a string from node-postgres. `assert` rather than a cast, because raw SQL results are outside the type system — this is exactly the boundary the validator exists for.

## Which extension

|                   |                                                                               |
| ----------------- | ----------------------------------------------------------------------------- |
| `pgvector`        | the default; HNSW and IVFFlat, works on most managed Postgres                 |
| `pgvectorscale`   | pgvector plus a disk-backed index, for large corpora                          |
| A vector database | Pinecone, Qdrant, Weaviate — a separate system to operate and keep consistent |

Keeping embeddings in Postgres means one backup, one transaction and one join to your metadata. That is worth a lot, and it is why the workaround above is a legitimate destination rather than a stopgap.

## What it would take

Two things, in order of difficulty:

- **An extensible `SqlType`.** Today it is a closed union, which is what makes DDL generation and type mapping total. Opening it means a story for how a custom type maps to a TypeScript type, how it serialises, and what `diff`/`emitUp` do with it. Same blocker as [PostGIS](./guide-postgis.html) and `citext` — see [Database Extensions](./db-extensions.html).
- **Index expressions and options in `IndexDef`.** Needed for `USING hnsw (col vector_cosine_ops) WITH (...)`. Also what [case-insensitive unique](./guide-case-insensitive-unique.html) needs.

Neither is a small addition, and both would change the shape of the schema API — which is why the honest answer today is the migration above.

---

See also: [Database Extensions](./db-extensions.html) · [PostGIS](./guide-postgis.html) · [Raw SQL](./raw-sql.html)
