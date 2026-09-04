`createLoaderScope()` provides explicit request-scoped batching for primary-key
reads and declared relations. There is no ambient loader: construct one scope at
the request boundary and pass it through the request context.

```ts
import type { Entity } from '@zmdb/schema-core';
import { createLoaderScope, type LoaderScope } from '@zmdb/repository';

interface RequestContext {
  readonly loaders: LoaderScope;
}

function createRequestContext(): RequestContext {
  return { loaders: createLoaderScope() };
}

async function handleRequest() {
  return listPosts(createRequestContext());
}
```

The scope owns its loaders and their loaded values. Letting the request context
become unreachable ends their lifetime; there is no `clear()` call to remember.

## Batch primary-key reads across call sites

`populate` batches relations requested by one repository call. A loader handles
the N+1 spread across independent call sites:

```ts
async function listPosts(ctx: RequestContext) {
  const posts = await postRepo.findAll();
  const authors = ctx.loaders.loaderFor(authorRepo);

  return Promise.all(
    posts.map(async post => ({
      ...post,
      author: await authors.load(post.authorId),
    })),
  );
}
```

The first `load()` of an empty batch schedules one microtask. Every load made
before that microtask runs joins the dispatch:

```ts
for (const id of ids) await authors.load(id); // one dispatch per iteration
await Promise.all(ids.map(id => authors.load(id))); // one batch
```

One batch is not necessarily one statement. IDs are deduplicated, then large
batches are split at the dialect's parameter ceiling and executed sequentially.
Composite IDs are keyed in primary-key declaration order, so `{ tenantId, id }`
and `{ id, tenantId }` identify the same row; a missing component throws.

A missing row resolves `undefined`. If a statement fails, every caller in that
batch rejects with that error, and the error is not cached. Repeating
`loaderFor()` with the same repository and scope returns the same loader;
constructing another scope starts empty.

## Resolver-shaped request wiring

zmdb does not ship a GraphQL server. The example below shows the request-context
shape for a third-party server because field resolvers are the canonical
cross-call N+1:

```ts
interface ResolverContext {
  readonly loaders: LoaderScope;
}

// Invoke once for every request, never once when the server starts.
const createResolverContext = (): ResolverContext => ({
  loaders: createLoaderScope(),
});

const Post = {
  author(post: Entity<Post>, _args: unknown, ctx: ResolverContext) {
    return ctx.loaders.loaderFor(authorRepo).load(post.authorId);
  },
};
```

Register `createResolverContext` as the server's per-request context hook. Do
not call it once during startup. A module-level context or loader would retain
rows across users and could return a row before the next request builds its
tenant-filtered query.

## Batch a declared relation

`relationLoader()` resolves through the repository's declared relation:

```ts
const orders = ctx.loaders.relationLoader(userRepo, 'orders');
const users = await userRepo.findAll();

const withOrders = await Promise.all(
  users.map(async user => ({
    ...user,
    orders: await orders.load(user),
  })),
);
```

The relation name is type-checked. Parent keys are deduplicated and all parents
loaded in the microtask share the dispatch. A to-many relation resolves to an
array; a to-one relation resolves to a row or `null`.

## Loaded rows are immutable snapshots

Treat a loaded row as read-only:

- Every `load()` resolution receives a fresh **shallow** copy. Two callers do
  not hold the same row object.
- Reassigning a top-level property changes only that caller's copy and never
  writes to the database.
- Nested JSON objects and arrays are not deep-cloned. Mutating one can affect
  later shallow copies in the same scope, so do not mutate loaded values.
- A repository write does not update or invalidate a loader. A later `load()` in
  the same scope can therefore return the pre-write snapshot. Use an ordinary
  repository read or a new scope when the caller requires a post-write value.

That last rule is deliberate. Loader invalidation coupled to writes would turn
the scope into a unit of work responsible for keeping an object graph coherent.

## Why this is not an identity map

| Property                  | `LoaderScope`                           | Identity map                       |
| ------------------------- | --------------------------------------- | ---------------------------------- |
| Entry point               | Explicit `load()`                       | Every entity read                  |
| Lifetime                  | Explicit request-owned value            | ORM session/context                |
| Object identity           | Fresh shallow copy per resolution       | Same object reference              |
| Ordinary repository reads | Never consult it                        | Transparently consult it           |
| Writes                    | No tracking, population or invalidation | Tracks objects for flush/coherence |

The loader removes duplicate round trips; it does not make rows live objects.
The separate [result cache](./caching.html) follows the same no-identity rule,
but uses explicit TTL and tag invalidation rather than request lifetime.

---

See also: [Loading Strategies](./loading-strategies.html) · [Query Performance](./perf-queries.html) ·
[Caching](./caching.html) · [Why fetched rows are inert](./inert-rows.html)
