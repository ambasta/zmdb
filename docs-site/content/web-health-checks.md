> **ToDo / feature gap.** There is no health check module — no `TerminusModule`,
> no `@HealthCheck`, no built-in indicators. There is also no `Driver.ping()`.

Writing one is a controller and a query, and doing it yourself avoids the two mistakes health-check libraries encourage.

## A liveness and a readiness probe

They answer different questions, and conflating them causes outages.

```ts
@Controller('/health')
export class HealthController {
  @Inject(DRIVER) private readonly driver!: Driver;

  @Get('/live')
  live() {
    return { status: 'ok' };
  }

  @Get('/ready')
  async ready() {
    const start = performance.now();
    await this.driver.execute({ text: 'SELECT 1', parameters: [] });
    return { status: 'ok', db: Math.round(performance.now() - start) };
  }
}
```

**Liveness** asks "is this process wedged?" It must not touch a dependency. If liveness checks the database and the database has a hiccup, the orchestrator kills every replica at once — turning a brief database blip into a full outage, and the restart storm makes recovery slower.

**Readiness** asks "should traffic come here?" It checks the dependencies the process needs to serve. A failing readiness probe removes one instance from the load balancer, which is the correct response to a lost connection pool.

```yaml
livenessProbe:
  httpGet: { path: /health/live, port: 3000 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /health/ready, port: 3000 }
  periodSeconds: 5
```

## Signalling failure

The router returns 200 for anything a handler returns, and 500 for anything it throws — so a failing check is a throw:

```ts
@Get('/ready')
async ready() {
  try {
    await this.driver.execute({ text: 'SELECT 1', parameters: [] });
  } catch (error) {
    throw new Error('database unreachable');
  }
  return { status: 'ok' };
}
```

A 500 is what every orchestrator treats as failure, so this works. What you cannot produce is a 503 with a body describing which checks failed — see [Request Lifecycle](./web-request-lifecycle.html). If you need that, map it in your adapter.

> [!WARNING]
> Never return dependency detail from a public health endpoint. `{"error":"connect
ECONNREFUSED 10.0.1.14:5432"}` hands an attacker your internal topology,
> hostnames and versions. Log the detail; return `{"status":"error"}`.

## Add a timeout

An unreachable database often does not refuse the connection — it hangs. A probe that never returns is worse than one that fails, because the orchestrator sees a timeout with no information and your probe threads accumulate.

```ts
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);
}
```

```ts
await withTimeout(this.driver.execute({ text: 'SELECT 1', parameters: [] }), 2_000);
```

Note that [zmdb has no query cancellation](./query-cancellation.html), so the losing query keeps running on the server. The probe returns; the connection is occupied until the query finishes. Keep the probe query trivial (`SELECT 1`) so this does not matter.

## Keep the check cheap

Probes run every few seconds on every replica. Ten replicas with a 5-second readiness probe is 2 queries a second forever — fine for `SELECT 1`, not fine for a `count(*)` over a large table, which is a mistake people make when a probe grows into a smoke test.

Do not check optional dependencies in readiness. If your cache being down does not stop you serving requests, a readiness probe that fails on it removes healthy capacity.

## A startup probe

`init()` runs `onModuleInit` and `onApplicationBootstrap`; a process serving before that finished serves requests with uninitialised state:

```ts
let ready = false;
await app.init();
ready = true;
```

Expose it and point a startup probe at it, so slow initialisation is not mistaken for a liveness failure.

## Graceful shutdown belongs with this

Failing readiness on `SIGTERM` before closing anything is what makes a rolling deploy lossless:

```ts
process.on('SIGTERM', async () => {
  shuttingDown = true; // readiness now fails
  await new Promise(r => setTimeout(r, 5_000)); // let the LB notice
  server.close();
  await app[Symbol.asyncDispose]();
});
```

The sleep matters. Closing the server immediately drops in-flight requests that the load balancer has already routed. See [Standalone Applications](./web-standalone.html).

## What it would take

A `HealthIndicator` interface, a controller that aggregates results, and a status the handler can choose — the last one being the same [handler-cannot-set-status](./web-request-lifecycle.html) blocker that affects [exception filters](./web-exception-filters.html) and [CORS](./web-cors.html). A `Driver.ping()` would help but is not required; `SELECT 1` works on every dialect.

Low priority: the controller above is twenty lines and the library version would not be shorter.

---

See also: [Observability](./web-observability.html) · [Standalone Applications](./web-standalone.html) · [Deployment](./web-deployment.html)
