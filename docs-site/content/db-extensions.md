> **ToDo / partial feature gap.** Extension installation, parameterised
> extension-backed columns and PostgreSQL index methods are supported. Typed vector
> distance expressions and PostGIS predicates are not yet available, so those queries
> still use raw SQL.

## Declaring an extension-backed column

`SqlType` remains the closed core vocabulary. An extension type uses `Ext` instead, keeping the installable extension, the SQL type it provides and its parameters separate:

```ts
import type { Ext, PrimaryKey, Sql, Table } from 'zmdb/tags';

interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

export interface Document extends Table<'documents'> {
  id: number & Sql<'integer'> & PrimaryKey;
  embedding: readonly number[] & Ext<'vector', 'vector', [1536]>;
  location: GeoJsonPoint & Ext<'postgis', 'geometry', ['Point', 4326]>;
  handle: string & Ext<'citext', 'citext'>;
}
```

The snapshot derives the required extensions from those columns. A diff from an empty snapshot emits installation first, before any table names the installed type:

```sql
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE TABLE "documents" (
  "embedding" vector(1536) NOT NULL,
  "handle" citext NOT NULL,
  "id" INTEGER PRIMARY KEY,
  "location" geometry(Point,4326) NOT NULL
);
```

Extension names are sorted for stable snapshots. Removing the declaration does **not** generate `DROP EXTENSION`: a safe removal needs a hand-written migration after checking every dependent object.

MySQL and SQLite refuse extension installation and extension-backed column DDL. There is no `TEXT` fallback, because a value that round-trips as text is still unusable by the extension operators it was declared for.

## Index methods and operator classes

`IndexDef` supports PostgreSQL access methods, operator classes and method-specific options:

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const sql = createIndexDdl(
  {
    name: 'documents_embedding_hnsw',
    table: 'documents',
    method: 'hnsw',
    columns: [{ column: 'embedding', opclass: 'vector_cosine_ops' }],
    with: { m: 16, ef_construction: 64 },
  },
  'postgres',
);
```

This emits:

```sql
CREATE INDEX "documents_embedding_hnsw" ON "documents"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
```

Methods and option keys are closed sets. Operator classes are extension-defined identifiers and are refused unless they match `/^[A-Za-z_][A-Za-z0-9_]*$/`.

## Querying remains the gap

Use raw SQL for vector distance ordering/projection and PostGIS predicates. The low-level query compiler accepts raw operator strings, but there is not yet a typed expression carrying a bound vector into `ORDER BY` or a typed `ST_DWithin` predicate:

```ts
const rows = await driver.execute({
  text: `SELECT id, embedding <-> $1 AS distance
         FROM documents
         ORDER BY embedding <-> $1
         LIMIT 10`,
  parameters: [JSON.stringify(queryEmbedding)],
});
```

That remaining surface is deliberately closed rather than a free-form function/operator builder: vector operators and geometry functions place schema-authored identifiers beside request values, so each operator must be selected from a known set and every value must remain parameterised.

---

See also: [Vector similarity search](./guide-vector-search.html) · [PostGIS](./guide-postgis.html) · [Custom Types & Codecs](./custom-types.html)
