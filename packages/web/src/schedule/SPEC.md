# `@zmdb/web` — cron and interval scheduling SPEC

> A cron dialect whose five-field form means exactly what `crontab` means, a scheduler whose state is an absolute instant so that DST is a conversion rule rather than two special cases, and `runs` as
> a required per-task decision because no default is safe for both a cache warmer and a billing run (epic #585, sub-issue #586). Frozen before code.

The worker that runs jobs, the retry curve and the completion marker are `../queues/SPEC.md`. This file is the trigger: what an expression means, which instant it resolves to, which replica fires it,
and what happens when the answer is "none of them". The two halves compose in exactly one place and §8 is that place.

## 1. The two things every replica gets wrong, and which one a type can fix

`docs-site/content/web-task-scheduling.md` states the first:

> Three replicas means three concurrent runs of your nightly billing job.

and the page's own table enumerates the coordination people reach for. The second is quieter: a `setInterval` in a container whose `TZ` changed moves a nightly job by hours, and nothing reports it.

Only one of these is fixable by a signature. **Which replica fires** is a runtime question that needs a store, so the type's job is to force the question to be answered — §3 — and the mechanism is §7.
**When it fires** is fixable outright, by refusing to let the host's configuration participate: §5's `timeZone` defaults to `'UTC'` and never to the host zone.

What this file does not get to redecide: at-least-once, the lease-based claim, and dead-lettering are frozen in `../../../query-compiler/src/outbox/SPEC.md` and inherited through `../queues/SPEC.md`
§1. A scheduler that fired twice would be a bug there; here it is a bounded and expected event, and §8 explains why that is not a lowering of standards.

## 2. The surface, and the eight corrections to #586's sketch

```ts
/** A scheduled method takes nothing and returns nothing. §2.1 is why the type says so. */
type ScheduledMethod = () => void | Promise<void>;

export type TaskDecorator = (target: ScheduledMethod, context: ClassMethodDecoratorContext) => void;

/** Whether the cluster runs this task once, or every replica runs it. Required — §3. */
export type TaskRuns = 'once-per-replica' | 'once-per-cluster';

export interface TaskOptions {
  readonly runs: TaskRuns;
  readonly name?: string; // defaults to `${Controller.name}.${methodName}`
  readonly timeZone?: string; // IANA; defaults to 'UTC', never the host zone — §5
  readonly timeoutMs?: number; // 300_000
}

export declare function Cron(expression: string, options: TaskOptions): TaskDecorator;
export declare function Interval(everyMs: number, options: TaskOptions): TaskDecorator;

export interface ScheduleDef {
  readonly name: string;
  readonly method: string;
  readonly trigger: { readonly kind: 'cron'; readonly expression: string } | { readonly kind: 'interval'; readonly everyMs: number };
  readonly runs: TaskRuns;
  readonly timeZone: string;
  readonly timeoutMs: number;
}

/** The discovery seam. Mirrors `getRoutes` — §9. */
export declare function schedulesOf(controller: abstract new (...args: never[]) => unknown): readonly ScheduleDef[];

/** A lease over one task name. Structural, so no dependency is added — §7. */
export interface LeaseStore {
  acquire(key: string, holder: string, ttlMs: number): Promise<boolean>;
  renew(key: string, holder: string, ttlMs: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
}

export interface SkippedRun {
  readonly task: string;
  readonly scheduledFor: Date;
  readonly reason: 'still-running' | 'lease-not-held' | 'missed';
}

export interface SchedulerOptions {
  readonly tasks: readonly object[]; // instances the container built
  readonly clock: Clock; // declared once, in `../queues/index.ts` — §2.6
  readonly onTaskError: (task: string, scheduledFor: Date, error: unknown) => void;
  readonly onSkipped: (skipped: SkippedRun) => void;
  readonly leases?: LeaseStore; // required if any task is 'once-per-cluster' — §3
  readonly leaseMs?: number; // 60_000
  readonly graceMs?: number; // 15_000
}

export interface Scheduler {
  start(): void;
  onShutdown(): Promise<void>;
  /** Fire every task whose instant falls at or before `now`, for tests. §10 item 1. */
  tick(now: number): Promise<void>;
}

export declare function createScheduler(options: SchedulerOptions): Scheduler;
```

Everything above compiles under the project's settings, and each negative asserted below was run through `tsc --ignoreConfig --strict --exactOptionalPropertyTypes` before being claimed.

### 2.1 `MethodDecorator` does not compile, and the correct type buys something extra

#586's sketch types both decorators as `MethodDecorator`. `tsconfig.json:6` sets `experimentalDecorators: false`, so a `MethodDecorator` application fails with **TS1241** — _"The runtime will invoke
the decorator with 2 arguments, but the decorator expects 3"_ — and **TS1270**, _"Decorator function return type 'void | TypedPropertyDescriptor<unknown>' is not assignable to type 'void | (() =>
Promise<void>)'"_. Both verified by compiling the sketch as written. `emitDecoratorMetadata` is `false` on the line above, so there is no reflection to fall back on either; the seam is §9's.

