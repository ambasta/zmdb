A guide to the errors this framework actually produces, and the ones that produce no error at all — which are the dangerous half.

## `is<T>()` returns `true` for invalid input

**The most important entry on this page.** The AOT transformer did not run, and validation **fails open**.

```ts
is<{ id: number }>({ id: 'not a number' }); // true — the transformer is absent
```

Causes, in order of frequency: running with `--experimental-strip-types` or `ts-node`; a bundler that does not invoke the transformer (esbuild, SWC, Bun, Metro, Turbopack, Deno); a build that skipped the plugin configuration.

The fix is a test that fails loudly:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Run it in CI against the **built artefact**, not the source. See [JIT vs AOT](./jit-vs-aot.html) and [Deployment](./web-deployment.html).

## `UnresolvedTokenError: <description>`

The container has no registration for that token. Three usual causes:

- The provider is in a module that nothing `imports`. `compileModule` walks the graph from the root only.
- You are resolving from the wrong container — two `createApp` calls give two containers.
- The token was created twice. `createToken<T>('POSTS')` called in two files gives two distinct tokens with the same description, and they do not match. Export the token from one module.

The error names the token's description, which is why a meaningful description pays off — `createToken<Repo>('token')` produces an unhelpful message.

## `@zmdb/web: import cycle detected in the module graph`

Two modules import each other. The message does not name them, which is the rough edge; bisect by commenting out `imports` entries.

Usually the fix is to extract the shared providers into a third module both import, rather than to break the cycle by moving a controller.

## A 404 for a route you registered

Two candidates.

**A more general route matched first.** Matching is first-match in registration order with no specificity ranking:

```ts
router.register(PostsController); // /posts/:id
router.register(AdminController); // /posts/admin  — unreachable
```

`GET /posts/admin` matches `/posts/:id` with `id = 'admin'`. Register static paths before parameterised ones. Print the table to see the order:

```ts
for (const C of CONTROLLERS) for (const r of getRoutes(C)) console.log(r.method, r.path, r.handlerName);
```

**The path is not what you think.** `@Controller` and the method decorator compose, duplicate slashes collapse and a trailing slash is stripped. `@Controller('/posts/')` plus `@Get('/:id')` gives `/posts/:id`, but check rather than assume.

## `ctx.query` is always empty

The bundled adapters do **not** populate `query` — `toNodeHandler` and `toFetchHandler` both leave it undefined. Parse it yourself and pass it in:

```ts
const url = new URL(req.url ?? '/', 'http://localhost');
const query = Object.fromEntries(url.searchParams);
```

See [Typed Request Context](./web-context.html).

## `ctx.body` is a string when you expected an object

The adapter's parse falls back to the raw string on a `JSON.parse` failure — it does not throw and does not check `content-type`. A malformed body, or a form-encoded one, arrives as a string.

Validate at the top of the handler and the failure becomes a 400 instead of a confusing `undefined` deeper in:

```ts
const dto = assert<CreateDTO<typeof posts>>(ctx.body);
```

See [Raw Body](./web-raw-body.html).

## A 500 where you threw a 403

`ChainError(403, …)` reaching the router serialises as a 500. The router produces exactly four outcomes — 200 (returned), 400 (threw something with `issues`), 404 (no route), 500 (anything else) — and a handler cannot choose. `ExceptionFilter.catch` returns a `WebResponse` the router never sees, because **the router does not call `runChain`**.

Throw a `ValidationError` (which has `issues`) for a 400, and map other statuses in your adapter. See [Request Lifecycle](./web-request-lifecycle.html).

## `this.repo is undefined` in a handler

`@Inject` is a **field** decorator, and `container.build(Ctor)` calls `new Ctor()` with no arguments. Constructor injection does not exist:

```ts
// wrong — the parameter is never supplied
constructor(@Inject(POSTS) private readonly repo: PostRepo) {}
```

```ts
// right
@Inject(POSTS) private readonly repo!: PostRepo;
```

See [Dependency Injection](./web-di.html).

## Request state from another user appears

Controllers and providers are **singletons** — `compileModule` builds each once. `this.currentUser = …` in a handler is a race that serves one user's data to another, and it looks correct in every single-request test.

Keep request state in local variables or a [per-request object](./web-request-context.html), never on an instance field.

## Every query returns the previous tenant's rows

`set_config('app.tenant', value, false)` on a pooled connection persists after the request, and the next request on that connection inherits it. The third argument must be `true` (transaction-local):

```ts
await client.query('SELECT set_config($1, $2, true)', ['app.tenant', tenant]);
```

A cross-tenant data leak with no error. See [Request Context](./web-request-context.html).

## `UnsupportedFeatureError`

The query compiler cannot express something in the target dialect. Check the [dialect pages](./dialect-postgres.html) for what each supports; the common cases are features that exist in Postgres and not in SQLite or MySQL.

## `ValidationError` with an empty `issues` array

You constructed it that way — `new ValidationError('message', [])`. The router treats anything with an `issues` property as a 400, so this is the idiomatic way to signal a client error, and an empty array is fine. Validator-produced errors populate `issues` with paths.

## The process will not exit after a script

An open connection pool holds the event loop. `App` is `AsyncDisposable`:

```ts
await using app = createApp(AppModule);
await app.init();
```

Or dispose explicitly and call `pool.end()`. See [Standalone Applications](./web-standalone.html).

## A migration applied twice, or deadlocked

Migrations were run on application boot with several replicas, each racing the same statement. Run them as a separate deployment step. See [Migrations](./migrations.html).

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [JIT vs AOT](./jit-vs-aot.html) · [FAQ](./faq.html)
