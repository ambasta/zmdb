`WebApplication.fetch` is a `(Request) => Promise<Response>`, which is the interface every serverless and edge platform accepts. There is no adapter package to install and no platform-specific build.

```ts
import { createApp } from '@zmdb/web';

const app = createApp(AppModule);
await app.init();
export default { fetch: (request: Request) => app.fetch(request) };
```

## Build the app once, outside the handler

```ts
// right — module scope, reused across invocations
const app = createApp(AppModule);
await app.init();
const handler = (request: Request) => app.fetch(request);
export default { fetch: handler };
```

```ts
// wrong — rebuilds the container on every request
export default {
  async fetch(request: Request) {
    const app = createApp(AppModule);
    await app.init();
    return app.fetch(request);
  },
};
```

The second form re-runs `compileModule`, reconstructs every eager controller and re-runs every eager lifecycle hook per request. Any lazy module reached by that request is then reconstructed too. It
also creates a new connection pool per request, which exhausts the database's connection limit faster than anything else you can do.

Module scope persists across invocations on a warm instance on every platform. Use it.

## Cold starts

The framework performs a bounded declaration-validation pass at startup, with no filesystem scan or dynamic imports. A lazy import can defer provider and controller construction, but not the bytes of
the module that declared them, so cold starts are still dominated by bundle size and application initialisation.

- **Do not connect at module scope.** `await pool.connect()` at import time adds network latency to every cold start. Use a factory provider so the first query opens the connection.
- **Keep the bundle small.** `tsup` with `treeshake` and no unnecessary imports. A 5MB bundle costs real cold-start time.
- **Do not run migrations on boot.** Ever, but especially here: with concurrency, several instances race the same migration.

## Connections are the real problem

This is the constraint that shapes every serverless deployment, and it is not framework-specific.

A pool of 10 per instance and 100 concurrent instances is 1,000 connections. Postgres defaults to 100 and each one costs several megabytes of server memory, so you hit the ceiling and every instance
starts failing to connect.

| Platform           | Use                                                         |
| ------------------ | ----------------------------------------------------------- |
| Vercel + Postgres  | Supabase pooler / Neon pooled endpoint / `@vercel/postgres` |
| Cloudflare Workers | Hyperdrive, or an HTTP-based driver                         |
| Lambda             | RDS Proxy, or a pooler on the VPC                           |
| Deno Deploy        | a pooled endpoint (no raw TCP fan-out)                      |

With a pooler in front, set `max: 1` per instance. The pooler multiplexes; a per-instance pool is counterproductive when instance count is the thing that scales.

```ts
new Pool({ connectionString: env.POOLED_URL, max: 1 });
```

Note that transaction-mode poolers do not support session state — see [Connection Pooling](./connect-postgres.html) and [Transactions](./transactions.html). `set_config(..., true)` (transaction-local)
is fine; `SET` without a transaction is not.

## Workers and Deno have no TCP

Cloudflare Workers and Deno Deploy cannot open a raw TCP socket to Postgres. You need an HTTP-speaking driver — Neon's serverless driver, Supabase's REST layer, or Hyperdrive — behind zmdb's `Driver`
interface:

```ts
const driver: Driver = {
  async execute(query) {
    const response = await fetch(env.SQL_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.SQL_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: query.text, parameters: query.parameters }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`sql endpoint ${response.status}`);
    return assert<readonly Record<string, unknown>[]>(await response.json());
  },
};
```

`Driver` has one required method, which is why any transport works. See [Custom Driver](./custom-driver.html).

## The transformer must run in your build

Serverless builds are the most common place for the AOT transformer to be silently absent, because platforms often use their own bundler (esbuild on Vercel, Deno's own pipeline, Bun on some hosts).
When it does not run, validation **fails open** — invalid input passes.

Ship the canary as a test and run it in the same build that produces your deployment artefact:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

If your platform builds from source rather than from your artefact, prebuild locally or in CI and deploy the output. See [JIT vs AOT](./jit-vs-aot.html).

## Timeouts and background work

Every platform kills the invocation when the response is returned or the limit is reached. Work started and not awaited is dropped — sometimes silently.

```ts
void this.events.emit('post.created', { id }); // may never run on serverless
```

Use the platform's mechanism (`ctx.waitUntil` on Workers) or, better, the [outbox](./transactional-outbox.html) with a cron-triggered drain. The outbox is the only version that survives an instance
being frozen mid-work.

## No `AsyncLocalStorage` on the edge

Workers do not provide it. Since zmdb has [no ambient request context](./web-request-context.html) either, the per-request driver pattern is the portable approach — and it is the one that works
everywhere.

---

See also: [Serverless Performance](./perf-serverless.html) · [Vercel](./deploy-vercel.html) · [Connection Pooling](./connect-postgres.html)
