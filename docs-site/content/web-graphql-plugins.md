> **ToDo / feature gap.** There is no GraphQL layer, so there is no plugin system —
> no Apollo `ApolloServerPlugin`, no envelop plugins, no request lifecycle events to
> hook.

## What plugins are used for

Almost always one of four things, and each has a home in a zmdb application.

| Plugin's job                   | Where it goes here                                                       |
| ------------------------------ | ------------------------------------------------------------------------ |
| Logging and timing per request | a driver wrapper + the adapter — [Logging](./logging.html)               |
| Metrics and tracing            | [Observability](./web-observability.html), [Tracing](./web-tracing.html) |
| Depth / complexity limits      | [Query Complexity](./web-graphql-complexity.html)                        |
| Response caching               | [Caching](./web-caching.html)                                            |

The pattern behind all four is the same and worth stating plainly: **wrap the thing you want to observe**. There is no plugin registry because there is no need for one — the framework's extension points are interfaces you decorate.

## The driver wrapper is the highest-value hook

Where a plugin observes GraphQL operations, a driver wrapper observes every query from every surface — REST, GraphQL, a worker, a CLI backfill:

```ts
export function instrumented(inner: Driver, sink: (e: QueryEvent) => void): Driver {
  return {
    async execute(query) {
      const start = performance.now();
      try {
        const rows = await inner.execute(query);
        sink({ ms: performance.now() - start, sql: query.text, rows: rows.length, ok: true });
        return rows;
      } catch (error) {
        sink({ ms: performance.now() - start, sql: query.text, rows: 0, ok: false });
        throw error;
      }
    },
  };
}
```

Composable, because each wrapper returns a `Driver`:

```ts
const driver = instrumented(traced(retrying(base)), sink);
```

That composition is the plugin system, and it is checked by the compiler rather than by a registration order.

> [!WARNING]
> Log `query.text`, never `query.parameters`. The compiled SQL contains
> placeholders — that is the point of `CompiledQuery` — while the parameters are user
> data: emails, tokens, personal detail. Log `query.parameters.length` if you need
> shape information.

## Middleware interfaces that do exist

`@zmdb/web/middleware` defines `Guard`, `Pipe`, `Interceptor` and `ExceptionFilter`, and `runChain` composes them. An `Interceptor` is the closest thing to a plugin:

```ts
export const timing: Interceptor = {
  async intercept(ctx, next) {
    const start = performance.now();
    try {
      return await next();
    } finally {
      console.log(JSON.stringify({ path: ctx.path, ms: Math.round(performance.now() - start) }));
    }
  },
};
```

With the caveat that matters: **the router does not call `runChain`**. Interceptors run only where you invoke the chain yourself. See [Request Lifecycle](./web-request-lifecycle.html) and [Interceptors](./web-middleware.html).

## If you are running a GraphQL server today

Use its own plugin system — it is unaffected by zmdb, and the two layers compose:

```ts
const yoga = createYoga({
  schema,
  plugins: [useDepthLimit({ maxDepth: 10 }), useDisableIntrospection({ disable: isProduction })],
});
```

Instrument the data layer with a driver wrapper and the transport with the server's plugins. That division is clean: the driver sees queries, the plugin sees operations, and neither duplicates the other.

## Response caching, carefully

The one plugin category where the GraphQL version is genuinely hard to replicate, and also the one most likely to leak data.

```ts
const key = `${operationName}:${hash(variables)}:${viewer.id}`;
```

The `viewer.id` in the key is not optional. A cache keyed on the query and variables alone serves one user's authorised result to another — and because GraphQL fields are authorised individually, the same query text legitimately returns different data per viewer. That is the single most common cache-poisoning bug in GraphQL deployments.

Prefer caching at the data layer, where the key is a row and a tenant, over caching whole responses. See [Caching](./web-caching.html).

## What it would take

A plugin system presupposes a GraphQL request lifecycle, so this follows [the GraphQL layer](./web-graphql-resolvers.html).

Independently useful, and much smaller: wiring `runChain` into the router so interceptors apply without hand-rolled invocation, and a documented observation point around `app.handle`. Those two would give the framework the extension surface a plugin API provides, for every surface rather than one.

---

See also: [Interceptors](./web-middleware.html) · [Observability](./web-observability.html) · [Caching](./web-caching.html)
