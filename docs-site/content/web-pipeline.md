The router ties everything together. Register a controller instance and the
router reads its [routes](./web-controllers.html) **once**, then dispatches each
request through: **match → build [Ctx](./web-context.html) → validate body →
invoke handler → serialize**. Thin adapters connect it to `node:http` or any
Fetch runtime (Hono, edge) with **no hard dependency** on either.

## Creating a router

```ts
import { createRouter } from '@zmdb/web';
import { Controller, Get, Post } from '@zmdb/web';
import type { Ctx } from '@zmdb/web';

@Controller('/users')
class UsersController {
  @Get('/:id')
  get(ctx: Ctx<{ id: string }>) {
    return { id: ctx.params.id };
  }

  @Post()
  create(ctx: Ctx<Record<never, string>, { name: string }>) {
    return { created: ctx.body.name };
  }
}

const router = createRouter();
router.register(new UsersController(), {
  // optional per-handler body validation — runs BEFORE the handler
  create: { validateBody: raw => assertCreateUser(raw) },
});
```

## The pipeline

`router.handle(req)` returns `{ status, body, headers }`:

| step          | behavior                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------ |
| **match**     | method + path against the cached table (params via `extractParams`); no match → **404**          |
| **validate**  | if the route has `validateBody`, run it on the raw body; throw → **400**, handler **not** called |
| **invoke**    | call the handler with the typed `Ctx`                                                            |
| **serialize** | JSON-encode the result → **200**; a thrown handler → **500**                                     |

```ts
await router.handle({ method: 'GET', path: '/users/42', headers: {} });
// { status: 200, body: '{"id":"42"}', ... }

await router.handle({ method: 'POST', path: '/users', headers: {}, rawBody: { nope: 1 } });
// { status: 400, ... }  — validateBody threw; create() never ran
```

> [!IMPORTANT]
> Validation runs **before** the handler, so an invalid body never reaches your
> code. Pair `validateBody` with `@zmdb/aot-validator`'s `assert` for
> zero-runtime-parser validation against a schema DTO.

## Adapters (no hard deps)

```ts
import { toNodeHandler, toFetchHandler } from '@zmdb/web';
import { createServer } from 'node:http';

// node:http
createServer(toNodeHandler(router)).listen(3000);

// Fetch (Hono, Bun, Deno, edge)
const handler = toFetchHandler(router); // (Request) => Promise<Response>
```

Both adapters are **structurally typed** — `@zmdb/web` does not depend on
`node:http` or Hono; you bring the runtime.

## Design notes

- **No per-request reflection.** The route table is resolved at `register` time;
  each request allocates one `Ctx` + one result object.
- **No `as` on the consumer surface.** (Internally, two isolated+documented
  boundary casts read the controller constructor and the handler method.)
- Granular import: `import { createRouter } from '@zmdb/web/pipeline'`.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Typed context](./web-context.html) · [Dependency injection](./web-di.html)
