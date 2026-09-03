> **ToDo / feature gap.** There is no GraphQL support — no `@Resolver`, `@Query`,
> `@Mutation`, `@ObjectType` or `@Field`, no schema building, and no server. Every
> `@zmdb/web` route returns JSON over HTTP.

## Running GraphQL alongside a zmdb application

The framework does not need to participate. A GraphQL server is a request handler and your zmdb services are plain objects, so composition is all that is required.

```ts
import { createSchema, createYoga } from 'graphql-yoga';

const app = createApp(AppModule);
await app.init();
const posts = app.container.resolve(POSTS);
const users = app.container.resolve(USERS);

const yoga = createYoga({
  schema: createSchema({
    typeDefs: /* GraphQL */ `
      type Post {
        id: Int!
        title: String!
        author: User
      }
      type User {
        id: Int!
        name: String!
      }
      type Query {
        post(id: Int!): Post
        posts(limit: Int): [Post!]!
      }
    `,
    resolvers: {
      Query: {
        post: (_, args) => posts.findById(args.id),
        posts: (_, args) => posts.list({ page: { limit: Math.min(args.limit ?? 20, 100) } }).then(r => r.items),
      },
      Post: {
        author: post => users.findById(post.authorId),
      },
    },
  }),
});
```

```ts
createServer(async (req, res) => {
  if ((req.url ?? '').startsWith('/graphql')) return yoga(req, res);
  const out = await app.handle(toWebRequest(req));
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

One container, one pool, both surfaces. The GraphQL half gets your repositories; the REST half is unchanged.

`Math.min(args.limit ?? 20, 100)` is not decoration — an unbounded `limit` from a client is a denial-of-service knob. Cap every list argument.

## The N+1 problem is worse here than in REST

`Post.author` above runs one query **per post**. Twenty posts is twenty-one queries, and GraphQL's whole point is that the client chooses the shape — so the client decides how bad it gets.

Two fixes, both available today.

**Batch with a loader.** Build it per request so it cannot cache across users:

```ts
function makeLoaders(users: UserRepo) {
  const pending = new Map<number, Promise<User | undefined>>();
  return {
    user(id: number) {
      const existing = pending.get(id);
      if (existing !== undefined) return existing;
      const promise = users.findById(id);
      pending.set(id, promise);
      return promise;
    },
  };
}
```

```ts
const yoga = createYoga({
  schema,
  context: () => ({ loaders: makeLoaders(users) }),
});
```

```ts
Post: {
  author: (post, _, ctx) => ctx.loaders.user(post.authorId);
}
```

A per-request map deduplicates; a batching loader that collects ids in a tick and issues one `where: { id: { in: ids } }` does better. See [DataLoaders](./dataloaders.html).

> [!WARNING]
> Never make the loader a module-level singleton. It would cache rows across
> requests and across users, which serves one user's data to another — and the bug
> is invisible in any single-request test.

The frozen design does not add request-scoped DI to solve this. A container scope would put the lifetime in the injector, where a singleton resolver holding a request-scoped loader is a compile-clean way to reintroduce the bug above; instead the per-request value travels on the context object that already reaches every resolver, which is the seam [DataLoaders](./dataloaders.html) builds on.

**Fetch relations up front** with `findAllWithMany` when the shape is predictable, which is the cheaper answer where it applies. See [Loading Relations](./loading-strategies.html).

## Validating arguments

GraphQL validates against its schema, which covers types but not your rules — a `limit` of `-5` or an email that is not one both pass. Use the AOT validator inside the resolver:

```ts
posts: (_, args) => {
  const input = assert<{ limit: number }>(args);
  return posts.list({ page: { limit: Math.min(Math.max(input.limit, 1), 100) } }).then(r => r.items);
};
```

## Authorisation is per-field, and that is the trap

REST authorises a route. GraphQL lets a client reach any field from any entry point, so a check on `Query.user` does nothing for `Post.author` returning the same type.

```ts
Post: {
  authorEmail: (post, _, ctx) => {
    if (ctx.viewer?.id !== post.authorId && ctx.viewer?.role !== 'admin') return null;
    return post.authorEmail;
  },
}
```

Authorise on the **field that exposes the data**, not on the query that started the traversal. `Sensitive` on a column [affects the derived types and documents, not queries](./web-mapped-types.html), so it will not save you here.

The frozen design keeps this property rather than smoothing it over: a middleware chain is bound to one field, and it does **not** inherit down a traversal. A guard on `Query.post` says nothing about `Post.authorEmail`, because a chain that ran for every field a query happened to touch would authorise the traversal, which is the mistake this section is about.

Also disable introspection in production and cap query depth and complexity — see [Query Complexity](./web-graphql-complexity.html).

## What it will take

The design is frozen, in `packages/web/src/graphql/SPEC.md` and `packages/schema-core/src/sdl/SPEC.md`. Four decorators, a registry, and a type that ties the two halves together:

```ts
@Resolver('Post')
class PostResolver implements ResolversOf<PostFields, AppContext> {
  @Inject(POSTS) private readonly posts!: PostRepo;
  @Inject(USERS) private readonly users!: UserRepo;

  @Query() async post(ctx: GqlCtx<undefined, { id: number }, AppContext>) {
    return (await this.posts.findById(ctx.body.id)) ?? null;
  }

  @ResolveField() author(ctx: GqlCtx<Entity<Post>, undefined, AppContext>) {
    return this.users.findById(ctx.parent.authorId);
  }
}
```

Three things about that shape are worth knowing before it lands, because each corrects something this page or its neighbours assumed.

**`graphql` is not a dependency, and not a peer either.** This page used to say an optional entry point with a peer dependency; the freeze goes further. `parts()` hands back a `typeDefs` string and a plain nested map of functions, which is what `createSchema` above already takes, and the one place a `graphql` value is genuinely needed — constructing a custom scalar — takes the constructor as an argument. So there is nothing to declare, optional or otherwise.

**There is no `@Args`.** Stage 3 decorators have no parameter form — the same reason `@zmdb/web` puts params, body, query and headers on one context object rather than decorating parameters — so the arguments arrive as `ctx.body`, already validated and already piped. `body` _is_ the arguments; a separate `args` field would be the pre-pipe value, and reaching for the wrong one is a silent bug.

**A field with arguments cannot skip validation.** The registry requires a `validate` function for exactly those fields, in the type, so the `assert` two sections up is not advice you can forget — omitting it fails to compile. The validator is yours to pass because `assert<T>` only inlines where the checker can resolve `T`, which is your call site and not the framework's.

Nothing serves `/graphql`. The registry produces the two halves and your own controller mounts them, so the composition at the top of this page stays exactly as shown — one container, one pool, both surfaces.

---

See also: [DataLoaders](./dataloaders.html) · [Loading Relations](./loading-strategies.html) · [Query Complexity](./web-graphql-complexity.html)
