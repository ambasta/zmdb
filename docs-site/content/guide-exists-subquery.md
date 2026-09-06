`EXISTS` answers "does a related row exist" without joining, so it does not multiply your result rows and it can stop at the first match.

## In the builder

`SelectBuilder` has nine `EXISTS` methods — `whereExists`, `andWhereExists`, `orWhereExists` and the `NotExists` counterparts:

```ts
import { postgres } from '@zmdb/postgres';

const c = createQueryCompiler(postgres);

const authorsWithPosts = c
  .selectFrom('users')
  .whereExists(c.selectFrom('posts').where('author_id', '=', c.ref('users.id')))
  .orderBy('name', 'asc')
  .compile();
```

The correlation — `posts.author_id = users.id` — is what makes it a subquery per row rather than a constant. Without it, the subquery is true if _any_ post exists and your filter does nothing.

## Why not a join

```ts
// join: a user with 40 posts arrives 40 times
.innerJoin('posts', 'posts.author_id', 'users.id')

// exists: once, and the database can stop at the first post
.whereExists(...)
```

Use a join when you need columns from the other table, `EXISTS` when you only need the predicate. Getting this wrong is a common source of "why are there duplicates" and of `DISTINCT` being added to
paper over it — which then forces a sort.

## `NOT EXISTS`

Users who have never posted:

```ts
c.selectFrom('users')
  .whereNotExists(c.selectFrom('posts').where('author_id', '=', c.ref('users.id')))
  .compile();
```

> [!WARNING] Prefer `NOT EXISTS` over `NOT IN` on a nullable column. `x NOT IN (1, 2, NULL)` is never true — `NULL` makes the whole predicate unknown, so you get zero rows and no error. `NOT EXISTS`
> has no such behaviour.

## In the DTO API

Every `FieldOps` operator accepts a `SubqueryTarget`, so a repository call can carry a subquery:

```ts
await userRepo.find({
  id: { in: c.selectFrom('posts').select(['author_id']).where('published', '=', true) },
});
```

That is `IN (subquery)` rather than `EXISTS`, and for a moderate number of ids it performs comparably. There is no `exists:` key in `FieldOps` — for a correlated `EXISTS` at the DTO level, drop to the
builder.

## Combining with other filters

```ts
c.selectFrom('users')
  .where('active', '=', true)
  .andWhereExists(c.selectFrom('orders').where('user_id', '=', c.ref('users.id')).where('total', '>', 100))
  .compile();
```

Note `andWhereExists`, not `whereExists`, once a predicate is already present — and remember the builder is immutable, so each call must be chained or reassigned.

## Index the correlated column

`posts.author_id` needs an index, or every outer row causes a scan of `posts`:

```ts
createIndexDdl({ name: 'posts_author', table: 'posts', columns: ['author_id'] }, 'postgres');
```

This is the difference between `EXISTS` being the fast option and being the slow one. Check with `EXPLAIN ANALYZE` — see [Query Performance](./perf-queries.html).

## `EXISTS` versus `IN` versus a join

| Need                               | Use                  |
| ---------------------------------- | -------------------- |
| Predicate only, correlated         | `EXISTS`             |
| Predicate only, a small fixed set  | `IN` with a list     |
| Predicate over another query's ids | `IN` with a subquery |
| Columns from the other table       | a join               |
| Absence, nullable column           | `NOT EXISTS`         |

Modern Postgres and MySQL planners often rewrite between these, so the difference is smaller than folklore suggests — but the row-multiplication difference with a join is not a planner detail, it
changes your results.

---

See also: [Subqueries](./dynamic-queries.html) · [Joins](./joins.html) · [Query Performance](./perf-queries.html)
