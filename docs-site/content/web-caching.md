There is no `CacheModule` and no implicit query cache — a hidden cache is state you did not ask for, and the wrong answer served fast is worse than the right answer served slowly. Caching here is explicit, and the layer you choose matters more than the code.

## Where to cache

| Layer               | Keyed on            | Good for                          |
| ------------------- | ------------------- | --------------------------------- |
| CDN / reverse proxy | URL + `vary`        | public, unauthenticated responses |
| A store you inject  | whatever you decide | per-tenant or per-user results    |
| In-process `Map`    | same                | small, hot, tolerant of staleness |

The first row is where most caching belongs, and it needs no application code. A CDN caches once and serves everyone; an application cache repeats the work per instance.

## An interceptor

`Interceptor.intercept(ctx, next)` returns `Promise<unknown>` — it wraps the **handler's return value**, not a `WebResponse`:

```ts
import type { Interceptor } from '@zmdb/web/middleware';

export function cached(store: KV, ttlMs = 5_000): Interceptor {
  return {
    async intercept(ctx, next) {
      if (ctx.method !== 'GET') return next();

      const key = cacheKey(ctx);
      const hit = await store.get(key);
      if (hit !== undefined) return JSON.parse(hit);

      const result = await next();
      await store.set(key, JSON.stringify(result), ttlMs);
      return result;
    },
  };
}
```

> [!WARNING]
> **The router does not call `runChain`.** Registering a controller applies no
> interceptors — you invoke the chain inside the handler. See
> [Request Lifecycle](./web-request-lifecycle.html).

```ts
@Get('/')
list(ctx: Ctx<Record<never, string>, unknown>) {
  return runChain({ guards: [], pipes: [], interceptors: [cached(store)], filters: [] }, ctx, () =>
    this.repo.list({ page: { limit: 20 } }),
  );
}
```

Also note that a handler cannot set a response header, so an `x-cache: HIT` marker is not available from here. Add it in your adapter if you want one.

## The cache key is the whole risk

```ts
function cacheKey(ctx: Ctx<Record<string, string>, unknown>): string {
  const viewer = viewerFrom(ctx.headers); // authenticated identity
  return `${ctx.method}:${ctx.path}:${viewer.tenant}:${viewer.id}`;
}
```

> [!WARNING]
> A key that omits the authenticated identity serves one user's data to another.
> This is the most common caching vulnerability and it is invisible in testing,
> because a single-user test always hits its own entry. If a response depends on who
> asked, the asker is part of the key.

Two related traps:

- **`ctx.query` is not populated by the bundled adapters.** Building a key from it silently gives you one entry for every distinct query string — which is to say, one entry. Parse the query in your adapter and pass it through, or key on `ctx.path` only. See [Typed Request Context](./web-context.html).
- **Never cache a response containing a token, a session id or a `set-cookie` value.** A cache is a shared store and frequently less access-controlled than your database.

## Cache rows, not responses

Usually better. A row cache has a natural key and a natural invalidation point:

```ts
export function cachingDriver(inner: Driver, store: KV, ttlMs: number): Driver {
  return {
    async execute(query) {
      if (!/^\s*SELECT/i.test(query.text)) return inner.execute(query);
      const key = `q:${hash(query.text)}:${hash(JSON.stringify(query.parameters))}`;
      const hit = await store.get(key);
      if (hit !== undefined) return JSON.parse(hit);
      const rows = await inner.execute(query);
      await store.set(key, JSON.stringify(rows), ttlMs);
      return rows;
    },
  };
}
```

Because it is a `Driver`, it composes with the other wrappers and covers every surface — handlers, workers, a CLI backfill. Build it [per request with the tenant baked into the driver](./web-request-context.html) and the tenant is in the key by construction rather than by remembering.

Hash the parameters into the key rather than storing them; do not log either.

## Invalidation

Pick one, deliberately:

- **A short TTL.** Simplest and usually right. Five seconds absorbs a traffic spike and nobody notices the staleness.
- **Delete on write**, in the same service method that writes. Reliable in one process, and stale on other replicas — you need `LISTEN/NOTIFY` or Redis pub/sub to reach them. See [Events](./web-events.html).
- **Version the key** (`posts:v3:…`) and bump the version on deploy. Avoids stale entries surviving a schema change, which is a genuinely nasty class of bug.

An in-process `Map` with no eviction is a memory leak. Cap it, or use a store that expires.

## Do not cache

A write response, anything personalised without the identity in the key, or a result you cannot afford to be stale. When in doubt, narrow the query with `select` instead — a fast query needs no cache. See [Query Performance](./perf-queries.html).

---

See also: [Interceptors](./web-middleware.html) · [Query Performance](./perf-queries.html) · [Request Context](./web-request-context.html)
