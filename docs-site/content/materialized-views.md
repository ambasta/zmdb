A materialized view stores its result set instead of recomputing it. `createViewDdl` emits one when you pass `materialized: true`, and **only for postgres**.

## Creating one

```ts
import { createViewDdl } from '@zmdb/query-compiler/schema-objects';

const ddl = createViewDdl(
  {
    name: 'author_stats',
    materialized: true,
    select: `
    SELECT a.id AS author_id, a.name, COUNT(p.id) AS post_count
    FROM authors a LEFT JOIN posts p ON p.author_id = a.id
    GROUP BY a.id, a.name
  `,
  },
  'postgres',
);

await driver.execute({ text: ddl, parameters: [] });
```

```sql
CREATE MATERIALIZED VIEW "author_stats" AS SELECT ...
```

On `mysql` or `sqlite` this throws `UnsupportedFeatureError('materialized views', dialect)` at compile time rather than emitting SQL the database will reject. See [Views](./views.html) for the plain-view path, which works everywhere.

## Reading from it

A materialized view is a relation, so give it a schema object and use the normal repository:

```ts
export const authorStats = defineSchema('author_stats', {
  authorId: integer().primaryKey(),
  name: text().notNull(),
  postCount: integer().notNull(),
});

export const authorStatsRepo = defineRepository(authorStats, driver, { dialect: 'postgres' });

const top = await repo.list({ orderBy: [{ column: 'postCount', dir: 'desc' }], page: { limit: 10 } });
```

> [!WARNING]
> Nothing stops you calling `create`, `update` or `delete` on a repository over a view. The methods exist because they are on `BaseRepository`; the database will reject the statement. If that matters, wrap it:
>
> ```ts
> class ReadOnly<S extends CoreSchema<string>> extends BaseRepository<S> {
>   override create(): never {
>     throw new Error('read-only view');
>   }
> }
> ```

## Refreshing

Refresh is not modelled — it is a statement you run:

```ts
await driver.execute({ text: 'REFRESH MATERIALIZED VIEW "author_stats"', parameters: [] });

// non-blocking, needs a unique index on the view
await driver.execute({ text: 'REFRESH MATERIALIZED VIEW CONCURRENTLY "author_stats"', parameters: [] });
```

`CONCURRENTLY` requires a unique index:

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

createIndexDdl({ name: 'author_stats_pk', table: 'author_stats', columns: ['author_id'], unique: true }, 'postgres');
```

Where the refresh runs is your decision: a cron, a [lifecycle hook](./lifecycle-hooks.html) after the writes that invalidate it, or a `LISTEN`/`NOTIFY` worker. zmdb has no scheduler — see [Task Scheduling](./web-task-scheduling.html).

## Migrations

The migration snapshotter tracks tables and columns, not views. A materialized view is a hand-written migration:

```ts
const migrations = [
  {
    version: 4,
    name: 'author_stats_mv',
    up: createViewDdl({ name: 'author_stats', materialized: true, select: '...' }, 'postgres'),
    down: dropViewDdl('author_stats', 'postgres', true),
  },
];
```

`dropViewDdl(name, dialect, materialized)` emits `DROP MATERIALIZED VIEW`. See [Custom Migrations](./migrations-custom.html).

## When a materialized view is the wrong answer

If the view is cheap to compute, `repo.aggregate()` gives you the same numbers without a refresh to get stale. Reach for a materialized view when the aggregate is expensive _and_ you can tolerate the staleness window — and write down what that window is.

---

See also: [Views](./views.html) · [Aggregations](./aggregations.html) · [Custom Migrations](./migrations-custom.html)
