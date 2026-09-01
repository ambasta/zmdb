The framework does very little per request, and knowing exactly what it does is what lets you find your own bottleneck instead of guessing at the framework's.

## What happens on a request

1. The adapter builds a `WebRequest` — a string split for the path, headers passed through, body `JSON.parse`d.
2. `Router.handle` counts the path's segments and looks up the routes registered under that method **and** that segment count. Routes that cannot match are never examined.
3. Each candidate's pattern — already resolved into segments and `:param` slots at registration — is matched against the path by character index. A route with no params allocates nothing; one with params allocates the params object and one string per param.
4. Optional body validation (`validateBody`), which is AOT-compiled code, not reflection.
5. The handler runs.
6. `jsonResponse(200, result)` stringifies.

No reflection, no metadata reads, no DI resolution, no middleware chain — controllers are constructed once at `compileModule` and the [chain is not wired in](./web-request-lifecycle.html). The framework overhead is a bucketed match and two JSON operations.

`countMetadataReads` from `@zmdb/web/bench` is the test that keeps this true: decorator metadata is read at registration, not per request, and a regression there shows up as a rising count.

## Matching is bucketed, then first-match

```ts
router.register(PostsController); // /posts/:id
router.register(AdminController); // /posts/admin
```

`GET /posts/admin` matches `/posts/:id` with `id = 'admin'`, because matching is first-match in registration order with no specificity ranking. Register static paths before parameterised ones on the same prefix.

A route can only match a path that agrees on both HTTP method and segment count, and both are known before any comparison happens — so routes are indexed by that pair and a request only ever looks at the handful of routes sharing its shape. Registration order is preserved _within_ a bucket, which is what keeps first-match behaving as above.

The remaining scan is O(routes sharing your method and segment count), not O(all routes). For a table where most routes have two or three segments that is still a small linear scan; at several thousand routes a trie would beat it, and if you are there, group routes across [several apps](./web-multiple-servers.html) rather than one router with thousands of entries.

Route patterns are constants, so their segments and `:param` positions are resolved once by `compilePattern` at registration rather than re-derived per request. If you are writing your own dispatcher on top of `getRoutes`, do the same — `compilePattern` at boot, `matchCompiled` per request. `extractParams(pattern, path)` compiles on every call, which is right for a one-off match and wrong in a hot loop.

## Where the time actually goes

In order of how often it is the answer:

**The database.** Almost always. An N+1 query pattern costs milliseconds per row; the framework costs microseconds per request. Measure queries first — see [Query Performance](./perf-queries.html) for `select` narrowing, [`findAllWithMany`](./loading-strategies.html) for batched relation loading, and [DataLoaders](./dataloaders.html) for the per-request batching pattern.

**Response size.** Serialising a 2MB response costs real CPU in `JSON.stringify` and real time on the wire. `select` the fields you send:

```ts
await repo.list({ select: ['id', 'title'], page: { limit: 20 } });
```

**Awaiting things that could be concurrent.**

```ts
const [post, comments] = await Promise.all([this.posts.findById(id), this.comments.find({ postId: id })]);
```

Two round trips in the time of one. Do not do this inside a transaction on a single connection — the driver serialises them and you gain nothing.

**Validation of very large payloads.** AOT validation is fast (see [JIT vs AOT](./jit-vs-aot.html)) but a 10MB array of objects is still work proportional to its size. Cap request sizes — see [Raw Body](./web-raw-body.html).

## Measuring, not guessing

Wrap the driver, since that is where the time is:

```ts
function timed(inner: Driver): Driver {
  return {
    async execute(query) {
      const start = performance.now();
      try {
        return await inner.execute(query);
      } finally {
        const ms = performance.now() - start;
        if (ms > 50) console.warn(JSON.stringify({ ms: Math.round(ms), text: query.text }));
      }
    },
  };
}
```

Log the SQL text, never the parameters — parameters are user data and frequently personal. See [Logging](./logging.html).

For the handler side, time it in the adapter around `app.handle` and record the path, not the full URL (a URL carries query values, which are also user data).

Then compare: if the request took 120ms and the queries took 115ms, the framework is not your problem.

## Connection pooling is usually the real ceiling

A pool of 10 with a 50ms query tops out around 200 requests/second no matter how fast your code is. Size the pool against your database's connection limit, and remember that serverless multiplies it by instance count — see [Serverless](./perf-serverless.html) and [Connection Pooling](./connect-postgres.html).

Symptoms of pool exhaustion look like framework slowness: latency climbs under load while CPU stays low.

## Node flags worth setting

```bash
NODE_ENV=production node --max-semi-space-size=64 dist/main.js
```

A larger young generation cuts minor GC frequency for allocation-heavy request handling. Measure before and after; the default is fine for most services.

Do not enable a JIT-warmup snapshot or `--jitless` experiments without benchmarking — both have surprised people in the wrong direction.

## What the benchmarks say

The [framework benchmarks](./benchmarks.html) place `@zmdb/web` against 17 peers on the same machine, and the numbers there are the honest ones: routing overhead is not where a real application spends its time, which is exactly why the framework spends so little effort on it and so much on the query layer.

---

See also: [Query Performance](./perf-queries.html) · [Benchmarks](./benchmarks.html) · [Request Lifecycle](./web-request-lifecycle.html)
