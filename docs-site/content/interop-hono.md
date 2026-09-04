Hono is a small, fast, standards-based router. `@zmdb/web`'s `App` exposes `fetch(request)` and `handle(req)` and owns no server, which makes the two compose rather than compete — you can mount zmdb inside Hono, or use zmdb's data layer under Hono routes and skip `@zmdb/web` entirely.

## zmdb data layer, Hono routes

The lightest combination, and a good default if you already like Hono:

```ts
import { Hono } from 'hono';
import { assert } from '@zmdb/aot-validator/utilities';
import type { CreateDTO } from '@zmdb/repository';

const api = new Hono();

api.get('/posts', async c => c.json(await postRepo.list({ page: { limit: 20 } })));

api.post('/posts', async c => {
  const dto = assert<CreateDTO<Post>>(await c.req.json());
  return c.json(await postRepo.create(dto), 201);
});
```

No decorators, no container, no `@zmdb/web` at all. The schema, compiler, repository and validators are independent of the web package.

## Mount `@zmdb/web` inside Hono

Because `App.fetch` takes and returns web-standard `Request`/`Response`, it mounts as a Hono handler:

```ts
const zmdbApp = createApp(AppModule);
await zmdbApp.init();

const hono = new Hono();
hono.all('/api/*', c => zmdbApp.fetch(c.req.raw));
hono.get('/health', c => c.text('ok'));
```

Use this when you want zmdb's DI and OpenAPI for the API surface and Hono's middleware for everything around it — CORS, static assets, compression, streaming.

> [!NOTE]
> Your controllers see the full path, so a controller behind `/api/*` must be
> declared as `@Controller('/api/posts')`. `App` does not know it is mounted and
> does not strip a prefix.

## Hono middleware fills real gaps

This is the strongest argument for the combination. Several cross-cutting
features `@zmdb/web` does not ship are one Hono middleware away:

| Gap in `@zmdb/web`                      | Hono            |
| --------------------------------------- | --------------- |
| [Compression](./web-compression.html)   | `compress()`    |
| [Static files](./web-static-files.html) | `serveStatic()` |
| [CSRF](./web-csrf.html)                 | `csrf()`        |
| Rate limiting, CORS, secure headers     | middleware      |

Put those outside the mount, where Hono owns the `Response`.
For an application-owned response stream, `@zmdb/web` itself provides
`stream()`.

## Choosing between them

|                      | Hono                    | `@zmdb/web`                        |
| -------------------- | ----------------------- | ---------------------------------- |
| Runtime dependencies | `hono`                  | zero                               |
| Style                | functional handlers     | classes + decorators               |
| DI container         | none                    | [built-in](./web-di.html)          |
| Modules              | none                    | [module graph](./web-modules.html) |
| OpenAPI              | via `@hono/zod-openapi` | [native](./openapi.html)           |
| Streaming            | yes                     | no                                 |
| Middleware ecosystem | large                   | none                               |

If your application is a handful of routes, Hono plus zmdb's data layer is less machinery. If it has services, layered dependencies and a generated API contract, `@zmdb/web` earns its structure.

## Validation

`assert<T>` works as a Hono validator with no adapter:

```ts
api.post('/posts', async c => {
  const dto = assert<CreateDTO<Post>>(await c.req.json());
  // ...
});
```

Catch the throw in `app.onError` and map it to a 400. And as always — [without the transformer](./aot-setup.html) that call validates nothing and returns the body unchanged, so:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

## On the edge

Hono targets Workers, Deno and Bun; so does zmdb's read path, with an [HTTP driver](./perf-serverless.html). Two cautions for Bun and React Native: the AOT transformer does not run under their transpilers, so the canary above is not optional — see [Bun](./connect-bun.html) and [React Native](./connect-react-native.html).

---

See also: [Standalone Applications](./web-standalone.html) · [Streaming](./streaming.html) · [Serverless Performance](./perf-serverless.html)
