# `@zmdb/web` — health checks SPEC

> Liveness and readiness kept apart by the type system rather than by a comment,
> bounded response times, and two levels of detail with the safe one as the default
> (epic #578, sub-issue #579). Frozen before code.

Instrumentation — spans, metrics, propagation — is `../observability/SPEC.md`. The SQL
comment format is `../../../query-compiler/src/comments/SPEC.md`. This file is the two
probes: what they are allowed to ask, what they are allowed to say, and how long they
are allowed to take.

## 1. Two questions, and why conflating them is an outage

`docs-site/content/web-health-checks.md` already states the failure this module exists
to prevent, and the freeze does not improve on the argument, only on the enforcement:

> If liveness checks the database and the database has a hiccup, the orchestrator kills
> every replica at once — turning a brief database blip into a full outage, and the
> restart storm makes recovery slower.

**Liveness** asks whether this process is wedged. The only correct answer comes from
inside the process. **Readiness** asks whether traffic should come here, which is a
question about dependencies. A failing liveness probe restarts one thing; a failing
readiness probe removes one thing from a load balancer. The first is destructive and the
second is not, which is why the destructive one must not be able to observe anything
outside the process.

## 2. The distinction is structural, not a field

#579's sketch is a single interface with a discriminant:

```ts
export interface HealthCheck {
  readonly name: string;
  readonly kind: 'liveness' | 'readiness';
  readonly timeoutMs: number;
  run(signal: AbortSignal): Promise<{ readonly ok: boolean; readonly detail?: string }>;
}
```

That is a convention wearing a field name. Nothing stops a `kind: 'liveness'` check's
`run` from closing over a `Driver` and awaiting a round trip, and the reviewer who would
catch it is the same reviewer a comment would have relied on. Step 1 asks for a mechanism,
so the freeze splits the type and takes the ability away:

```ts
/** The process is not wedged. Synchronous, and that is the whole mechanism. */
export interface LivenessCheck {
  readonly name: string;
  run(): boolean;
}

export interface CheckResult {
  readonly ok: boolean;
  readonly detail?: string;
}

/** The process can serve traffic. Asked with a deadline, because dependencies hang. */
export interface ReadinessCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly cacheMs?: number;
  run(signal: AbortSignal): Promise<CheckResult>;
}

export declare function healthRoutes(checks: {
  readonly liveness?: readonly LivenessCheck[];
  readonly readiness?: readonly ReadinessCheck[];
}): { readonly live: () => WebResponse; readonly ready: () => Promise<WebResponse> };
```

**`run(): boolean` is the enforcement.** A function whose return type is `boolean` cannot
`await`, so it cannot wait for a socket, a connection from a pool, a DNS answer or a
timer. It cannot be slow except by being CPU-bound, and it cannot fail because something
across the network failed. There is no `timeoutMs` on a `LivenessCheck` because a
synchronous predicate has no deadline to enforce, and no `AbortSignal` because there is
nothing to abort. There is no `detail` because §3 fixes the liveness body regardless of
what a check might want to say.

The honest limit: a synchronous predicate can still read a flag that a background timer
maintains by pinging the database, which is a dependency observed by laundering. No type
prevents that. What the type does prevent is the accident — the check that awaits a
query because awaiting a query is what checks do — and it bounds the deliberate version:
a flag cannot block, cannot consume a connection when the probe runs, and cannot flip on
a single transient error unless the application wrote code to make it. That is a decision
somebody had to take on purpose, which is the most a signature can ask for.

The three checks worth having are all synchronous, which is the evidence that the
restriction is not costing anything real: the process has finished `init()`, the process
is not shutting down, and the event loop is not starved.

## 3. Response shapes, and public status only by default

Both probes answer `200` when everything passes and `503` when anything fails.

| level                    | status | body                                                                        |
| ------------------------ | ------ | --------------------------------------------------------------------------- |
| public (default)         | `200`  | `{"status":"ok"}`                                                           |
| public (default)         | `503`  | `{"status":"error"}`                                                        |
| detailed (authenticated) | `200`  | `{"status":"ok","checks":[{"name":"db","ok":true,"durationMs":3}]}`         |
| detailed (authenticated) | `503`  | `{"status":"error","checks":[{"name":"db","ok":false,"detail":"timeout"}]}` |

The public body is two shapes and no third, and the page's existing warning is why:

> `{"error":"connect ECONNREFUSED 10.0.1.14:5432"}` hands an attacker your internal
> topology, hostnames and versions.

**`503`, not `500`.** Every orchestrator treats any non-2xx as failure, so this choice is
for the human and the proxy: `503` means the service is unavailable and the request was
fine, it is the status a proxy will retry or fail over on, and it is the one that may
carry `Retry-After`. `500` says the request caused something to break, which sends the
next reader to the wrong logs.

**This corrects two claims on the docs page.** `web-health-checks.md` says _"What you
cannot produce is a 503 with a body describing which checks failed"_ and the "What it
would take" section names a status the handler can choose as a blocker. Both were true
once. `json(value, { status: 503 })` has existed since `pipeline/index.ts:129`, so
nothing about the response shape above needs a framework change; the module is a
controller and an aggregator.

**The detailed form is a second route, not a query parameter.** `?verbose=1` makes one
route sometimes safe and sometimes not, which puts the authorisation decision inside the
handler where a route table cannot show it. Two routes means the guard is declared where
guards are declared — the `guards` field of `RouteOptions` frozen in
`../openapi/SPEC.md` §S3 — and `strictSecurity` then refuses to generate a document in
which `/health/ready/detail` has neither a guard nor `@Public()`. Registering the
detailed route is opt-in: `healthRoutes` returns the public pair, and the application
mounts the detailed one itself if it wants it, because a detailed health endpoint that
appears because a module was imported is the kind of thing that ends up on a public
listener.

`durationMs` appears in the detailed body and not the public one. It is a timing oracle:
a `SELECT 1` that takes 400ms says the pool is exhausted, which is a load signal an
unauthenticated caller should not be able to sample once a second.

## 4. Deadlines, and the one that cannot be honoured

`timeoutMs` is required on every `ReadinessCheck`. Not optional with a default, because
the default would be the number every check silently inherits and nobody chooses, and the
correct value is a property of the dependency — a local Postgres and a cross-region
object store do not share it.

Readiness checks run **concurrently**, so the aggregate deadline is
`max(timeoutMs) + 50ms` rather than the sum. Serial execution makes the endpoint's worst
case grow with every check added, which is how a probe that was fine with two dependencies
starts timing out at the orchestrator with six. The endpoint returns within that bound
even if every check hangs, and a check that has not answered by its own deadline counts as
**failed** with `detail: 'timeout'` — not as unknown, because the orchestrator has two
states and inventing a third only moves the decision somewhere that has less information.

**The `AbortSignal` aborts the waiting, not the work, and this is worth stating precisely
because the sketch implies otherwise.** `Driver.execute` is
`execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>`
(`packages/repository/src/index.ts:53`) and takes no signal. So when a probe's deadline
fires, the framework stops waiting, the promise is abandoned, and the query keeps running
on the server with its connection held until it finishes or the server kills it. The docs
page already says this honestly at `web-health-checks.md`; the freeze names the
consequence that follows. A 2-second timeout against a wedged database with a 5-second
probe period consumes one connection every 5 seconds and never returns any, so a readiness
probe can exhaust the pool it is testing — the probe becomes the outage.

Two things in this spec bound that, and one of them is the reason §5 exists at all:

1. The probe query must be trivial. `SELECT 1` is the documented one; a probe that grew
   into a smoke test is a different bug, already described on the page.
2. **In-flight coalescing** (§5) means at most one run of a given check is outstanding at
   any moment, no matter how often the endpoint is called. Without it, an abandoned query
   plus a 1-second probe period is an unbounded fan-out of abandoned queries. This is why
   coalescing is specified as a requirement rather than as an optimisation.

The real fix is not in this epic. `Driver.execute` would need an optional
`{ signal?: AbortSignal }` so a cancellation reaches the wire, which is
`docs-site/content/query-cancellation.md`'s subject and a change to a public interface in
`@zmdb/repository`. Named here so that #581 does not quietly implement a `timeoutMs` that
reads as if it cancels.

## 5. Caching readiness, asymmetrically

A probe every second on every replica that opens a connection each time is its own load
problem, so a `ReadinessCheck` may set `cacheMs`, default `1000`.

**A success is cached for `cacheMs`. A failure is not cached at all.** The asymmetry is
the whole design:

1. Caching a success delays noticing a _new_ failure by at most `cacheMs`, and the
   orchestrator's own `periodSeconds × failureThreshold` — 15 seconds in the page's
   example — already absorbs a delay far larger than that.
2. Caching a failure delays _recovery_ by `cacheMs`, and nothing absorbs it. An instance
   that is healthy again stays out of the load balancer, during exactly the incident in
   which capacity matters most, because a cache is remembering the worst moment.

So the bounded cost lands on the side that has slack, and the unbounded cost is refused.

Concurrent calls to `ready()` while a check is running **share that run** rather than
starting a second one. Under a cache miss with three replicas' probes arriving together
this is the difference between one query and three, and under §4's abandoned-query
behaviour it is the difference between a bounded and an unbounded number of occupied
connections.

Liveness is never cached. There is nothing to cache: `run(): boolean` is synchronous, so
the cache would save a function call and add a staleness window to the one probe whose
answer authorises a restart.

## 6. What #580 has to assert

1. Compile-time, in a `*.type-test.ts`: a `LivenessCheck` whose `run` returns
   `Promise<boolean>` is rejected, and a `ReadinessCheck` without `timeoutMs` is rejected.
   These two are the mechanism of §2, so they are the two assertions that would notice the
   mechanism being removed.
2. A failing readiness check produces `503` with the body `{"status":"error"}` and no
   other keys, asserted against the serialized string rather than an object, so a field
   added later fails the test instead of passing it.
3. The detailed form names the failing check and the passing one, and `durationMs` appears
   in it and in no public body.
4. A readiness check that never resolves produces a `503` within `timeoutMs + 50ms`, with
   `detail: 'timeout'` for that check and the other checks' real results intact.
5. Every check hanging still returns within `max(timeoutMs) + 50ms`, asserted with three
   checks whose timeouts differ, so a serial implementation fails.
6. A success is served from cache for `cacheMs` — two calls, one underlying run — and a
   failure is not: two calls, two runs.
7. Ten concurrent `ready()` calls against a slow check produce exactly one run.
8. With no checks registered, `live()` and `ready()` are both `200`. An empty set is not a
   failure; a process with no dependencies is ready.
9. A check that throws is a failed check, not a failed endpoint: `503` with that check's
   `ok: false`, and the thrown message must not reach the public body.

## Non-goals (rejected)

- **A single `HealthCheck` with a `kind` discriminant** (§2). It is the sketch's shape and
  it makes the distinction a convention, which is the thing this module exists to stop
  being a convention.
- **`timeoutMs` with a default** (§4). The correct value belongs to the dependency.
- **A third result state for a timed-out or unknown check** (§4).
- **`?verbose=1` for the detailed body** (§3), and a detailed route mounted by default.
- **Caching a failure** (§5), including "cache failures for a shorter window" — a shorter
  window is still a window in which a recovered instance is reported as broken.
- **`Driver.ping()`.** `SELECT 1` compiles on every dialect and a `ping` would be a second
  method on the driver interface doing what one already does. The page reached this
  conclusion first.
- **The framework choosing which checks to register.** A readiness check that appears
  because a module was imported is how an optional dependency ends up removing healthy
  capacity, which the page names as a mistake people make.
- **A startup probe as a distinct kind.** It is a `LivenessCheck` reading the flag
  `await app.init()` sets, exactly as the page shows, and a third kind would need a third
  set of semantics to justify itself.
- **`SIGTERM` handling inside this module.** Failing readiness on shutdown is the right
  pattern and it needs a bounded grace period in `runShutdown`, which is
  `../../lifecycle.ts`'s business and another epic's.
