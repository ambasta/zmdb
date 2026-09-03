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

## What it will take: nothing, and that is the frozen answer

The GraphQL design is frozen in `packages/web/src/graphql/SPEC.md`, and **there is no `ServerPlugin`**. That is a decision with reasons rather than a deferral, and it came from working backwards from the hooks such an interface would carry. Every one of them turned out to be impossible here, already yours, or a second name for something that exists:

| The hook a plugin API would need | Why it is not there                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `onParse(document)`              | Nothing in `@zmdb/web` parses. Your controller calls `parse` — see [Resolvers](./web-graphql-resolvers.html).           |
| `onValidate(context)`            | Its argument is `ValidationContext`, a `graphql` class, and the design has no `graphql` dependency to name it with.     |
| `onRequest` / `onResponse`       | Yours already: the `/graphql` route is an ordinary `@zmdb/web` route, with the ordinary guards, pipes and interceptors. |
| `onExecute(ctx, next)`           | That signature **is** `Interceptor.intercept(ctx, next)`, and the field chain already calls it in the right place.      |
| a complexity hook                | [`complexityOf`](./web-graphql-complexity.html) is a function your controller calls between `parse` and `execute`.      |

So the conclusion of this page's own second section holds all the way through the design: **wrap the thing you want to observe.** A second extension mechanism aliasing the first is how two ways to do one thing get documented, diverge, and then disagree about ordering — with interceptors and plugins specifically, about which one wraps the other.

What does change is per-field granularity. A chain can be declared globally, per type, or on a single field, and the three layers are flattened once at registration into one chain per field, so `Post.authorEmail` can carry a guard that `Query.post` does not. See [Field Middleware](./web-graphql-field-middleware.html).

An Apollo or envelop plugin still works, unchanged, because it plugs into the engine you constructed. Not owning the transport is what makes that true.

Independently useful and still not built: wiring `runChain` into the router so interceptors apply to HTTP routes without hand-rolled invocation, and a documented observation point around `app.handle`. The caveat in the section above is about the router, and the GraphQL freeze does not lift it — the field chain calls `runChain`; the router still does not.

---

See also: [Interceptors](./web-middleware.html) · [Observability](./web-observability.html) · [Caching](./web-caching.html)
