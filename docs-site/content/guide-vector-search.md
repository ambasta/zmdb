zmdb can carry a pgvector column from a TypeScript declaration through migration DDL and into a parameterised nearest-neighbour query. The recipe below starts with an empty PostgreSQL database and
runs the whole path. It assumes the [AOT transform](./aot-setup.html) is configured because `schemaOf<T>()` and `assert<T>()` are build-time calls.

## Declare the column

```ts
import type { Ext, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Embedding extends Table<'embeddings'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
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
  "id" SERIAL PRIMARY KEY
);
```

The derived JSON Schema describes the embedding as a numeric array with `minItems` and `maxItems` both set to `1536`. Database reads accept either a driver-parsed array or pgvector's text form without
partially parsing malformed values.

## Create the table, index, row and query

Install `pg`, set `DATABASE_URL` to an empty database, and use a PostgreSQL server that has pgvector available for `CREATE EXTENSION`. Then run this file through the configured transform:

```ts
import { Pool } from 'pg';

import { assert } from '@zmdb/aot-validator/utilities';
import { createQueryCompiler, distance } from '@zmdb/query-compiler';
import { diff, emitUp, snapshot, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';
import { pgDriver } from '@zmdb/repository/drivers/pg';
import { schemaOf } from '@zmdb/schema-core';

function vector1536(value: unknown): readonly number[] {
  const valid = Array.isArray(value) && value.length === 1536 && value.every((component): component is number => typeof component === 'number' && Number.isFinite(component));
  if (!valid) throw new TypeError('expected 1,536 finite numbers');
  return value;
}

export interface Hit {
  readonly id: number;
  readonly documentId: number;
  readonly chunk: string;
  readonly distance: number;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString });
  const driver = pgDriver(pool);
  try {
    const empty: SchemaSnapshot = { version: 1, tables: [], extensions: [] };
    const declared = snapshot([schemaOf<Embedding>()]);

    for (const op of diff(empty, declared, { dialect: 'postgres' })) {
      await driver.execute({ text: emitUp(op, 'postgres'), parameters: [] });
    }

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
    await driver.execute({ text: indexSql, parameters: [] });

    const vector = vector1536(Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)));
    await driver.execute({
      text: 'INSERT INTO embeddings ("documentId", chunk, embedding) VALUES ($1, $2, $3)',
      parameters: [42, 'The migration installs vector before creating the table.', JSON.stringify(vector)],
    });

    const nearest = distance<Embedding>('embedding', 'cosine', vector);
    const query = createQueryCompiler('postgres')
      .selectFrom('embeddings')
      .select(['id', 'documentId', 'chunk', nearest.as('distance')])
      .orderBy(nearest, 'asc')
      .limit(10)
      .compile();

    const hits = (await driver.execute(query)).map(value => assert<Hit>(value));
    console.log(hits);
  } finally {
    await pool.end();
  }
}

await main();
```

The extension operation is a separate migration phase, so it executes before the table that names `vector(1536)`. The index call emits:

```sql
CREATE INDEX "embeddings_hnsw" ON "embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
```

`pgvector` accepts the `[0.1,0.2,...]` form produced by `JSON.stringify(number[])`. The compiler uses the same text form for the query vector and binds it rather than interpolating it.

Use `ivfflat` with `{ lists: N }`, or `hnsw` with `m` and `ef_construction`. HNSW has the better query-performance/recall trade-off, but builds more slowly and uses more memory. IVFFlat builds faster
and uses less memory, but should be created after representative data exists and tuned with `lists` and `ivfflat.probes`. The [pgvector indexing guide](https://github.com/pgvector/pgvector#indexing)
is the source of truth for those choices.

An option belonging to another method is refused before migration execution. The operator class must match the query operator — `vector_cosine_ops` for `<=>`, `vector_l2_ops` for `<->`.

Two query details are easy to get wrong:

- **Order by the distance expression.** Ordering by a transformed similarity expression such as `1 - distance` prevents the approximate index from serving the order.
- **`<=>` is cosine distance.** Smaller is closer; `1 - distance` is similarity. Sort the distance ascending.

The closed operators are `l2` (`<->`), `cosine` (`<=>`) and `ip` (`<#>`). Cockroach, MySQL, SingleStore, SQLite and SQL Server refuse them instead of emitting an operator with different semantics.

## Validation cost

Checking a 1,536-dimensional vector is O(n): proving every component finite requires reading all 1,536 values. `vector1536` performs that full boundary check without copying the array.

`repository.create()` also performs element-wise validation, so calling it with an already checked vector pays for a second full walk. The direct parameterised insert above avoids that duplicate.
Query compilation still scans the vector when encoding pgvector text; that safety pass is currently unavoidable. If a query vector also needs a runtime dimension check, as this recipe does, those are
two passes—do not add a third validator around the compiled query. On reads, the repository does not walk an array the driver already parsed; it only parses pgvector text when the driver returned
text.

## Filtering and recall

A `WHERE` alongside an approximate index reduces recall: HNSW walks the graph and then your filter discards candidates, so a narrow filter can return fewer rows than `LIMIT`.

- Raise `hnsw.ef_search` (`SET LOCAL hnsw.ef_search = 100`).
- Partition or use a partial index for a tenant-scoped filter.
- Post-filter a larger result set and trim in the application.

Tenant isolation still belongs in a parameterised server-side predicate. A client-supplied tenant id must never decide which rows enter a RAG context.

The selected distance is a computed SQL value rather than a declared table column, which is why the recipe validates each `Hit` instead of casting it.

---

See also: [Database Extensions](./db-extensions.html) · [PostGIS](./guide-postgis.html) · [Raw SQL](./raw-sql.html)