The stage-3 signature is not merely the one that compiles. `../routing/index.ts:84` types its target as `(...args: never[]) => unknown`, which accepts every function, and it has to — a route handler
receives a `Ctx`.

**A scheduled method receives nothing**, because there is no caller with anything to pass, so narrowing the target to `ScheduledMethod` makes `@Cron('0 0 3 * * *') nightly(when: Date)` a compile error
at the application site.

Verified, along with the companion case: a method returning `Promise<number>` is rejected, because a scheduled task's return value has nowhere to go and a developer who returns one believes something
reads it.

### 2.2 `TaskOptions` is required, not optional, and `runs` is the reason

The sketch has `options?: { timeZone?: string; overlap?: false }`. Making the whole object optional is what makes §3 impossible: `runs` cannot be a required decision if the object carrying it can be
omitted. So the parameter is required and `runs` is required in it.

### 2.3 `overlap?: false` is a dead option and is deleted rather than widened

A property whose type has exactly one value carries no information: `overlap: false` and the absence of `overlap` are the same state, and no code can branch on it. Verified, in the sense that
`if (opts.overlap === true)` is a compile error under the sketch's own type — so the option the sketch declares cannot be read.

There are two viable fixes and this freeze takes the second.

Widening to `boolean` gives a scheduler the ability to start an unbounded number of concurrent runs of one task on a timer, which is the only way a scheduler can produce a self-inflicted incident with
no external trigger — a task that takes 70 seconds on a 60-second interval accumulates one extra concurrent run per minute, forever, and the symptom appears an hour later as memory pressure.

**So overlap is never permitted and the option does not exist.** A task still running when its next instant arrives skips that instant and reports `reason: 'still-running'`.

The capability is not lost, it is relocated to where it has a bound: a task that wants concurrent work calls `enqueue`, and `../queues/SPEC.md` §2.4 gives the worker a real `concurrency` ceiling. "Run
this concurrently" is a statement about a worker pool, and a timer is not one.

### 2.4 `Interval(everyMs)` has an upper bound, and exceeding it fires immediately

`setTimeout`'s delay is coerced to a signed 32-bit integer, so the maximum is `2_147_483_647` ms — **24.86 days**. Verified: `setTimeout(fn, 2_147_483_648)` logs
`TimeoutOverflowWarning: … Timeout duration was set to 1` and fires **immediately**. So `@Interval(THIRTY_DAYS)` under a naive implementation does not run monthly; it runs immediately and then
approximately every millisecond, which is a busy loop wearing a decorator.

The freeze handles this in two layers. `everyMs` is validated at registration: a positive integer, and `everyMs > 2_147_483_647` is a **registration error naming the task and pointing at `@Cron`** — a
monthly schedule is a calendar statement and belongs in a cron expression, where "the first of the month" is expressible and "every 30 days" is not the same thing anyway. And the timer is never
`setInterval`: §6.

### 2.5 A generated `name` is needed, and the sketch has no identity at all

