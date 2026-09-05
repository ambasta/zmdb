zmdb loads a relation only when you name it, and gives you two ways to do it. Which one is right depends on the cardinality, not on a config flag.

## `populate` — one query per relation

```ts
const users = await repo.findAll({ populate: ['posts'] });
// SELECT * FROM "users"
// SELECT * FROM "posts" WHERE "author_id" IN ($1, $2, $3, ...)
```

Two statements. The second collects the keys from the first and batches them into an `IN`, so it is _n + 1 queries per relation_, not per row.

Use it for **one-to-many** and **many-to-many**. A join would multiply the parent row by the number of children, so a user with 40 posts arrives 40 times and you pay for the parent columns 40 times over.

## `findJoined` / `joinRelation` — one query

```ts
const rows = await repo.findJoined('author', { id: { eq: 1 } });
// SELECT ... FROM "posts" INNER JOIN "authors" ON "authors"."id" = "posts"."author_id"
```

One statement, one round trip. Use it for **many-to-one** and **one-to-one**, where there is exactly one row on the other side and nothing multiplies.

## Choosing

| Relation     | Rows on the far side | Use                          |
| ------------ | -------------------- | ---------------------------- |
| `ManyToOne`  | 1                    | `findJoined`                 |
| `OneToOne`   | 1                    | `findJoined`                 |
| `OneToMany`  | n                    | `populate`                   |
| `ManyToMany` | n                    | an explicit three-table join |

The rule reduces to: **join when the cardinality is one, batch when it is many.** That is the same decision an ORM's "joined vs select-in strategy" setting makes; the difference is that here it is at the call site, where you can see how many parents you are fetching.

## What is not here

**No lazy loading.** There is no proxy and no `init()`. A relation you did not request is absent from the row _type_, so `user.posts` where you did not populate is a compile error rather than a surprise query. See [Why fetched rows are inert](./inert-rows.html).

**No `eager: true`.** A relation is never loaded because of how it was declared, only because of how it was asked for. Two call sites with different needs do not fight over one setting.

**No automatic batching across calls.** Two direct `findById` calls are two queries. When a request needs
cross-call batching, construct an explicit [`LoaderScope`](./dataloaders.html) and call its loader instead;
ordinary repository reads never change behaviour because a scope happens to exist.

**No nested populate.** `populate: ['posts']` loads posts; it does not load `posts.comments`. Do the second level yourself:

```ts
const users = await userRepo.findAll({ populate: ['posts'] });
const postIds = users.flatMap(u => u.posts.map(p => p.id));
const comments = await commentRepo.find({ postId: { in: postIds } });
```

Which is three queries, explicitly, instead of an unknown number.

## Counting the queries in a test

Because the driver has one required method, asserting on the statement count is trivial and worth doing on any hot path:

```ts
const seen: string[] = [];
const spy: Driver = {
  ...real,
  execute: (q, options) => {
    seen.push(q.text);
    return real.execute(q, options);
  },
};

await defineRepository(users, spy, { relations }).findAll({ populate: ['posts'] });
expect(seen).toHaveLength(2);
```

---

See also: [Relations](./relations.html) · [Populate & Join Results](./populate-results.html) · [Query Performance](./perf-queries.html)
