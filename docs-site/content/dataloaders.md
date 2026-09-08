HTTP `Ctx` exposes `ctx.loaders`, a `LoaderScope` created lazily on first access and shared only within that request. Use it explicitly for primary-key reads, declared relations, or population of rows
you already have. Ordinary repository reads remain independent.

For standalone code or a custom request context, keep using `createLoaderScope()` at the request boundary:

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies listPosts; this excerpt does not repeat those declarations."}
import { type Entity } from '@zmdb/schema';
import { createLoaderScope, type LoaderScope } from '@zmdb/orm';

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

The scope owns its loaders and their loaded values. Letting the request context become unreachable ends their lifetime; there is no `clear()` call to remember. `loaderFor()` and `relationLoader()`
retain loaded snapshots within the scope; `populate()` batches pending calls without retaining a result cache.

## Batch primary-key reads across call sites

`populate` batches relations requested by one repository call. A loader handles the N+1 spread across independent call sites:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies RequestContext, authorRepo, postRepo; this excerpt does not repeat those declarations."}
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

The first `load()` of an empty batch schedules one microtask. Every load made before that microtask runs joins the dispatch:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies authors, ids; this excerpt does not repeat those declarations."}
for (const id of ids) await authors.load(id); // one dispatch per iteration
await Promise.all(ids.map(id => authors.load(id))); // one batch
```

One batch is not necessarily one statement. IDs are deduplicated, then large batches are split at the dialect's parameter ceiling and executed sequentially. Composite IDs are keyed in primary-key
declaration order, so `{ tenantId, id }` and `{ id, tenantId }` identify the same row; a missing component throws.

A missing row resolves `undefined`. If a statement fails, every caller in that batch rejects with that error, and the error is not cached. Repeating `loaderFor()` with the same repository and scope
returns the same loader; constructing another scope starts empty.

## Resolver-shaped request wiring

zmdb does not ship a GraphQL server. The example below shows the request-context shape for a third-party server because field resolvers are the canonical cross-call N+1:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies Entity, LoaderScope, authorRepo, createLoaderScope; this excerpt does not repeat those declarations."}
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

Register `createResolverContext` as the server's per-request context hook. Do not call it once during startup. A module-level context or loader would retain rows across users and could return a row
before the next request builds its tenant-filtered query.

## Batch a declared relation

`relationLoader()` resolves through the repository's declared relation:

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies ctx, userRepo; this excerpt does not repeat those declarations."}
const orders = ctx.loaders.relationLoader(userRepo, 'orders');
const users = await userRepo.findAll();

const withOrders = await Promise.all(
  users.map(async user => ({
    ...user,
    orders: await orders.load(user),
  })),
);
```

The relation name is type-checked. Parent keys are deduplicated and all parents loaded in the microtask share the dispatch. A to-many relation resolves to an array; a to-one relation resolves to a row
or `null`.

## Batch population across call sites

`LoaderScope.populate(repo, row, paths, options?)` and its readonly-row-array overload populate existing rows without fetching their roots again. The returned values are new populated copies; the
input rows remain unchanged.

```ts {"mode":"illustrative","id":"populate-existing-rows","reason":"The surrounding HTTP handler supplies ctx, userRepo, firstUser, otherUsers and readOptions; the repository registers the declared posts/comments target schemas."}
const [first, others] = await Promise.all([ctx.loaders.populate(userRepo, firstUser, ['posts.comments'], readOptions), ctx.loaders.populate(userRepo, otherUsers, ['posts.comments'], readOptions)]);
```

Concurrent calls share a batch when they use the same repository instance, path set, and `ReadOptions` object identity. Reuse one options object for calls that should batch together; separate objects
form separate groups even if their fields are equal. Register each target schema in `RepositoryOptions.schemas`. Shared path prefixes are deduplicated, and SQL batches may split at the dialect's
parameter limit.

Completed population results are not retained in the scope. A later `populate()` call loads the requested relations again. The same API works with a manually created scope outside HTTP.

## Loaded rows are immutable snapshots

For the cached `loaderFor()` and `relationLoader()` APIs, treat a loaded row as read-only:

- Every `load()` resolution receives a fresh **shallow** copy. Two callers do not hold the same row object.
- Reassigning a top-level property changes only that caller's copy and never writes to the database.
- Nested JSON objects and arrays are not deep-cloned. Mutating one can affect later shallow copies in the same scope, so do not mutate loaded values.
- A repository write does not update or invalidate a loader. A later `load()` in the same scope can therefore return the pre-write snapshot. Use an ordinary repository read or a new scope when the
  caller requires a post-write value.

That last rule is deliberate. Loader invalidation coupled to writes would turn the scope into a unit of work responsible for keeping an object graph coherent.

## Why this is not an identity map

| Property                  | `LoaderScope`                           | Identity map                       |
| ------------------------- | --------------------------------------- | ---------------------------------- |
| Entry point               | Explicit `load()` or `populate()`       | Every entity read                  |
| Lifetime                  | Request-local scope                     | ORM session/context                |
| Object identity           | Copies rather than shared root objects  | Same object reference              |
| Ordinary repository reads | Never consult it                        | Transparently consult it           |
| Writes                    | No tracking, population or invalidation | Tracks objects for flush/coherence |

The loader removes duplicate round trips; it does not make rows live objects. The separate [result cache](./caching.html) follows the same no-identity rule, but uses explicit TTL and tag invalidation
rather than request lifetime.

---

See also: [Loading Strategies](./loading-strategies.html) · [Query Performance](./perf-queries.html) · [Caching](./caching.html) · [Why fetched rows are inert](./inert-rows.html)