`LeaseStore` is keyed by task name, and a lease key that changes when somebody renames a method releases the lease and lets two replicas fire. So the default is `${Controller.name}.${methodName}` —
stable under a formatting change, visible in `onSkipped`, and overridable by `name` for the case where the class is renamed and the lease key must not be. Two tasks resolving to one name is a
registration error, exactly as a duplicate route is.

### 2.6 `Clock` is declared once, in the queues module

`Clock` (`now()`, `sleep(ms, signal)`) is `../queues/SPEC.md` §2's and is imported here rather than redeclared. Two clock interfaces in one package would be two settable-clock seams for tests to
install, and a test that advances one while the other reads `Date.now()` is a flake that looks like a scheduling bug. There are currently **zero** uses of `Date.now`, `setTimeout` or `setInterval`
anywhere in `packages/web/src`, so this introduces the package's first time dependency and it gets exactly one door.

### 2.7 What the sketch omits

No missed-run behaviour (§8), no coordination mechanism (§7), no cron dialect (§4), no timezone semantics (§5), no drain (§9), and no error sink.

The sinks are **required**, in the shape `../../../app/src/messaging/SPEC.md` §5 requires its three: a task that throws inside a timer with no sink is a rejected promise nobody observes, and a
scheduled task's failure is by construction unwitnessed — nobody is waiting for a response.

Silence is the default failure mode of this entire module, so the field that breaks the silence cannot be optional.

## 3. `runs`, required — and why the field is not called `scope`

**`runs` has no default because neither value is safe for both kinds of task.** `'once-per-replica'` is correct for a cache warmer, an in-process metric flush or a connection reaper, and catastrophic
for a billing run. `'once-per-cluster'` is correct for the billing run and wrong for the cache warmer, which must run on every replica because each has its own cache. A framework that guessed would be
wrong half the time, silently, and in one direction the wrongness is a duplicated charge.

This is `../health/SPEC.md` §4's reasoning applied to a different field: `timeoutMs` is required there because "the correct value is a property of the dependency".

`../queues/SPEC.md` §2.4 makes the opposite choice for its timeouts. The two rules share one principle: **require a value when no default is safe, and supply a default when omission is itself
dangerous.** A missing job timeout creates a job that may never drain; a missing `runs` leaves an application decision unmade.

**`'once-per-cluster'` with no `leases` is a construction-time error**, listing every task that asked for it. Not a warning, and not a lazy failure at first fire: a task whose coordination silently
degraded to per-replica is precisely the bug the field exists to prevent, and discovering it at 03:00 when the first nightly task fires on three replicas at once is discovering it in production.

Startup is the only moment at which the check is free and the operator is watching. The check cannot be a type check, because the decorator and the scheduler are different objects in different files;
that is a real limitation and the construction check is the closest enforcement available.

**The field is `runs` and not `scope` because `scope` is taken.** `@zmdb/app` exports `type Scope` from its DI module, where it is `'singleton' | 'transient'` (`../../../app/src/di/index.ts:113`). A
`scope` option on a scheduled task would read, to anyone who has used this framework's container, as a statement about instance lifetime.

This is the same collision that forced `Subscription` to be renamed `EventBinding` in `../graphql/subscriptions/SPEC.md` §3 — one barrel, so one namespace, and a word that already means something in
it cannot be reused for something else. `runs` also reads as an English sentence at the call site: `runs: 'once-per-cluster'`.

## 4. The cron dialect: five fields mean what `crontab` means

```
┌───────────── second (0-59)     — extension, optional, leading
│ ┌─────────── minute (0-59)
│ │ ┌───────── hour (0-23)
│ │ │ ┌─────── day of month (1-31)
│ │ │ │ ┌───── month (1-12 or JAN-DEC)
│ │ │ │ │ ┌─── day of week (0-7 or SUN-SAT; 0 and 7 are both Sunday)
* * * * * *
```

**The compatibility invariant is that a five-field expression means exactly what it means in `crontab(5)`.** Six fields adds seconds, and the extra field is _leading_ so that the five rightmost fields
keep their positions — a copied crontab line is either accepted unchanged with its original meaning, or rejected, and never quietly reinterpreted.

