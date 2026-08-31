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
        posts: (_, args) => posts.list({ page: { limit: Math.min(args.limit ?? 20, 100) } }).then(r => r.rows),
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

**Fetch relations up front** with `findAllWithMany` when the shape is predictable, which is the cheaper answer where it applies. See [Loading Relations](./loading-strategies.html).

## Validating arguments

GraphQL validates against its schema, which covers types but not your rules — a `limit` of `-5` or an email that is not one both pass. Use the AOT validator inside the resolver:

```ts
posts: (_, args) => {
  const input = assert<{ limit: number }>(args);
  return posts.list({ page: { limit: Math.min(Math.max(input.limit, 1), 100) } }).then(r => r.rows);
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

Authorise on the **field that exposes the data**, not on the query that started the traversal. `sensitive()` on a column [affects serialization, not queries](./web-mapped-types.html), so it will not save you here.

Also disable introspection in production and cap query depth and complexity — see [Query Complexity](./web-graphql-complexity.html).

## What it would take

A schema builder that derives GraphQL types from `defineSchema` (the analogue of `toJsonSchema`), `@Resolver`/`@Query`/`@Mutation` decorators, and either a bundled server or an adapter. `graphql` cannot be a dependency under [Directive 7](./anti-patterns.html), so it would be an optional entry point with a peer dependency.

The genuinely valuable piece — and the one that would distinguish it — is deriving the type definitions from the schema so the GraphQL types cannot drift from the tables. That is the same trick `toJsonSchema` plays, and it is what makes the code-first approach here worth building rather than adopting a generic library.

---

See also: [DataLoaders](./dataloaders.html) · [Loading Relations](./loading-strategies.html) · [Query Complexity](./web-graphql-complexity.html)
