Postgres full-text search is fast when the `tsvector` is stored and indexed rather than computed per query. A generated column does that, and `generatedColumnDdl` emits it.

## The declaration

```ts
import type { Fts, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Article extends Table<'articles'>, Fts<'articles_fts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  body: string & Sql<'text'>;
}
```

`Fts<'articles_fts'>` is what `findByFullText` uses — see [Full-Text Search](./full-text-search.html). It sits on the `extends` clause next to `Table<…>` because it is a fact about the entity rather than about a column; `Fts<true>` is the shorthand for "index this table, I do not care what the index is called".

## The generated column and its index

```ts
import { generatedColumnDdl, createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const fragment = generatedColumnDdl(
  {
    name: 'search',
    type: 'tsvector',
    expression: `to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))`,
    stored: true,
  },
  'postgres',
);
// '"search" tsvector GENERATED ALWAYS AS (to_tsvector(…)) STORED'

await exec(`ALTER TABLE "articles" ADD COLUMN ${fragment}`);
```

`generatedColumnDdl(col, dialect)` takes the column and a dialect, and returns a column _fragment_ rather than a statement — the same text belongs in a `CREATE TABLE` body and in an `ALTER TABLE … ADD COLUMN`, so the table name stays yours to write.

Three details in that expression that matter:

- **`coalesce`.** Concatenating with a `NULL` yields `NULL`, so one null column makes the whole document empty and the row unfindable.
- **`'english'`** is a hardcoded regconfig. It must be, because a generated column expression has to be immutable — `to_tsvector(body)` with the default configuration is not, and Postgres rejects it.
- **`stored: true`** is required. Postgres has no virtual generated columns.

Then the index, which is where the speed comes from:

```ts
createIndexDdl(
  {
    name: 'articles_search_gin',
    table: 'articles',
    method: 'gin',
    columns: ['search'],
  },
  'postgres',
);
// 'CREATE INDEX "articles_search_gin" ON "articles" USING gin ("search")'
```

The explicit `method: 'gin'` emits the access method a `tsvector` index needs.

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

## Do not declare the generated column

Leave `search` out of the interface. A property there would appear in `CreateDTO<Article>` as
something to insert, and the database rejects any write to a generated column. Query it through
the builder or raw SQL, as above.

There is no tag for "generated", and adding one would be a promise the schema cannot keep: the
expression is dialect-specific SQL, and a type cannot hold SQL.

---

See also: [Full-Text Search](./full-text-search.html) · [Generated Columns](./generated-columns.html) · [Tag Reference](./tags-reference.html) · [Custom Migrations](./migrations-custom.html)