| construct                                  | accepted | note                                                                                                                          |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `*`, `a-b`, `a,b`, `*/n`, `a-b/n`          | yes      | POSIX                                                                                                                         |
| `JAN`-`DEC`, `SUN`-`SAT`, case-insensitive | yes      | POSIX (Vixie)                                                                                                                 |
| `0` and `7` for Sunday                     | yes      | POSIX                                                                                                                         |
| `@yearly @monthly @weekly @daily @hourly`  | yes      | `crontab(5)`'s own nicknames                                                                                                  |
| `@reboot`                                  | **no**   | "at startup" is not an instant; §9's `init` is where startup work goes, and its meaning under `once-per-cluster` is undefined |
| `L`, `W`, `#`, `?`                         | **no**   | Quartz extensions, not cron; each needs calendar arithmetic and there is no agreed dialect for them                           |
| a sixth field for a year                   | **no**   | Quartz again; a schedule that fires in one year is a one-off, which is a job with a `delayMs`                                 |

**The day-of-month/day-of-week rule is POSIX's OR, including the part everybody finds surprising.** When neither field is `*`, an entry matches if **either** matches, so `0 0 1 * MON` fires on the
first of the month _and_ on every Monday.

Rejecting that combination as ambiguous is tempting and is refused: a dialect that is ninety-five percent `crontab` is worse than one that is either wholly compatible or obviously different, because
the missing five percent is discovered in production by somebody who copied a line that worked for years. #587 asserts this rule directly so it cannot be "fixed" later by somebody who reads it as a
bug.

An expression is parsed **once, at registration**, into per-field bitsets. Parse failure is a registration error naming the task and the field. This is the §1 cost constraint of epic #564 in its
scheduling form: no regular expression runs on a tick, and the matcher is a handful of bit tests, so a per-second tick over fifty tasks costs nothing measurable.

## 5. Time zones: the state is an instant, so DST is one conversion rule

**`timeZone` defaults to `'UTC'` and never to the host zone.** The host zone is `TZ` in a container spec or whatever the base image happens to carry, which means the same source runs at a different
wall-clock time in two environments and a base-image bump moves a nightly job. UTC is the only value that is identical everywhere, and a task that genuinely cares about local midnight says so
explicitly — which is also the only form a reviewer can check.

The zone is validated at registration against `Intl.supportedValuesOf('timeZone')` — verified to return 418 entries on this Node, to contain `Europe/Berlin` and not to contain a fabricated name.
`Intl` is not restricted by `.oxlintrc.json`, unlike `node:crypto` and `Buffer`, so this needs no dependency and no escape hatch.

The `Intl.DateTimeFormat` for the zone is also constructed at registration, because it throws `RangeError` on an unknown zone and a lazily constructed formatter throws that at first fire — turning a
typo into a 3 a.m. incident instead of a failed deploy.

**The scheduler's state is `nextAt: number`, an absolute epoch-millisecond instant.** It is not a local wall-clock time that gets converted when it fires. This one representational choice is what
stops DST from being two special cases: the tick compares instants, and the only place a zone is consulted is when the next instant is computed from the expression, by converting a candidate instant
to local fields with `formatToParts` and testing the bitsets.

Two facts make it necessary rather than merely tidy. `Date` cannot represent a zoned wall-clock time at all — verified: `new Date('2026-03-29T02:30:00').toISOString()` is `'2026-03-28T21:00:00.000Z'`
on this machine, because a datetime with no offset is parsed in the _host_ zone, which is the exact input the module is refusing to depend on. And `globalThis.Temporal` is `undefined` on Node 26.8.1 —
verified — so the type that was designed for this problem is not available and the semantics have to be built on `Intl`.

Which makes the choice of _which_ semantics load-bearing, because they will be swapped for `Temporal`'s later and must not change behaviour then. The frozen rule is **Temporal's `'compatible'`
disambiguation**: a gap resolves forward, an overlap resolves to the earlier instant. Verified against `Europe/Berlin` in 2026, where the transitions are `2026-03-29 02:00→03:00` local and
`2026-10-25 03:00→02:00` local:

