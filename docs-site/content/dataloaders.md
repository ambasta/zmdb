> **Implemented; documentation follow-up remains.** `createLoaderScope()` provides
> explicit request-scoped loaders for primary-key reads and declared relations.
> Calls made before the next microtask are coalesced, and no ambient or global
> loader exists.

## Why this is separate from `populate`

The N+1 that `populate` solves is _within_ one repository call. A DataLoader solves the one _across_ call
sites — for example, a service loop in which each item independently asks for its author:

```ts
const posts = await postRepo.findAll();
const loaders = createLoaderScope();
const authors = loaders.loaderFor(authorRepo);

const withAuthors = await Promise.all(
  posts.map(async post => ({
    ...post,
    author: await authors.load(post.authorId),
  })),
);
```

All `load()` calls made before the scheduled microtask runs become one `WHERE id IN (…)` dispatch. Awaiting
each call inside a serial loop defeats the batching window:

```ts
for (const id of ids) await authors.load(id); // one dispatch per iteration
await Promise.all(ids.map(id => authors.load(id))); // one batch
```

Large batches are split sequentially at the dialect's parameter ceiling. A missing row resolves
`undefined`; a driver failure rejects every caller in that batch.

Composite IDs are normalized in the schema's primary-key declaration order, so object property order does
not change the key; a missing component throws instead of becoming an `undefined` key.

## One scope per request

Construct the scope at the request boundary and pass it to the code that needs it:

```ts
async function handleRequest() {
  const loaders = createLoaderScope();
  return listPosts({ loaders });
}
```

Calling `loaderFor()` again with the same repository and scope returns the same loader, so a row already
loaded in that request does not cause another query. A different scope starts empty. There is deliberately
no default scope, process-global loader, `AsyncLocalStorage` lookup or DI registration: a global hit could
return a row before the next request's tenant filter ever builds its query.

Each caller receives a fresh shallow copy. Structural equality is preserved, but object identity is not;
mutating one returned row cannot alter the loader's canonical entry. Nested values such as a parsed JSON
column remain shallowly shared.

Normal repository reads do not consult the loader. `findById`, `find`, `findAll` and `populate` still go to
the driver unless the caller explicitly uses `load()`, and writes neither populate nor invalidate the
scope. Those boundaries keep this from becoming an identity map.

## Batch a declared relation

Use `relationLoader()` when separate call sites need the same declared relation:

```ts
const loaders = createLoaderScope();
const orders = loaders.relationLoader(userRepo, 'orders');
const users = await userRepo.findAll();

const withOrders = await Promise.all(
  users.map(async user => ({
    ...user,
    orders: await orders.load(user),
  })),
);
```

The relation name is checked against the repository's declared type. Parent keys are deduplicated, the
existing relation resolver builds the target query, and all parents in the microtask share that dispatch.
To-many relations resolve to arrays; to-one relations resolve to a row or `null`.

---

See also: [Loading Strategies](./loading-strategies.html) · [Query Performance](./perf-queries.html) ·
[Caching](./caching.html)
