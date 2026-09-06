> [!WARNING] Never put a database, cache, DNS or other dependency check in **liveness**. A dependency blip would make the orchestrator restart every otherwise healthy replica, turning a partial outage
> into a full outage and adding a restart storm to recovery. Dependency checks belong in **readiness**.

`@zmdb/web/health` provides supported, app-owned liveness and readiness aggregation. Checks are passed explicitly; importing the module registers nothing and creates no global registry.

## A liveness and a readiness probe

They answer different questions, and conflating them causes outages.

```ts
import type { Driver } from '@zmdb/repository';
import { Controller, Get, Public, createRouter, type Guard } from '@zmdb/web';
import { databaseReadinessCheck, detailedReadyRoute, healthRoutes, type HealthChecks } from '@zmdb/web/health';

declare const driver: Driver;
declare const authenticated: Guard;

const checks: HealthChecks = {
  liveness: [{ name: 'init-finished', run: () => true }],
  readiness: [databaseReadinessCheck(driver, { name: 'database', timeoutMs: 2_000, cacheMs: 1_000 })],
};
const health = healthRoutes(checks);
const detailedReady = detailedReadyRoute(checks);

@Controller('/health')
export class HealthController {
  @Public()
  @Get('/live')
  live() {
    return health.live();
  }

  @Public()
  @Get('/ready')
  ready() {
    return health.ready();
  }

  @Get('/ready/detail')
  readyDetail() {
    return detailedReady();
  }
}

const router = createRouter();
router.register(new HealthController(), {
  readyDetail: { guards: [authenticated] },
});
```

The public body is `{"status":"ok"}` or `{"status":"error"}` and nothing else. The detailed handler is separate and opt-in, and it uses the same route guard mechanism as another protected handler.
`@Public()` makes the two public probes explicit to strict OpenAPI generation. A `SELECT 1` that takes 400ms tells an unauthenticated caller the pool is exhausted; that timing never appears publicly.

**Liveness** asks "is this process wedged?" It is synchronous by type and must not touch a dependency.

**Readiness** asks "should traffic come here?" It checks the dependencies the process needs to serve. A failing readiness probe removes one instance from the load balancer, which is the correct
response to a lost connection pool.

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

An earlier version of this page said a `503` was not producible and that a failing check therefore had to be a throw, which lands a `500`. That has not been true since handlers gained response
factories — `json(value, { status })` is part of `@zmdb/web/pipeline`.

Prefer `503` over `500`. Every orchestrator treats any non-2xx as failure, so the choice is for the human and the proxy reading it: `503` says the service is unavailable and the request was fine, it
is the status a proxy will retry or fail over on, and it can carry `Retry-After`. `500` says the request broke something, which sends the next reader to the wrong logs.

> [!WARNING] Never return dependency detail from a public health endpoint. `{"error":"connect ECONNREFUSED 10.0.1.14:5432"}` hands an attacker your internal topology, hostnames and versions. Log the
> detail; return `{"status":"error"}`.

## Timeouts are part of each readiness check

An unreachable database often does not refuse the connection — it hangs. Every `ReadinessCheck` therefore requires `timeoutMs`; checks run concurrently and the aggregate returns no later than the
largest timeout plus a 50ms scheduling allowance. At the declared timeout the check's `AbortSignal` is aborted; if the check still has not settled by the end of the allowance, its result becomes
`{ ok: false, detail: 'timeout' }`.

Repository reads pass an `AbortSignal` to `Driver.execute`. `postgresDriver(pool, { cancelVia })` from `@zmdb/postgres` sends `pg_cancel_backend` through another connection when that signal aborts.
SQLite observes abort between stepped rows, and drivers without active cancellation leave the losing query on its connection until it finishes.

This can turn the health check into the incident. A 2-second timeout on a 5-second probe period against a hung database consumes one connection every 5 seconds and returns none of them, eventually
exhausting the pool being tested. Concurrent callers share a run while the aggregator is waiting, but the next probe retries after a deadline because failures are not cached.

If the driver ignored the aborted signal, the earlier query may still be running. Keep the query trivial (`SELECT 1`), set a driver/server timeout as well, and do not probe faster than the dependency
can recover.

## Keep the check cheap

Probes run every few seconds on every replica. Ten replicas with a 5-second readiness probe is 2 queries a second forever — fine for `SELECT 1`, not fine for a `count(*)` over a large table, which is
a mistake people make when a probe grows into a smoke test.

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

## The structural split

**The liveness/readiness split is enforced by the type, not by a field.** The obvious shape is one interface with `kind: 'liveness' | 'readiness'`, which is a convention wearing a field name — nothing
stops a liveness check awaiting a query, and the reviewer who would catch it is the reviewer a comment would have relied on. Instead a liveness check is **synchronous**:

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

A function returning `boolean` cannot `await`, so it cannot wait for a socket, a pool or a DNS answer, and it cannot fail because something across the network did. That is the outage at the top of
this page made unwritable. The three liveness checks worth having are all synchronous anyway — initialisation finished, shutdown not started, event loop not starved — which is the evidence the
restriction costs nothing.

Three other decisions:

- **Public status only by default.** `{"status":"ok"}` or `{"status":"error"}` and nothing else, per the warning above. The detailed form — which check failed, and how long it took — is a **separate
  route** behind a guard, not a `?verbose=1`, because a query parameter puts the authorisation decision inside the handler where the route table cannot show it. `durationMs` is in the detailed body
  only; a `SELECT 1` that takes 400ms tells an unauthenticated caller the pool is exhausted.
- **`timeoutMs` is required, and checks run concurrently** so the endpoint's bound is `max(timeoutMs)` rather than the sum — otherwise the worst case grows with every dependency added. A timed-out
  check counts as failed, not unknown; the orchestrator has two states.
- **A success is cached, a failure is not.** Caching a success delays noticing a new failure by the cache window, which `periodSeconds × failureThreshold` already absorbs. Caching a failure delays
  _recovery_, with nothing absorbing it, during the incident where capacity matters most.

A `Driver.ping()` is not required; `SELECT 1` works on every dialect. Pass the check's signal into the repository read, and use a driver that implements server-side cancellation if the timeout must
stop the database work — see [query cancellation](./query-cancellation.html).

---

See also: [Observability](./web-observability.html) · [Standalone Applications](./web-standalone.html) · [Deployment](./web-deployment.html)
