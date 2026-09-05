PostgreSQL extension types are declared without opening the core `SqlType` vocabulary. zmdb carries the extension name, supplied type and type parameters through reflection, snapshots and migrations;
it also exposes closed pgvector distance expressions and the two typed PostGIS predicates documented below.

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

Cockroach, MySQL, SingleStore, SQLite and SQL Server refuse PostgreSQL extension installation and extension-backed column DDL. There is no text fallback, because a value that round-trips as text is
still unusable by the extension operators it was declared for.

`Ext` names storage and migration behavior; it does not install a runtime value codec. Extension-specific writes that need conversion therefore remain explicit, parameterised statements.
[Custom Types & Codecs](./custom-types.html) explains the separate app/wire/database conversion boundary.

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

## Closed query expressions

The query compiler exposes `distance<T>(column, op, query)` for projection and ordering, with `l2`, `cosine` and `ip` as the complete operator set. It also exposes `stContains<T>` and `stDWithin<T>`
for declared `geometry` columns. Query vectors, GeoJSON values and radii are bound parameters, and every one of these constructs is refused outside PostgreSQL.

That surface is deliberately closed rather than a free-form function/operator builder: vector operators and geometry functions place schema-authored identifiers beside request values, so each operator
is selected from a known set and every value remains parameterised. Raw SQL is still needed for extension writes, geography-specific expressions and spatial projections beyond those two predicates.
The linked guides show those boundaries in complete PostgreSQL recipes rather than hiding them behind a broader claim.

---

See also: [Vector similarity search](./guide-vector-search.html) · [PostGIS](./guide-postgis.html) · [Custom Types & Codecs](./custom-types.html)