| expression, `Europe/Berlin` | date         | local time     | fires at                 | why                                                                                          |
| --------------------------- | ------------ | -------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `0 30 2 * * *`              | `2026-03-29` | does not exist | `01:30Z` = `03:30` local | gap resolves forward — verified: `01:30Z` is `03:30 GMT+2`                                   |
| `0 30 2 * * *`              | `2026-10-25` | exists twice   | `00:30Z`, once           | overlap resolves earlier — verified: `00:30Z` is `02:30 GMT+2` and `01:30Z` is `02:30 GMT+1` |
| `0 30 4 * * *`              | either       | unambiguous    | as written               | most days are this row                                                                       |

Both alternatives lose, and for the same reason in opposite directions. **Skipping the nonexistent time** means a daily task does not run on one day a year, which is found in a quarterly
reconciliation rather than in a log.

**Firing on both instants of the overlap** means a billing job runs twice on one day a year — and it does so in a system where the operator asked for `once-per-cluster` specifically to prevent a
double run, so the framework would be causing, through a timezone rule, the exact failure its coordination advertises protection against. A rule that can only be wrong in one direction should be wrong
in the direction that fires once.

`@Interval` has no `timeZone`, because a fixed duration has no local wall clock to be ambiguous about. Passing one is a registration error rather than being ignored, on `../versioning/SPEC.md` §8 item
9's principle: an option that silently does nothing is worse than one that refuses.

## 6. The timer is never `setInterval`, and the drift is bounded

`setInterval(fn, everyMs)` with an async `fn` queues the next invocation on a wall clock that does not know the previous one has not finished, which is §2.3's unbounded fan-out with no way to refuse
it. So each task schedules a single `setTimeout` for `nextAt - clock.now()`, and computes the following instant **after the run settles**.

Two consequences follow, and both are stated rather than discovered:

`@Interval(everyMs)` is therefore **completion-to-start**, not a fixed rate. A task that takes 2s on `@Interval(10_000)` runs every 12 seconds, not every 10. This is the reading of "every 10 seconds"
for a task the framework is not allowed to overlap, and the fixed-rate reading is unimplementable without either overlap or a skipped tick.

`@Cron` **is** a fixed rate, because the instant comes from the expression and not from the previous completion, so `0 * * * * *` fires at each minute boundary regardless of how long the last run
took, and a run that overruns its next instant produces one `onSkipped` with `reason: 'still-running'`.

Clamping the delay to `2_147_483_647` (§2.4) matters for `@Cron` too — a `@monthly` task's next instant is more than 24.86 days away, so the wait is a chain of clamped timeouts rather than one, and
#587 asserts the monthly case for exactly this reason.

Because the delay is recomputed from `clock.now()` on every hop, a machine that suspends or a timer the event loop delays produces a late run and never a drifting series: error does not accumulate,
which is the failure mode a self-adjusting `setInterval` has and a recomputed timeout does not.

## 7. Leader by lease, per task, and why the advisory lock loses

`once-per-cluster` is a lease over the task's name, and the protocol is `../../../query-compiler/src/outbox/SPEC.md` §4.2's with one row: a conditional `UPDATE` whose
`WHERE heldUntil <= :now OR holder = :self` predicate **is** the mutual exclusion, because the row's own write lock serialises two replicas racing on it.

The scheduler holds the lease while a task runs, renews at `leaseMs / 3`, and fires only while it holds it. A renewal that fails aborts the running task's signal and stops firing, because a scheduler
that keeps firing without the lease is two schedulers.

**Per task, not per process.** A single global leader concentrates every scheduled task on one replica — a load imbalance that grows with the number of tasks, and a single failure that stops the
entire scheduler until the lease expires. Per-task leases spread tasks across replicas by whoever wins each race, and a replica's death costs at most `leaseMs` on the tasks it happened to hold.

**`pg_try_advisory_lock` is refused**, and `web-task-scheduling.md` presents it as the Postgres option. Three reasons, in increasing order of severity:

1. It is Postgres-only. `@zmdb/repository` supports four root dialect families plus Cockroach and SingleStore variants, and a coordination mechanism available on one dialect is a scheduler that works
   in production and not in the test suite — which is the arrangement most likely to ship a broken lease.
