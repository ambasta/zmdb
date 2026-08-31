The performance question with a data layer is almost never "how fast is the library". It is how many queries you issue and whether they use an index. zmdb makes both visible.

## Count the queries first

```ts
function recording(inner: Driver) {
  const seen: CompiledQuery[] = [];
  return { driver: { execute: q => (seen.push(q), inner.execute(q)) } satisfies Driver, seen };
}
```

Wrap it per request in development and log the count. A handler at 40 queries is your problem; a handler at 3 is not, no matter what the library overhead is. Then pin the number in a test so it cannot regress silently — see [Testing](./testing.html).

## The N+1s zmdb can and cannot prevent

**Within one call, prevented by construction.** `populate` batches with an `IN` over the collected keys — two queries for one relation regardless of row count. A lazy-loading ORM issues one per row, and you cannot see it in the code.

**Across calls, not prevented.** A loop of `findById` is a loop of queries:

```ts
for (const p of posts) await authorRepo.findById(p.authorId); // N queries
```

Batch it:

```ts
const authors = await authorRepo.find({ id: { in: [...new Set(posts.map(p => p.authorId))] } });
const byId = new Map(authors.map(a => [a.id, a]));
```

See [DataLoaders](./dataloaders.html).

## Choose join versus batch by cardinality

| Relation                   | Rows on the far side | Use                                             |
| -------------------------- | -------------------- | ----------------------------------------------- |
| `manyToOne` / `oneToOne`   | 1                    | `findJoined` — one query                        |
| `oneToMany` / `manyToMany` | n                    | `populate` — two queries, no row multiplication |

Joining a one-to-many returns the parent once per child, so a user with 40 posts arrives 40 times and you pay for the parent columns 40 times. That is why `populate` exists. See [Loading Strategies](./loading-strategies.html).

## Select fewer columns

```ts
await repo.list({ select: ['id', 'title'], page: { limit: 50 } });
```

The row type narrows too, so this is checked. It matters most for wide rows and `text`/`json` columns — and it can turn a heap fetch into an index-only scan, which is a much larger win than the byte count suggests.

## Index what you filter and order by

`unique()` gives you an index; nothing else does automatically.

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

createIndexDdl({ name: 'posts_author_created', table: 'posts', columns: ['author_id', 'created_at'] }, 'postgres');
```

Column order in a composite index is not arbitrary: equality columns first, then the range or sort column. `(author_id, created_at)` serves `WHERE author_id = ? ORDER BY created_at` and `(created_at, author_id)` does not.

Partial indexes are supported and are the right tool for a filtered subset:

```ts
createIndexDdl({ name: 'orders_open', table: 'orders', columns: ['created_at'], where: "status = 'open'" }, 'postgres');
```

Functional indexes are not expressible — `IndexDef.columns` is column names only. Hand-write it in a [migration](./migrations-custom.html).

## Read the plan

The compiler gives you the exact statement, so this is easy:

```ts
const q = repoQuery(); // or a builder .compile()
const plan = await driver.execute({ text: `EXPLAIN ANALYZE ${q.text}`, parameters: [...q.parameters] });
console.log(plan.map(r => r['QUERY PLAN']).join('\n'));
```

A `Seq Scan` on a large table in a filtered query means a missing index. This is a more reliable use of an hour than any amount of application-level tuning.

## Paginate with keyset, not offset

`OFFSET 100000` makes the database read and discard 100,000 rows. Keyset pagination is O(1) in the page number:

```ts
await repo.list({
  where: { id: { gt: cursor } },
  orderBy: [{ column: 'id', dir: 'asc' }],
  page: { limit: 50 },
});
```

See [Cursor-based pagination](./guide-cursor-pagination.html).

## What the library itself costs

Compiling a query is string concatenation over a plain object — nanoseconds, and no allocation of consequence. There is no identity map to maintain, no change tracking, no proxies and no metadata reflection, so there is no per-row overhead beyond building the row object. That is most of why the [ORM benchmark](./benchmarks.html) numbers look the way they do, and it also means library overhead is not where your time goes. Your time goes in the round trips and the plans.

## `LIKE '%term%'` cannot use an index

Three `ILIKE`s with a leading wildcard is a full scan. Use [full-text search](./full-text-search.html), or a trigram index (`pg_trgm`, via a [migration](./migrations-custom.html)).

---

See also: [Loading Strategies](./loading-strategies.html) · [Indexes & Constraints](./indexes-constraints.html) · [Benchmarks](./benchmarks.html)
