Stage 3 has **no parameter decorators**, so `@zmdb/web` handlers take a single
strongly-typed **context** object instead of `@Param`/`@Body`/`@Query` arguments.
Crucially, the params type is **derived from the route string** at compile
time — you never hand-write it, and you never need an `as` cast.

## Path-param derivation

`PathParams<Path>` reads `:name` segments out of a route string via
template-literal types:

```ts
import type { PathParams } from '@zmdb/web';

type A = PathParams<'/users/:id'>; // { id: string }
type B = PathParams<'/users/:id/posts/:postId'>; // { id: string; postId: string }
type C = PathParams<'/health'>; // {} (no params)
type D = PathParams<'/files/:path'>; // { path: string }
```

## The `Ctx` object

```ts
interface Ctx<Params, Body, Query> {
  readonly params: Params; // derived from the route path
  readonly body: Body;
  readonly query: Query;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}
```

## Binding a handler to its route

`HandlerFor<Path, Body>` ties `ctx.params` to the route string, so a typo in a
param name is a **compile error** — no runtime surprise, no assertion:

```ts
import type { HandlerFor } from '@zmdb/web';

const getUser: HandlerFor<'/users/:id', never> = ctx => {
  ctx.params.id; // ✅ string
  // ctx.params.slug; // ✗ compile error — 'slug' is not a param of this route
  return ctx.params.id;
};
```

## Extracting params at runtime

`extractParams(pattern, path)` turns a request path into the params object (or
`undefined` on a mismatch):

```ts
import { extractParams } from '@zmdb/web';

extractParams('/users/:id', '/users/42'); // { id: '42' }
extractParams('/users/:id/posts/:postId', '/u/1/p/7'); // (mismatch) → undefined
extractParams('/health', '/health'); // {}
```

It compiles `pattern` on every call, which is what you want for a one-off match
and not what you want in a hot loop. A route pattern is a constant, so the
dispatcher splits the work in two and does the pattern half once, at
registration:

```ts
import { compilePattern, countSegments, matchCompiled } from '@zmdb/web';

const route = compilePattern('/users/:id'); // once, at boot
route.segmentCount; // 2 — cheap pre-filter via countSegments(path)

matchCompiled(route, '/users/42'); // { id: '42' }   per request
matchCompiled(route, '/orders/42'); // undefined
```

Use this pair if you are building your own dispatcher over `getRoutes`.

## Design notes

- **100% compile-time** param typing; matching is the only runtime code.
- **Matching allocates only the result.** A pattern with no params returns a
  shared frozen empty object and allocates nothing else; one with params
  allocates the params object and one string per param. It never builds
  intermediate segment arrays, and never re-parses the pattern.
- **No `as` on the consumer surface** — params are typed by derivation, not by
  assertion.
- Granular import: `import type { Ctx } from '@zmdb/web/context'`.

## Cross-links

- [Controllers & routing](./web-controllers.html) — where routes are declared
- [@zmdb/web overview](./web-overview.html)
