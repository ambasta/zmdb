Postgres full-text search is fast when the `tsvector` is stored and indexed rather than computed per query. A generated column does that, and `generatedColumnDdl` emits it.

## The schema

```ts
import { defineSchema, serial, text } from '@zmdb/schema-core';

export const articles = defineSchema(
  'articles',
  {
    id: serial().primaryKey(),
    title: text().notNull(),
    body: text().notNull(),
  },
  { ftsTable: 'articles_fts' },
);
```

`ftsTable` is what `findByFullText` uses — see [Full-Text Search](./full-text-search.html).

## The generated column and its index

```ts
import { generatedColumnDdl, createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const ddl = generatedColumnDdl(
  'articles',
  {
    name: 'search',
    type: 'tsvector',
    expression: `to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))`,
    stored: true,
  },
  'postgres',
);
```

Three details in that expression that matter:

- **`coalesce`.** Concatenating with a `NULL` yields `NULL`, so one null column makes the whole document empty and the row unfindable.
- **`'english'`** is a hardcoded regconfig. It must be, because a generated column expression has to be immutable — `to_tsvector(body)` with the default configuration is not, and Postgres rejects it.
- **`stored: true`** is required. Postgres has no virtual generated columns.

Then the index, which is where the speed comes from:

```ts
createIndexDdl({ name: 'articles_search_gin', table: 'articles', columns: ['search'] }, 'postgres');
```

That emits a btree by default. A `tsvector` needs GIN, which `IndexDef` cannot express — so write this one by hand in the [migration](./migrations-custom.html):

```sql
CREATE INDEX articles_search_gin ON articles USING GIN (search);
```

Without GIN the query still works and scans the table, which is the failure mode to watch for — correct results, no error, and a plan full of `Seq Scan`.

## Weighting the title

Ranking a title match above a body match:

```sql
setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
setweight(to_tsvector('english', coalesce(body,'')),  'B')
```

Then `ts_rank` respects the weights. Worth doing — an unweighted index ranks a passing mention in a long body alongside a title match.

## Querying

```ts
const rows = await driver.execute({
  text: `SELECT id, title, ts_rank("search", websearch_to_tsquery('english', $1)) AS rank
         FROM "articles"
         WHERE "search" @@ websearch_to_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2`,
  parameters: [term, 20],
});
```

`websearch_to_tsquery` is the one to use for user input — it accepts quoted phrases and `-exclusions` and never throws on malformed input. `to_tsquery` raises a syntax error on a stray operator, which becomes a 500 on a search box.

The term is a parameter. The regconfig is a literal. Do not swap those.

## Keeping it in the migration

```ts
export const migration = {
  version: 3,
  name: 'articles-fts',
  up: [
    `ALTER TABLE articles ADD COLUMN search tsvector GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
       setweight(to_tsvector('english', coalesce(body,'')), 'B')
     ) STORED`,
    'CREATE INDEX articles_search_gin ON articles USING GIN (search)',
  ],
  down: ['DROP INDEX articles_search_gin', 'ALTER TABLE articles DROP COLUMN search'],
};
```

Adding a stored generated column rewrites the table and takes an exclusive lock. On a large live table, add the column and backfill via a trigger instead, then index `CONCURRENTLY`.

## The other dialects

|          | Approach                                                                                   |
| -------- | ------------------------------------------------------------------------------------------ |
| MySQL    | `FULLTEXT` index directly on the columns — no generated column needed, `MATCH ... AGAINST` |
| SQLite   | `FTS5` virtual table plus triggers to keep it in sync                                      |
| Postgres | this page                                                                                  |

Only the Postgres path uses a generated column, so a portable search feature needs one implementation per dialect. That is a fair reason to reach for a search service if you target several.

## Do not declare the generated column in `defineSchema`

It would appear in `CreateDTO` as something to insert, and the database will reject any write to it. Query it through the builder or raw SQL, as above.

---

See also: [Full-Text Search](./full-text-search.html) · [Generated Columns](./generated-columns.html) · [Custom Migrations](./migrations-custom.html)
