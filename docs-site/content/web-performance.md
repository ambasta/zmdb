The framework does very little per request, and knowing exactly what it does is what lets you find your own bottleneck instead of guessing at the framework's.

## What happens on a request

1. The adapter builds a `WebRequest` — the path read off the URL by index, headers flattened, body `JSON.parse`d. A request whose framing headers say it has no body skips the stream listeners entirely
   and dispatches straight away.
2. `Router.handle` counts the path's segments. An unversioned or path-versioned router looks up method + segment count; header and media-type routers first select the requested version, then look up
   method + version + segment count. Routes that cannot match are never examined.
3. Each candidate's pattern — already resolved into segments and `:param` slots at registration — is matched against the path by character index. A route with no params allocates nothing; one with
   params allocates the params object and one string per param.
4. Optional body validation (`validateBody`), which is AOT-compiled code, not reflection.
5. The handler runs.
6. `jsonResponse(200, result)` stringifies.

For eager or already-loaded routes there is no reflection, metadata read or DI resolution on the request path, and the [chain is not wired in](./web-request-lifecycle.html). The first request to a
lazy route waits for that subtree's one-time construction and lifecycle hooks; later requests use the same cached handler path. Steady-state framework overhead is version selection when configured, a
bucketed match and two JSON operations.

The repository-private `countMetadataReads` probe keeps this true: the web correctness suite asserts that decorator metadata is read at registration, not per request, and a regression appears as a
rising count.

## Matching is bucketed, then first-match

```ts
router.register(PostsController); // /posts/:id
router.register(AdminController); // /posts/admin
```

`GET /posts/admin` matches `/posts/:id` with `id = 'admin'`, because matching is first-match in registration order with no specificity ranking. Register static paths before parameterised ones on the
same prefix.

A route can only match a path that agrees on HTTP method and segment count, and a header/media route must also agree on the selected version. Those values are known before any path comparison, so a
request only looks at the handful of routes sharing its bucket. Registration order is preserved _within_ a bucket, which is what keeps first-match behaving as above.

The remaining scan is O(routes sharing your method and segment count), or method, version and segment count for header/media strategies — never O(all routes). For a table where most routes have two or
three segments that is still a small linear scan; at several thousand routes a trie would beat it, and if you are there, group routes across [several apps](./web-multiple-servers.html) rather than one
router with thousands of entries.

Route patterns are constants, so their segments and `:param` positions are resolved once by `compilePattern` at registration rather than re-derived per request. If you are writing your own dispatcher
on top of `getRoutes`, do the same — `compilePattern` at boot, `matchCompiled` per request. `extractParams(pattern, path)` compiles on every call, which is right for a one-off match and wrong in a hot
loop.

## Where the time actually goes

In order of how often it is the answer:

**The database.** Almost always. An N+1 query pattern costs milliseconds per row; the framework costs microseconds per request. Measure queries first — see [Query Performance](./perf-queries.html) for
`select` narrowing, [`findAllWithMany`](./loading-strategies.html) for batched relation loading, and [DataLoaders](./dataloaders.html) for the per-request batching pattern.

**Response size.** Serialising a 2MB response costs real CPU in `JSON.stringify` and real time on the wire. `select` the fields you send:

```ts
await repo.list({ select: ['id', 'title'], page: { limit: 20 } });
```

**Awaiting things that could be concurrent.**

```ts
const [post, comments] = await Promise.all([this.posts.findById(id), this.comments.find({ postId: id })]);
```

Two round trips in the time of one. Do not do this inside a transaction on a single connection — the driver serialises them and you gain nothing.

**Validation of very large payloads.** AOT validation is fast (see [JIT vs AOT](./jit-vs-aot.html)) but a 10MB array of objects is still work proportional to its size. Cap request sizes — see
[Raw Body](./web-raw-body.html).

**Node's HTTP stack, and not this framework.** Worth knowing before you tune anything here. Measured on one 16-core box, 8 workers, `GET /`, keep-alive off, c=256, median of 3, each layer adding one
thing to the one above it:

| layer                                  |   req/s | that layer's cost                               |
| -------------------------------------- | ------: | ----------------------------------------------- |
| raw TCP (`net`, canned response bytes) | 152,748 | the kernel's accept/close floor                 |
| bare `node:http`, `res.end()`          | 114,438 | −38,310 (25%) — parser + stream objects         |
| bare `node:http` + `writeHead({…})`    | 103,407 | −11,031 (10%) — serialising one header          |
| a full routed app                      | 102,651 | −756 (**0.7%**) — routing, dispatch, validation |

Everything the framework does is under 1% of the budget and `node:http` is a quarter of it. So if you are chasing throughput, the levers are the process count (below), keep-alive, and how many headers
and bytes you send — not the router.

## Measuring, not guessing

Wrap the driver, since that is where the time is:

```ts
function timed(inner: Driver): Driver {
  return {
    ...inner,
    async execute(query, options) {
      const start = performance.now();
      try {
        return await inner.execute(query, options);
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

A pool of 10 with a 50ms query tops out around 200 requests/second no matter how fast your code is. Size the pool against your database's connection limit, and remember that serverless multiplies it
by instance count — see [Serverless](./perf-serverless.html) and [Connection Pooling](./connect-postgres.html).

Symptoms of pool exhaustion look like framework slowness: latency climbs under load while CPU stays low.

## Node flags worth setting

```bash
NODE_ENV=production node --max-semi-space-size=64 dist/main.js
```

A larger young generation cuts minor GC frequency for allocation-heavy request handling. Measure before and after; the default is fine for most services.

Do not enable a JIT-warmup snapshot or `--jitless` experiments without benchmarking — both have surprised people in the wrong direction.

## Using more than one core

Node runs your handlers on one thread, so a single process uses one core no matter how many the box has. To use the rest, run more processes — but set the accept policy first:

```ts
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

cluster.schedulingPolicy = cluster.SCHED_NONE; // before any fork

if (cluster.isPrimary) {
  for (let i = 0; i < availableParallelism(); i += 1) cluster.fork();
} else {
  createServer(toNodeHandler(router)).listen(3000);
}
```

`node:cluster` defaults to `SCHED_RR`, where the **primary** accepts every connection and hands it to a worker over IPC. That primary is single-threaded, so it becomes the ceiling and extra workers
buy almost nothing — in the [benchmark harness](./benchmarks.html) it measured flat across an 8× concurrency range. `SCHED_NONE` lets each worker accept from the shared socket itself and roughly
doubled throughput. `listen({ port, reusePort: true })` per worker is an equivalent alternative.

Expect **sublinear** scaling: in the harness, 8 workers returned 3.58× one worker, and per-core throughput fell at every step. Connection setup and teardown is the part that does not parallelise well,
so the gain is largest when keep-alive is on and connections are reused. Measure on your own box rather than assuming `nproc` workers is best — past a point the processes compete for the same cores as
everything else on the machine.

## What the benchmarks say

The [framework benchmarks](./benchmarks.html) place `@zmdb/web` against 17 peers on the same machine, and the numbers there are the ones: routing overhead is not where a real application spends its
time, which is exactly why the framework spends so little effort on it and so much on the query layer.

---

See also: [Query Performance](./perf-queries.html) · [Benchmarks](./benchmarks.html) · [Request Lifecycle](./web-request-lifecycle.html)
