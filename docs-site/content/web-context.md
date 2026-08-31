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

`extractParams(pattern, path)` is the small pure helper the dispatcher uses to
turn a matched request path into the params object (or `undefined` on a
mismatch):

```ts
import { extractParams } from '@zmdb/web';

extractParams('/users/:id', '/users/42'); // { id: '42' }
extractParams('/users/:id/posts/:postId', '/u/1/p/7'); // (mismatch) → undefined
extractParams('/health', '/health'); // {}
```

## Design notes

- **100% compile-time** param typing; `extractParams` is the only runtime code and
  allocates a single params object.
- **No `as` on the consumer surface** — params are typed by derivation, not by
  assertion.
- Granular import: `import type { Ctx } from '@zmdb/web/context'`.

## Cross-links

- [Controllers & routing](./web-controllers.html) — where routes are declared
- [@zmdb/web overview](./web-overview.html)