2. The page's own caveat — _"The lock is held on a session"_ — is fatal under a connection pool, because the application does not choose which session it gets. A lock taken on a pooled connection is
   released when that connection is reset or returned, and holding it means pinning a connection for the lifetime of the process.
3. A session lock **cannot expire**. A process that is wedged but still connected holds it forever with no timeout, so the failure mode is a scheduler that never runs again and whose recovery requires
   a human. A lease's worst case is bounded by `leaseMs` and needs nobody.

The same argument disposes of the page's other rows: a Redis `SETNX` lock is a second datastore for a feature the database can hold, and a "designated leader replica" is a configuration value that is
wrong during every rolling deploy.

**A `LeaseStore` port, not an import.** Declared structurally so `@zmdb/web` gains no dependency — the construction `../observability/SPEC.md` §2 uses for `Tracer` and `../queues/SPEC.md` §3 uses for
`JobStore`, and for directive 7. The SQL implementation and its one-row-per-task table land in `@zmdb/repository` for the reason queues §3 gives: DDL and the builders are not in this package, and
`packages/web/package.json` does not depend on `@zmdb/query-compiler`. **This is a correction to #586's `Files` list**, which names only the two `SPEC.md` files.

**The limitation, which the epic asks for by name.** A lease bounds at-most-one _starter_, not at-most-one _runner_. A replica that stalls past its renewal — a long GC pause, a suspended VM — can
still be inside the task body when another replica acquires the lease and starts it.

So `once-per-cluster` means "one fire per instant, except across a stall", and no lease implementation improves on that; it is the same bound outbox §8 accepts for its dispatcher. The durable
guarantee has to come from the task's own effect, which is §8.

## 8. Missed runs are not caught up, and this is where the two halves compose

**A task whose instant passed while nothing fired it is not run late.** Not on startup, not when a lease is finally acquired, and not after a clock jump.

The alternative is a nightly task that fires three times in the first second after a three-day outage, and it does so with no concurrency bound (§2.3) and no idempotency the framework can see.

A missed run is reported as `onSkipped({ reason: 'missed', scheduledFor })` and the operator decides, because "should the nightly billing run for the three nights we were down happen now, all at
once?" is not a question a framework default can answer.

The mechanism a task uses to _get_ catch-up is the point of this section and it is the only place the epic's two halves must be used together:

```ts
@Cron('0 0 3 * * *', { runs: 'once-per-cluster', timeZone: 'Europe/Berlin' })
async nightly(): Promise<void> {
  await this.queue.enqueue('billing.run', { day: today() }, { dedupeKey: `billing:${today()}` });
}
```

Three properties fall out at once, and none of them is available to a scheduler alone.

**A double fire becomes a single job.** `../queues/SPEC.md` §4's `dedupeKey` is backed by a unique index, so the stalled-replica case in §7 enqueues twice and one row exists. The scheduler does not
need to be exactly-once; it needs to be at-least-once into something that deduplicates, which is a far weaker requirement and one a lease actually meets.

**A crash mid-task becomes a retry rather than a miss.** A scheduler run that dies has no record; a job row survives, and queues §5 retries it.

**The work gets a real timeout, real retries and a dead-letter.** A scheduled task body has `timeoutMs` and nothing else — an exception reaches `onTaskError` and is gone, because retrying a scheduled
task inside the scheduler would collide with the next instant and there is nowhere to put a poison one.

So the recommended shape for anything that must not be lost is: **the scheduled task enqueues; it does not do the work.** The task body stays short enough that its timeout is uninteresting, and the
durability question is answered once, in the module that exists to answer it. A task that does its own work is supported and appropriate for a cache warmer, where losing a run costs nothing.

## 9. Discovery, registration, and the drain

The metadata seam mirrors `../routing/index.ts` exactly, because a second pattern for the same problem is a second thing to learn: a module-private `SCHEDULES` symbol on `Symbol.metadata`
(`../routing/index.ts:28-29`), one boundary function that narrows the `unknown` metadata slot in the one enumerated place a cast is allowed under directive 5 (`routingView`, `:45-47`), and a reader
`schedulesOf` in the shape of `getRoutes` (`:106-122`).

