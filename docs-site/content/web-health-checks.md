> **ToDo / feature gap.** There is no health check module — no `TerminusModule`,
> no `@HealthCheck`, no built-in indicators. There is also no `Driver.ping()`.
>
> The liveness/readiness split, the two response shapes, the timeout and caching
> rules are frozen in `packages/web/src/health/SPEC.md`. The controller below is
> close to what ships; the freeze makes the split enforceable rather than
> conventional, and corrects two claims on this page.

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
    await this.driver.execute({ text: 'SELECT 1', parameters: [] });
    return { status: 'ok' };
  }
}
```

The public body is `{"status":"ok"}` and nothing else. An earlier version of this example also returned how long the `SELECT 1` took, which is the mistake the warning below names and the frozen spec removes: a `SELECT 1` that takes 400ms tells an unauthenticated caller the pool is exhausted. Timings live in the separate guarded route, not this one.

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

Return a `503` explicitly. A handler chooses its own status with `json`:

```ts
@Get('/ready')
async ready() {
  try {
    await this.driver.execute({ text: 'SELECT 1', parameters: [] });
  } catch {
    return json({ status: 'error' }, { status: 503 });
  }
  return { status: 'ok' };
}
```

An earlier version of this page said a `503` was not producible and that a failing
check therefore had to be a throw, which lands a `500`. That has not been true since
handlers gained response factories — `json(value, { status })` is
`packages/web/src/pipeline/index.ts:129`.

Prefer `503` over `500`. Every orchestrator treats any non-2xx as failure, so the
choice is for the human and the proxy reading it: `503` says the service is
unavailable and the request was fine, it is the status a proxy will retry or fail
over on, and it can carry `Retry-After`. `500` says the request broke something,
which sends the next reader to the wrong logs.

> [!WARNING]
> Never return dependency detail from a public health endpoint.
> `{"error":"connect ECONNREFUSED 10.0.1.14:5432"}` hands an attacker your internal
> topology, hostnames and versions. Log the detail; return `{"status":"error"}`.

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

Note that [zmdb has no query cancellation](./query-cancellation.html), so the losing query keeps running on the server. The probe returns; the connection is occupied until the query finishes. `Driver.execute` takes no `AbortSignal` — the timeout stops the _waiting_, not the _work_.

Which has a consequence worth stating, because it is how a health check becomes the incident. A 2-second timeout on a 5-second probe period against a database that hangs consumes one connection every 5 seconds and returns none of them, so the readiness probe exhausts the pool it is testing. Two things bound it: keep the probe query trivial (`SELECT 1`), and **coalesce** — never have two runs of the same check outstanding at once, so an abandoned query cannot fan out. The frozen module does the second for you; a hand-rolled probe has to remember.

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

Nothing framework-level is missing any more. The status a handler can choose used to be the blocker; it is not, so what remains is a check interface and an aggregator, and the frozen design is worth reading for one decision it makes differently from every library in this space.

**The liveness/readiness split is enforced by the type, not by a field.** The obvious shape is one interface with `kind: 'liveness' | 'readiness'`, which is a convention wearing a field name — nothing stops a liveness check awaiting a query, and the reviewer who would catch it is the reviewer a comment would have relied on. Instead a liveness check is **synchronous**:

```ts
interface LivenessCheck {
  readonly name: string;
  run(): boolean;
}
interface ReadinessCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly cacheMs?: number;
  run(signal: AbortSignal): Promise<{ readonly ok: boolean; readonly detail?: string }>;
}
```

A function returning `boolean` cannot `await`, so it cannot wait for a socket, a pool or a DNS answer, and it cannot fail because something across the network did. That is the outage at the top of this page made unwritable. The three liveness checks worth having are all synchronous anyway — initialisation finished, shutdown not started, event loop not starved — which is the evidence the restriction costs nothing.

Three other decisions:

- **Public status only by default.** `{"status":"ok"}` or `{"status":"error"}` and nothing else, per the warning above. The detailed form — which check failed, and how long it took — is a **separate route** behind a guard, not a `?verbose=1`, because a query parameter puts the authorisation decision inside the handler where the route table cannot show it. `durationMs` is in the detailed body only; a `SELECT 1` that takes 400ms tells an unauthenticated caller the pool is exhausted.
- **`timeoutMs` is required, and checks run concurrently** so the endpoint's bound is `max(timeoutMs)` rather than the sum — otherwise the worst case grows with every dependency added. A timed-out check counts as failed, not unknown; the orchestrator has two states.
- **A success is cached, a failure is not.** Caching a success delays noticing a new failure by the cache window, which `periodSeconds × failureThreshold` already absorbs. Caching a failure delays _recovery_, with nothing absorbing it, during the incident where capacity matters most.

A `Driver.ping()` is still not required; `SELECT 1` compiles on every dialect. What would genuinely help is an optional `signal` on `Driver.execute`, so the timeout above cancels rather than abandons — see [query cancellation](./query-cancellation.html).

---

See also: [Observability](./web-observability.html) · [Standalone Applications](./web-standalone.html) · [Deployment](./web-deployment.html)
