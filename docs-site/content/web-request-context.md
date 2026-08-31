There is no ambient request context — no `AsyncLocalStorage`, no `RequestContext`, no `@Req()`. `Ctx` is a parameter, and anything a request-scoped value needs to reach must be passed. That is a real constraint with a clean pattern behind it.

## What a handler gets

```ts
export interface Ctx<Params, Body, Query> {
  readonly params: Params;
  readonly body: Body;
  readonly query: Query;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}
```

Six fields. No `signal`, no `user`, no `requestId`, no mutable bag, and no way to write to it — the router builds it and hands it over. There is no facility to attach a field in a guard for a handler to read later.

## Why not `AsyncLocalStorage`

The two costs an ambient context imposes:

- **It is invisible.** A service reading the current tenant from ambient storage has a dependency that does not appear in its signature, so it cannot be tested without a context and cannot be reused outside a request.
- **It leaks across requests when it breaks.** A context lost across an `await` boundary, or a value set on a pooled connection, silently serves one user's data to another. The [Supabase RLS](./deploy-supabase-edge.html) case is the concrete version of this.

So the design is: pass it. Explicit, checked, and testable.

## Threading a value through

```ts
@Get('/posts')
async list(ctx: Ctx<Record<never, string>, unknown>) {
  const tenant = tenantFrom(ctx.headers);
  return this.service.listFor(tenant);
}
```

`tenantFrom` reads and validates a header; `listFor` takes it as an argument. One extra parameter per call in the chain — tedious in a deep stack, and the tedium is the honest cost.

## A per-request driver: the pattern that solves most of it

Where the request-scoped value belongs to the _database session_ rather than to your code, build the driver per request. This is how you get tenant scoping, [row-level security](./deploy-supabase-edge.html), [query tagging](./sql-comments.html), [per-request batching](./dataloaders.html) and per-request query counting — all without ambient state:

```ts
function driverFor(tenant: string): Driver {
  return {
    async execute(query) {
      const client = await pool.connect();
      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant', tenant]);
        const result = await client.query(query.text, [...query.parameters]);
        return result.rows;
      } finally {
        client.release();
      }
    },
  };
}

@Get('/posts')
async list(ctx: Ctx) {
  const repo = defineRepository(posts, driverFor(tenantFrom(ctx.headers)), { dialect: 'postgres' });
  return repo.list({ page: { limit: 20 } });
}
```

Two details that are not optional:

- **`true` in `set_config`** makes the setting transaction-local. With `false` it persists on the pooled connection, and the _next_ request on that connection inherits the previous tenant — a cross-tenant data leak with no error.
- **Build the repository per request.** It is an object over a driver, so this allocation is free. Sharing one repository across tenants defeats the whole arrangement.

## A request-scoped bundle

When several things are request-scoped, one object beats several parameters:

```ts
interface RequestScope {
  readonly tenant: string;
  readonly userId: number;
  readonly requestId: string;
  readonly posts: PostRepo;
}

function scopeFor(ctx: Ctx<Record<string, string>, unknown>): RequestScope {
  const claims = verifyToken(ctx.headers.authorization);
  const driver = driverFor(claims.tenant);
  return {
    tenant: claims.tenant,
    userId: claims.sub,
    requestId: ctx.headers['x-request-id'] ?? crypto.randomUUID(),
    posts: defineRepository(posts, driver, { dialect: 'postgres' }),
  };
}
```

Now handlers take `(ctx)` and build a scope, services take `(scope, args)`, and every dependency is visible in a signature. It tests without a server: construct a scope, call the service.

> [!WARNING]
> Never store request state on a controller or provider field. Both are
> **singletons** — `compileModule` builds each controller once. `this.currentUser =
…` in a handler is a race that serves one user's data to another under
> concurrency, and it will look correct in every single-request test.

## Request ids and logging

```ts
const requestId = ctx.headers['x-request-id'] ?? crypto.randomUUID();
```

Pass it to the driver wrapper so queries carry it, and put it in every log line — that is what makes logs correlatable without ambient storage:

```ts
const driver = withLogging(base, e => console.log(JSON.stringify({ ...e, requestId })));
```

See [Logging](./logging.html) and [SQL Comments](./sql-comments.html).

## If you want ambient storage anyway

Nothing stops you. `AsyncLocalStorage` is a Node built-in and the framework does not interfere:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage<RequestScope>();

// in the adapter, around app.handle
const out = await als.run(scope, () => app.handle(req));
```

It works, and it is not available on Workers or Deno Deploy, so it costs you edge portability. Use it as an addition — for logging correlation, say — rather than as the mechanism your data access depends on.

## What it would take

An optional `Ctx.state` bag plus a place to populate it (guards and pipes, if [the chain were wired into the router](./web-request-lifecycle.html)). The type question is the interesting one: an untyped `Record<string, unknown>` state bag would need a cast at every read, which is exactly what the framework's [assertion policy](./anti-patterns.html) rules out. A typed version means `Ctx<Params, Body, Query, State>` and threading `State` through the router — doable, and a change to a core public type.

---

See also: [Typed Request Context](./web-context.html) · [Injection Scopes](./web-injection-scopes.html) · [DataLoaders](./dataloaders.html)