Registration is `createScheduler({ tasks: [instances] })` — instances the container already built, never a filesystem scan and never a module-load side effect, per the epic's §2.7 constraint that "two
apps in one process must not share them, and nothing registers itself at module load".

**The decorator is defined in this module and never applied inside it.** `ARCHITECTURE.md:112-114` states the constraint: "no module on a path reachable from an entry point may contain syntax that is
not type syntax, / which rules out a decorator." `@Cron` is a function and a type, so defining it is legal; a `@Cron` in this package's own source would break `yarn verify:exports`, which imports
every subpath under plain `node`.

Tests may apply it, because `vitest.config.ts`'s `stage3Decorators()` esbuild plugin transpiles files matching `/(^|\n)\s*@[A-Za-z_$]/` — and its comment says why that is test-execution only.

**The drain, and the one step people forget.** `onShutdown` stops scheduling, waits up to `graceMs` for a running task, aborts its signal, and then **releases every lease it holds**.

Releasing is what turns a rolling deploy's scheduler gap from `leaseMs` into approximately zero: without it, the replica that is already running takes up to a minute to notice the expiry, and a task
scheduled during that minute simply does not run — reported as `'missed'` (§8) and never made up.

The release is a best-effort write and a failed one is not an error, because the lease expires anyway.

`graceMs` is a construction option for the reason `../queues/SPEC.md` §9 spells out at length: `../lifecycle.ts:49-54` awaits each `onShutdown` indefinitely and in sequence, and `createApp` invokes it
from `[Symbol.asyncDispose]()` over its construction ledger, which takes no arguments and so cannot carry a deadline. A scheduler registered as a value provider, or returned by a factory that was
actually resolved, enters that ledger and is drained; an unresolved factory is never constructed for shutdown.

## 10. What #587 has to assert

1. Compile-time, in a `*.type-test.ts`: `@Cron` applied to a method with a required parameter is rejected, and so is one returning `Promise<number>` — §2.1's narrowing, which is the only part of the
   decorator a test can check. Also: `TaskOptions` without `runs` is rejected, and `overlap: true` is rejected because there is no such option.
2. `tick(now)` is the only clock in every test. Nothing in this suite may use a real timer, because a scheduler test that waits is a scheduler test that flakes.
3. The dialect table of §4, row by row, including `@reboot` and `L` as **parse errors at registration** naming the task, and the five accepted nicknames.
4. `0 0 1 * MON` fires on the first of the month and on Mondays — POSIX's OR, asserted explicitly so it is not later "fixed".
5. Both DST rows of §5 against `Europe/Berlin`: `0 30 2 * * *` on `2026-03-29` fires once, at `2026-03-29T01:30:00Z`; on `2026-10-25` it fires once, at `2026-10-25T00:30:00Z` and not also at
   `01:30:00Z`. These two instants are the verified values and are asserted as epoch milliseconds, not as formatted strings.
6. `timeZone: 'Europe/Berln'` is a registration error, and the default zone is `'UTC'` asserted against a test process whose `TZ` is set to something else — the assertion that the host zone does not
   leak in.
7. `@Interval` with a `timeZone` is a registration error.
8. `everyMs: 2_147_483_648` is a registration error; a `@monthly` cron task fires once at the right instant despite that instant being more than 24.86 days out, which is the clamped-timeout chain of
   §6.
9. A task still running when its next instant arrives produces exactly one `onSkipped` with `reason: 'still-running'` and exactly one concurrent run — asserted with a task that overruns three
   instants, so an implementation that queues them fails.
10. `@Interval(10_000)` on a task taking 2_000 fires at 0, 12_000, 24_000 — §6's completion-to-start reading, stated as three instants so a fixed-rate implementation fails.
11. Two schedulers over one `LeaseStore` fire a `once-per-cluster` task once per instant, driven by an interleaving rather than by wall-clock luck; and the same task with `runs: 'once-per-replica'`
    fires twice.
