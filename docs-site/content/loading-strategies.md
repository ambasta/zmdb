zmdb loads a relation only when you name it, and gives you two ways to do it. Which one is right depends on the cardinality, not on a config flag.

## `populate` — batched relation queries

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies repo; this excerpt does not repeat those declarations."}
const users = await repo.findAll({ populate: ['posts'] });
// SELECT * FROM "users"
// SELECT * FROM "posts" WHERE "author_id" IN ($1, $2, $3, ...)
```

For a nonempty result that fits one batch, these are two statements. The second collects parent keys into an `IN` query. Large batches can split at the dialect's parameter limit.

Use it for **one-to-many**. A join would multiply the parent row by the number of children, so a user with 40 posts arrives 40 times and you pay for the parent columns 40 times over.

## `findJoined` / `joinRelation` — one query

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies repo; this excerpt does not repeat those declarations."}
const rows = await repo.findJoined('author', { id: { eq: 1 } });
// SELECT ... FROM "posts" INNER JOIN "authors" ON "authors"."id" = "posts"."author_id"
```

One statement, one round trip. Use it for **many-to-one** and **one-to-one**, where there is exactly one row on the other side and nothing multiplies.

## Choosing

| Relation     | Rows on the far side | Use                        |
| ------------ | -------------------- | -------------------------- |
| `ManyToOne`  | 1                    | `findJoined`               |
| `OneToOne`   | 1                    | `findJoined`               |
| `OneToMany`  | n                    | `populate`                 |
| Many-to-many | n                    | explicit queries or a join |

The rule reduces to: **join when the cardinality is one, batch when it is many.** That is the same decision an ORM's "joined vs select-in strategy" setting makes; the difference is that here it is at
the call site, where you can see how many parents you are fetching.

## What is not here

**No lazy loading.** There is no proxy and no `init()`. A relation you did not request is absent from the row _type_, so `user.posts` where you did not populate is a compile error rather than a
surprise query. See [Why fetched rows are inert](./inert-rows.html).

**No `eager: true`.** A relation is never loaded because of how it was declared, only because of how it was asked for. Two call sites with different needs do not fight over one setting.

**Direct reads remain independent.** Two direct `findById` calls are two queries. For cross-call batching, use [`LoaderScope`](./dataloaders.html). HTTP `Ctx` provides a lazily created `ctx.loaders`
shared within that request; ordinary repository reads do not consult it. Standalone and custom contexts can use `createLoaderScope()`.

**Many-to-many population is unsupported.** Query the join table explicitly or write the required join.

## Nested paths and existing rows

Every existing `populate` read option accepts typed dotted paths:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies userRepo with declared posts/comments relations and their target schemas in RepositoryOptions.schemas."}
const users = await userRepo.findAll({ populate: ['posts.comments'] });
```

Register the target schemas in `RepositoryOptions.schemas` so the repository can resolve each relation along the path. Shared prefixes are deduplicated: requesting both `posts` and `posts.comments`
loads the `posts` edge once, with SQL batches split as needed for the dialect's parameter limit.

For rows you already have, call `repo.populate(row, paths, options?)` or `repo.populate(rows, paths, options?)`. Both return new populated copies, leave the input rows unchanged, and fetch only
relations. The root rows are not fetched again. The optional third argument is `ReadOptions`.

## Counting the queries in a test

A driver wrapper can record the statements for a particular workload. This example expects a nonempty parent result that fits one relation batch:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies Driver, defineRepository, expect, real, schemas, users; this excerpt does not repeat those declarations."}
const seen: string[] = [];
const spy: Driver = {
  ...real,
  execute: (q, options) => {
    seen.push(q.text);
    return real.execute(q, options);
  },
};

await defineRepository(users, spy, { schemas }).findAll({ populate: ['posts'] });
expect(seen).toHaveLength(2);
```

---

See also: [Relations](./relations.html) · [Populate & Join Results](./populate-results.html) · [Query Performance](./perf-queries.html)
