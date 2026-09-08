There is no `RouterModule` and no `forRoutes` configuration. A route's path is the controller prefix plus the method path, composed once by the decorators — so prefixing is a string, not a
registration API.

## How paths compose

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies Controller, Get, Post; this excerpt does not repeat those declarations."}
@Controller('/posts')
export class PostsController {
  @Get('/') list() {} // GET /posts
  @Get('/:id') byId() {} // GET /posts/:id
  @Post() create() {} // POST /posts
}
```

`@Controller(prefix)` and the method path are joined, duplicate slashes collapse, and a trailing slash is stripped. `@Controller()` with no prefix and `@Get()` with no path both work:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies Controller, Get; this excerpt does not repeat those declarations."}
@Controller()
class HealthController {
  @Get('/health') health() {} // GET /health
  @Get() root() {} // GET /
}
```

## Versioning can expand a prefix

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies Controller, Version, createRouter; this excerpt does not repeat those declarations."}
@Version('1', '2')
@Controller('/posts')
export class PostsController {
  /* … */
}

const router = createRouter({ versioning: { kind: 'path', prefix: 'v' } });
router.register(new PostsController());
```

This registers `/v1/posts` and `/v2/posts` at startup. Header and media-type strategies use the same `@Version` declaration with a different `createRouter({ versioning })` option; see
[API Versioning](./web-versioning.html).

Manual prefixes remain valid, including when a shared constant keeps them consistent:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies Controller; this excerpt does not repeat those declarations."}
const V1 = '/api/v1';

@Controller(`${V1}/posts`)
export class PostsController {}
```

## Mounting under a base path

The application does not know it is mounted, and nothing strips a prefix. So if your platform routes `/api/*` to the app, your controllers must include `/api`:

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies Controller; this excerpt does not repeat those declarations."}
@Controller('/api/posts')
export class PostsController {}
```

Alternatively strip it in the adapter, which keeps the controllers clean and is usually better:

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies app, req; this excerpt does not repeat those declarations."}
const out = await app.handle({ ...req, path: req.path.replace(/^\/api/, '') || '/' });
```

Pick one and be consistent — doing both gives you `/api/api/posts`, which produces a 404 and no clue.

## Route order matters

Routes are scanned in registration order and the **first** match wins. There is no specificity ranking:

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies Controller, Get; this excerpt does not repeat those declarations."}
@Controller('/posts')
class C {
  @Get('/:id') byId() {}
  @Get('/latest') latest() {} // unreachable
}
```

`/posts/latest` matches `/:id` first, with `params.id === 'latest'`. Declare literal paths before parameterised ones, within a controller and across controllers — the order across controllers is the
order of the `controllers` array in `@Module`.

This is the single most common routing bug in this framework. See [Request Lifecycle](./web-request-lifecycle.html).

## Grouping by module

Modules organise providers and controllers; they do not scope paths:

```ts {"mode":"illustrative","id":"example-008","reason":"The surrounding example supplies CommentsController, InvoicesController, Module, PostsController; this excerpt does not repeat those declarations."}
@Module({ controllers: [PostsController, CommentsController] })
export class BlogModule {}

@Module({ controllers: [InvoicesController] })
export class BillingModule {}

@Module({ imports: [BlogModule, BillingModule] })
export class AppModule {}
```

There is no `@Module({ prefix: '/blog' })`. The prefix lives on each `@Controller`, which means it is visible where the routes are and there is no second place to look.

## Splitting a large surface

Two applications, chosen in the adapter, when the split is genuinely separate — different auth, different exposure, different lifecycle:

```ts {"mode":"illustrative","id":"example-009","reason":"The surrounding example supplies AdminModule, PublicModule, WebRequest, createApp; this excerpt does not repeat those declarations."}
const publicApp = createApp(PublicModule);
const adminApp = createApp(AdminModule);
await Promise.all([publicApp.init(), adminApp.init()]);

const handler = (req: WebRequest) => (req.path.startsWith('/admin') ? adminApp.handle(req) : publicApp.handle(req));
```

Nothing is global, so this works. Two containers means shared providers are built twice — keep the pool and driver in a module-scope value both import. See
[Multiple Servers](./web-multiple-servers.html).

## Path parameters

`extractParams` matches `:name` segments and yields strings:

```ts {"mode":"illustrative","id":"example-010","reason":"This decorator or member excerpt omits its containing class and the application-owned declarations it uses."}
@Get('/:id/comments/:commentId')
async comment(ctx: Ctx<{ id: string; commentId: string }>) {
  return this.repo.findById(Number(ctx.params.commentId));
}
```

`PathParams<'/posts/:id'>` derives the params type from a path literal if you would rather not restate it. Everything is a `string`, so coerce and check — `Number('abc')` is `NaN`, and `NaN` is a
`number` that passes a type check and reaches your database as a nonsense parameter.

There are no optional segments, no wildcards, no regex constraints and no catch-all patterns. A `/*` route is not expressible; handle unmatched paths in the adapter, where the router's 404 arrives.

---

See also: [Controllers & Routing](./web-controllers.html) · [Request Lifecycle](./web-request-lifecycle.html) · [Multiple Servers](./web-multiple-servers.html)