12. A scheduler whose lease renewal starts failing stops firing and aborts the running task's signal — the property that keeps §7 from becoming two schedulers.
13. `createScheduler` with a `once-per-cluster` task and no `leases` throws, naming the task. Construction, not first fire.
14. A task whose instant passed while the scheduler was stopped produces `onSkipped` with `reason: 'missed'` and does **not** run on start.
15. `onShutdown` resolves within `graceMs` with a task that never settles, and releases the lease — asserted by a second scheduler acquiring it immediately rather than after `leaseMs`.
16. A throwing task reaches `onTaskError` with the task name and the intended instant, and the following instant still fires. One failure must not stop a schedule.
17. Two tasks resolving to the same name is a registration error.

## 11. Follow-ups this issue does not have to make

**No `tests/api-coverage/mapping.mjs` edit is needed.** That file has no cron, schedule or scheduler entries and `tests/api-coverage/inventory.mjs` has no corresponding upstream suite, so there is no
out-of-scope row this freeze invalidates — unlike `../versioning/SPEC.md` §1, whose freeze does require rewriting a committed argument there. Worth stating because a reader who has been through the
versioning epic will look for one.

Before #589, `docs-site/pages.mjs` carried `note: 'no @Cron/@Interval decorators or scheduler registry'`. The implementation changes that note to name the shipped surface and #590, with `status`
unchanged until the epic's docs pass. `web-task-scheduling.md` also contained code the repository's own lint bans — `Buffer.from` and `timingSafeEqual` from the restricted `node:crypto` — and the
freeze corrected that rather than presenting a lint violation as the pattern to copy.

## Non-goals (rejected)

- **`MethodDecorator`, and a target type wide enough to accept a method with parameters** (§2.1).
- **`overlap`, in any form** (§2.3). One value is unreadable and two values are an unbounded fan-out on a timer.
- **Catch-up for missed runs, in the scheduler** (§8). The composition with `../queues/` gives it to any task that wants it, with a concurrency bound the scheduler cannot offer.
- **`@reboot`, `L`, `W`, `#`, `?`, and a year field** (§4).
- **Rejecting the ambiguous day-of-month/day-of-week combination** (§4). Partial `crontab` compatibility is the worst of the three options.
- **Defaulting `timeZone` to the host zone** (§5). It makes the same source run at different times in two environments.
- **A `Date`-based or wall-clock-based internal representation** (§5). Verified unimplementable: `Date` has no zone.
- **Waiting for `Temporal`** (§5). It is `undefined` on the current Node, and its `'compatible'` semantics are adopted now so that adopting the type later changes nothing.
- **`pg_try_advisory_lock`, a Redis lock, or a designated leader replica** (§7).
- **A single global scheduler leader** (§7). It concentrates every task on one replica.
- **Retrying a failed scheduled task inside the scheduler** (§8). A retry collides with the next instant and there is nowhere to put a poison task; the queue has both.
- **`runOnStartup` / `runOnInit`.** Startup work is a call in `onInit`, where its ordering against the rest of initialisation is visible; as a decorator option it is a schedule that fires at a time no
  expression describes, and its interaction with `once-per-cluster` has no defensible answer.
- **A dynamic API for adding or removing tasks at runtime** — `addTask`/`removeTask`. It makes the set of schedules unknowable from the source, which is the property that lets `schedulesOf` be the
  seam for documentation and for #587's assertions. An application that needs a user-defined schedule is describing rows in its own table, which it can read and turn into `enqueue` calls from one
  `@Interval`.
- **`Ctx`, a container, or any per-run scope on the task** — there is no argument at all (§2.1). `../queues/SPEC.md` §10 carries the `NO_REQUEST_SCOPE` argument this honours.
- **Exposing the resolved next instant on a public API.** `tick(now)` plus `onSkipped` is what tests and operators need; a `nextRun` getter is a value that is stale the moment it is read and invites
  polling.

## Package ownership amendment (#645)

The complete cron/interval/lease contract moves to `@zmdb/jobs/schedule`. Its shared `Clock` remains the one declared by the jobs root. Scheduler shutdown continues to participate structurally in the
app lifecycle without creating an `app -> jobs` edge.

The old `@zmdb/web/schedule` entry and source are deleted rather than forwarded.
