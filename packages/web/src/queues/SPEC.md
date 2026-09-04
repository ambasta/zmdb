# `@zmdb/web` — job handlers, retry, drain and idempotency SPEC

> At-least-once delivery with a supported exactly-once-_effect_ mechanism, a jittered
> backoff whose floor exists because the delay is a lease, a dead-letter path with a
> closed reason set, and a drain whose bound lives inside `onShutdown` because
> `runShutdown` has none (epic #585, sub-issue #586). Frozen before code, then
> reconciled with live #588's explicit backend requirement before that issue landed.

`@Cron` and `@Interval`, the lease that keeps a scheduled task from running once per
replica, and the cron dialect are `../schedule/SPEC.md`. The SQL that claims a row under a
lease is already frozen in `../../../query-compiler/src/outbox/SPEC.md` and is not
restated. This file is the worker: the handler contract, what happens on each of the five
ways a job can end, and who owns idempotency.

## 1. Three of the four hard decisions are already frozen, and this file inherits them

The epic's framing is that "every hard part of this epic is a distributed-systems decision
that cannot be retrofitted". Two of those parts were decided by earlier freezes in other
files, and pretending otherwise here would produce a second answer to a question that
already has one.

**At-least-once is not a choice this file gets to make.**
`../../../query-compiler/src/outbox/SPEC.md` §8 states it and gives the crash that forces
it — publish resolves, the process dies before the mark, the lease expires, another
dispatcher publishes again — and it refuses the mark-first ordering because that converts a
duplicate into a loss. It also names this epic explicitly: _"Consumer-side idempotency is
the queue epic's (#585) and is cross-referenced rather than restated"_. So §4 is this
file's half of a contract that was written down elsewhere, and the delivery guarantee is
inherited rather than argued.

**The claim protocol is already frozen and needs no new SQL.** Outbox §4.2 is three
statements — candidates, a conditional `UPDATE` whose own per-row write lock is the mutual
exclusion, then a read-back by lease token — and §4 of that file records why the textbook
`SELECT … FOR UPDATE SKIP LOCKED` is refused: it is not expressible on `SelectBuilder`, it
does not exist on SQLite, and it holds a transaction open for the length of a handler. A
queue that invented its own claim would either repeat that mistake or maintain a second
protocol.

**A poison job's terminal state already has a name.** Outbox §2.2 established
`status = 'dead'` over a `WHERE attempts < N` predicate, because a threshold leaves the
poison row in the working set to be re-read on every poll. §6 keeps that and adds the one
thing it lacks — a machine-readable reason.

What is genuinely new here is the fourth decision: **what a handler is, and what the worker
does to it.** That is §2 through §9.

## 2. The surface, and nine corrections to #586's sketch

```ts
/** Epoch-millisecond clock plus an abortable wait. §9 explains why `sleep` takes a signal. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

/** The store port. Structural; supported adapters are separate opt-in subpaths — §3. */
export interface JobStore {
  readonly dialect?: 'postgres' | 'mysql' | 'sqlite';
  execute(query: {
    readonly text: string;
    readonly parameters: readonly unknown[];
  }): Promise<readonly Record<string, unknown>[]>;
}

export type Backoff =
  | { readonly kind: 'fixed'; readonly delayMs: number }
  | { readonly kind: 'exponential'; readonly baseMs: number; readonly ceilingMs: number };

export interface RetryPolicy {
  readonly attempts: number;
  readonly backoff: Backoff;
}

export type DeadReason = 'invalid-payload' | 'unknown-name' | 'attempts-exhausted';

export type JobOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'retry'; readonly afterMs: number }
  | { readonly kind: 'dead'; readonly reason: DeadReason; readonly detail: string };

export interface JobContext {
  readonly jobId: string;
  readonly name: string;
  readonly attempt: number; // 1-based; this attempt, not the count already made
  readonly enqueuedAt: Date;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal; // aborted on timeout and on drain
}

export interface JobHandler<M, K extends keyof M & string> {
  readonly name: K;
  readonly validate: (raw: unknown) => M[K];
  handle(payload: M[K], ctx: JobContext): Promise<void>;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly retries?: RetryPolicy;
}

/** One element of a handler list: a handler for exactly one name — §2.1. */
export type AnyJobHandler<M> = { readonly [K in keyof M & string]: JobHandler<M, K> }[keyof M & string];

export interface EnqueueOptions {
  readonly delayMs?: number;
  readonly dedupeKey?: string;
}

export interface Queue<M> {
  enqueue<K extends keyof M & string>(name: K, payload: M[K], opts?: EnqueueOptions): Promise<string>;
  enqueueInTransaction<K extends keyof M & string>(
    tx: JobStore,
    name: K,
    payload: M[K],
    opts?: EnqueueOptions,
  ): Promise<string>;
}

export interface QueueOptions {
  readonly store: JobStore;
  readonly clock: Clock;
}

export declare function createQueue<M>(opts: QueueOptions): Queue<M>;

export interface DeadJob {
  readonly jobId: string;
  readonly name: string;
  readonly payload: string; // the bytes as enqueued — §7
  readonly attempts: number;
  readonly reason: DeadReason;
  readonly detail: string;
  readonly enqueuedAt: Date;
  readonly deadAt: Date;
}

export interface WorkerOptions<M> {
  readonly handlers: readonly AnyJobHandler<M>[];
  readonly store: JobStore;
  readonly clock: Clock;
  readonly concurrency: number;
  readonly graceMs: number;
  readonly leaseMs: number;
  readonly onDead: (job: DeadJob) => void | Promise<void>;
  readonly onHandlerError: (ctx: JobContext, error: unknown) => void;
  readonly timeoutMs?: number; // 30_000
  readonly retries?: RetryPolicy; // 5 attempts, exponential 1s → 300s
  readonly batch?: number; // 100
  readonly idleMs?: number; // 1_000, doubling to maxIdleMs
  readonly maxIdleMs?: number; // 30_000
}

export interface Worker {
  runOnce(): Promise<RunReport>;
  start(): void;
  onShutdown(): Promise<void>;
  listDead(opts: { readonly limit: number; readonly reason?: DeadReason }): Promise<readonly DeadJob[]>;
  replay(jobId: string): Promise<boolean>;
}

export interface RunReport {
  readonly claimed: number;
  readonly done: number;
  readonly retried: number;
  readonly dead: number;
  readonly skipped: number; // §4's marker said this job was already done
}

export declare function createWorker<M>(opts: WorkerOptions<M>): Worker;
```

Everything above compiles under the project's settings, verified with
`tsc --ignoreConfig --strict --exactOptionalPropertyTypes`, including each negative in §2.1
and §5.

### 2.1 `JobHandler<T>` cannot tie a name to a payload, and the obvious fix is silently crossed

#586's `JobHandler<T>` has `name: string` and `handle(payload: T, …)` with `T` chosen by
the caller. There is nothing in that type relating the two, so the enqueue side and the
consume side pick their own `T` and agree by convention. `../events/SPEC.md` already
settled this shape of problem for the emitter — **the map is the API**, because "a generic
the caller instantiates is an assertion, not a check" — and a job payload is the same
thing: one name, one payload type, declared once.

The interesting part is that the first correction is not enough. Writing the handler list
as `readonly JobHandler<M, keyof M & string>[]` **still accepts a handler whose name and
payload come from different rows of the map**, because `name` is checked against the union
of keys and `validate`/`handle` against the union of payloads, independently. Verified: a
handler literal with `name: 'post.notify'` and `validate: (raw) => ({ userId: 1 })` is
accepted by that array type and rejected by `AnyJobHandler<M>`, which distributes over the
keys so each element is a handler for exactly one of them. That is the whole reason
`AnyJobHandler` exists rather than being spelled inline, and it is the kind of hole a
runtime test cannot find because both halves are individually correct.

`validate` returning `M[K]` rather than `unknown` is a second, smaller tightening.
`../pipeline/index.ts:39` types the route boundary as
`validateBody?: (raw: unknown) => unknown`, which it has to, because `Ctx<P, B>`'s `B` is
not knowable from a route registration. A job's is: the map says so. So the queue's
validator seam is the pipeline's, one degree tighter, and a validator generated for the
wrong type is a compile error rather than a cast.

### 2.2 `MethodDecorator` does not exist as a usable type here

There is no decorator in this file — job handlers are registered by value, §10 — but #586's
sketch introduces `MethodDecorator` for `@Cron`/`@Interval` and the correction belongs
wherever a reader meets it first. `tsconfig.json:6` sets `experimentalDecorators: false`,
so `MethodDecorator` fails at every application site with **TS1241** _"the runtime will
invoke the decorator with 2 arguments, but the decorator expects 3"_ and **TS1270**. Both
verified. `../schedule/SPEC.md` §2 carries the corrected signature.

### 2.3 `retries` cannot express what step 2 asks for, and `ceilingMs` is dead on one arm

The sketch's `retries: { attempts; backoff: 'exponential' | 'fixed'; ceilingMs }` is
missing the base delay, so `'exponential'` has no exponent base to multiply, and it carries
`ceilingMs` on the `'fixed'` arm where there is nothing to cap. It also has no jitter,
which step 2 mandates in the same breath. A discriminated union fixes all three at once and
makes the asymmetry a compile error rather than a paragraph — the same move
`../versioning/SPEC.md` §2 makes by putting `default` on two arms of `VersionStrategy` and
not the third. §5 is the policy.

### 2.4 Required `concurrency`, `timeoutMs` and `retries` contradict the epic's own constraint

The epic requires that "concurrency, per-job timeout, retry count and backoff ceiling all
have safe defaults that cannot be removed", and the sketch makes all four required on the
handler. Those cannot both be true. The resolution is that the numbers are **optional on
the handler and required on the worker**, with the worker's value as the default and no
spelling that means "none": `timeoutMs: 0` and `timeoutMs: Infinity` are construction-time
errors, not escape hatches.

The lease must be strictly longer than the worker timeout and every handler override. A
lease that expires first makes the same row claimable while its original handler is still
within its advertised execution window. Equality is also refused because the claim
predicate includes an expired lease at the current instant.

This is the opposite of what `../health/SPEC.md` §4 decided for `ReadinessCheck.timeoutMs`,
which is required with no default, and the asymmetry is real rather than an inconsistency. A
readiness timeout that is wrong in the short direction marks a healthy pod unready and gets
it killed, so there is no safe value to guess; a job timeout that is wrong in the long
direction only delays a drain and holds a slot, and §8 makes even that visible. One epic
asked for no default because every default is dangerous; this one asked for a default that
cannot be removed because the absence is the danger.

**Concurrency is the worker's bound, and a handler's is a cap rather than an addition.** A
per-handler concurrency alone cannot bound anything: the process has one event loop and one
connection pool, and N handlers each allowed 10 is a bound of 10N that grows every time
somebody adds a handler. So `WorkerOptions.concurrency` is the number that holds, a
handler's `concurrency` may only reduce its own share, and the sum of handler caps is
allowed to exceed the worker's — otherwise adding one handler forces retuning every other
one, which is how a bound becomes a thing people raise rather than respect.

The claim size follows from this rather than being tuned separately: the worker claims
`min(batch, concurrency - inFlight)` rows. Claiming a full batch while nine of ten slots
are busy would hold leases on rows this worker is not working on, which is starvation
wearing the costume of throughput — another worker sees them as claimed and skips them.

### 2.5 The rest of what the sketch is missing

`JobContext` gains `jobId`, `name` and `enqueuedAt`. Without `name` a shared helper cannot
tell which job it is inside; without `enqueuedAt` a handler cannot tell a job that was
enqueued four seconds ago from one that has been retrying for a day, which is exactly the
decision "should I still bother sending this notification?" needs.

`attempt` is **1-based and is this attempt**, not the count already made. This is worth
pinning because the store's column is the other one: outbox §5's mark step writes
`attempts + 1`, so `ctx.attempt === row.attempts + 1` at the moment `handle` is called. Two
conventions in one system with the same word is a silent off-by-one in every retry
assertion, and #587 asserts the relation directly.

The enqueue side, the worker loop, `listDead`, `replay` and the clock are absent from the
sketch entirely and are §§3-9.

## 3. The store is a port, with a supported memory backend and an optional `pg` adapter

`JobStore` is declared locally and structurally, and takes no import. This is the same
construction `../observability/SPEC.md` §2 uses for `Tracer` and for the same directive:
zero required runtime dependencies. It happens to be cheap here because
`packages/repository/src/index.ts:135` already types `withTransaction(tx: { execute:
Driver['execute'] })` structurally, so a `TransactionContext`
(`packages/repository/src/transactions/index.ts:8-12`) satisfies `JobStore` with no
adapter, and so does a `Driver` (`packages/repository/src/index.ts:51-54`).

The port is not decoration. `@zmdb/web`'s required dependencies are
`@zmdb/aot-validator`, `@zmdb/repository` and `@zmdb/schema-core` — **not
`@zmdb/query-compiler`** — and `CompiledQuery` is not re-exported from
`@zmdb/repository`'s index, so naming that type here would mean adding a dependency merely
to spell an argument. The structural form lets an existing repository `Driver` or
transaction pass straight through.

The original freeze then made a wrong inference: it treated that port as satisfying the
epic's optional-backend constraint by itself. The live #588 issue is more specific and is
the contract to land: `packages/web/src/queues/backends/` must contain a supported
in-memory backend and one real adapter, and DoD 4 requires the real adapter's package to be
an optional peer.

The smallest adapter consistent with the SQL-shaped `JobStore` is node-postgres, not Redis.
`createPgJobStore(poolOrClient)` delegates to the repository's measured `pgDriver`, so every
query remains the same query and `dialect` is `postgres`. `pg` is an optional peer and a
type-only import in shipped code: the caller constructs and owns the `Pool`/`Client`, and
importing `@zmdb/web/queues` neither loads `pg` nor opens a connection.

`createMemoryJobStore()` is the other supported backend. It owns one isolated
`node:sqlite` `:memory:` database, installs `zmdb_job`, `zmdb_job_done`, the unique
enqueue-dedupe constraint and `zmdb_job_pending`, and exposes the database for deterministic
test setup and assertions. It is explicitly ephemeral; a durable deployment still creates
the declared repository rows through its migration path.

The split:

| Piece                                                     | Lands in                                          |
| --------------------------------------------------------- | ------------------------------------------------- |
| `JobHandler`, `JobContext`, `createQueue`, `createWorker` | `@zmdb/web/queues`                                |
| supported ephemeral SQLite storage                        | `@zmdb/web/queues/backends/memory`                |
| optional node-postgres adapter                            | `@zmdb/web/queues/backends/pg`, optional peer     |
| durable `zmdb_job` rows and pending index declaration     | `@zmdb/repository/jobs`                           |
| the three claim statements                                | worker SQL, following the protocol in outbox §4.2 |

**`zmdb_job` is a second table with the outbox's shape, not the outbox table reused.** The
temptation is strong and `web-queues.md` predicts it. It is refused because the two
columns that look alike are not: the outbox's `topic` is a broker subject and a job's `name`
is a handler key, and one column holding both makes "no handler for this row" mean two
different things. `../microservices/SPEC.md` §5 requires an unhandled pattern to be
**acknowledged**, "because a message nobody wants must not be redelivered forever" — which
is correct for a subject nobody subscribed to and catastrophic for a job, since it silently
destroys work that was committed inside somebody's transaction. Two tables with identical
shape and identical SQL cost one migration; one table costs a dispatcher that cannot tell
which reader a row was for.

The delayed-enqueue and backoff columns come free from the same shape: outbox §5 already
pushes `leaseUntil` into the future to hide a retried row for exactly the backoff, so
`EnqueueOptions.delayMs` is an insert with `leaseUntil = now + delayMs` and needs no
`availableAt` column.

**Ordering is stated as weakly as it is**, following outbox §7 rather than inventing a
stronger claim:

| configuration                            | ordering                                        |
| ---------------------------------------- | ----------------------------------------------- |
| one worker, `concurrency: 1`, `batch: 1` | by `enqueuedAt`                                 |
| one worker, `concurrency > 1`            | claimed in `enqueuedAt` order, run concurrently |
| more than one worker                     | **none**                                        |

## 4. Idempotency: two layers, one key, and the part the framework cannot do

DoD 4 asks for "an idempotency key or a deduplication window — not just advice", and step 1
adds "a supported deduplication mechanism (a table, or the backend's own). Advice alone is
not a deliverable." The honest deliverable has two layers, and the limitation between them
is stated first because it is the thing a reader most needs to not misunderstand.

**The framework cannot make a handler idempotent, and a framework-owned deduplication table
placed around the handler would be worse than nothing.** The mechanism that suggests itself
is: claim the key, run the handler, and skip if the claim fails. That has the same crash
window as delivery, pointed the wrong way — the claim commits, the process dies, the key is
taken and the effect never happened, and the job is never retried. That is a **lost job**,
and outbox §8 already refused exactly this trade in its own mark-first form: "a lost event
in a system whose entire purpose is not losing events is the worse trade by a wide margin".
So the marker is written **after** the effect, which means it cannot prevent the first
duplicate — only every subsequent one. Anything stronger requires the marker and the effect
to commit together, which only the handler's own transaction can do.

With that stated, the two layers:

| layer                    | owner                     | mechanism                                                                                |
| ------------------------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| at-most-once **enqueue** | framework                 | `EnqueueOptions.dedupeKey` and a unique index; a second enqueue returns the first job id |
| a stable key             | framework                 | `ctx.idempotencyKey`, identical across every attempt of the same work                    |
| at-most-once **effect**  | handler, framework-helped | the handler writes the key in its own transaction; the worker skips a committed marker   |

**`idempotencyKey` is `dedupeKey ?? jobId`, and that is why it is not a duplicate of
`jobId`.** The two fields are different facts. `jobId` identifies a delivery: it is the row,
generated at enqueue with `globalThis.crypto.randomUUID()` — the route outbox §2.4 already
established, since `SqlType` has no `uuid` (`packages/schema-core/src/index.ts:21-32`) and
`.oxlintrc.json:66` bans `node:crypto` and names `globalThis.crypto` as the replacement.
`idempotencyKey` identifies the _work_: two enqueues that the caller declared to be the same
work share it, and a handler that hands it to Stripe or to a payment gateway gets the
industry-standard semantics the name promises. Handing `jobId` to Stripe instead would let a
second enqueue of the same charge through, which is the bug the field is supposed to prevent.

Any other derivation loses, and the reasons are worth having:

- **A hash of the payload** collides two deliberately identical jobs. Sending the same
  reminder twice is a legitimate request and a payload hash refuses it silently.
- **A per-attempt value** is not stable, so it cannot deduplicate anything.
- **A caller-required key on every enqueue** puts the burden on the code least able to
  carry it: the common case has no natural key, and a required field with no natural value
  gets filled with `randomUUID()`, which is `jobId` spelled by hand.

**The marker.** `zmdb_job_done(key TEXT PRIMARY KEY, completedAt TIMESTAMP)`, declared in
`@zmdb/repository` with the row (§3). The framework's three contributions are the key, a
`seen(key)` read the worker performs **before** invoking a handler, and a statement the
handler includes in its own transaction. The pre-check is not an optimisation — it is what
makes §6's replay and §8's abandoned handler safe, and #587 asserts it in both roles.

**Retention is an operational invariant, but it is not a #588 constructor option.** A
marker deleted while its job can still be retried or manually replayed reopens the duplicate
window, so retention must exceed both horizons. The earlier freeze invented a 30-day
default and a construction-time check even though neither live #588 nor #587 requires a
retention field, and `WorkerOptions` has no such surface. Marker cleanup is scheduled work
owned by #589; until that implementation lands, cleanup is not automatic and applications
must retain markers themselves.

**"Or the backend's own" is a trap and step 1 should not have offered it as an
alternative.** SQS's content-based deduplication is a five-minute _enqueue-side_ window; it
does nothing about a consumer that crashed after its effect, which is the duplicate that
actually happens. A backend's dedup can substitute for the first row of the table above and
never for the third, and treating them as interchangeable is how an application ends up
believing it has exactly-once because a checkbox was ticked.

## 5. Retry: a ceiling with no floor is not a backoff

Frozen policy, with the worker's defaults:

```
attempts     5
backoff      { kind: 'exponential', baseMs: 1_000, ceilingMs: 300_000 }

nominal(attempt) = min(ceilingMs, baseMs * 2 ** (attempt - 1))
delayMs(attempt) = nominal(attempt) * (0.75 + Math.random() * 0.5)
```

The nominal curve is deliberately identical to the one outbox §5 already froze —
`Math.min(2 ** attempts * 1000, 300_000)` — so this is that default **plus the jitter it
lacks**, not a competing policy. Two subsystems in one repository with two backoff curves
is two numbers to tune and one of them will be forgotten.

**Jitter is unconditional and there is no option to disable it.** Step 2 names the failure
it prevents — a thundering herd of synchronised retries — and an option to turn it off is an
option somebody sets to make a test deterministic and then ships. Determinism is not needed:
#587 asserts the **interval** rather than a value, plus the property that a thousand samples
are not all equal, which is an assertion an un-jittered implementation fails and a correct
one passes regardless of the random source. That is strictly better than pinning a curve,
and it is why no injected random-source seam appears in §2.

**±25% proportional jitter, not full jitter from zero, and the reason is local to this
design.** AWS's measurement favours full jitter — a uniform draw from `[0, cap)` — on total
work. It loses here because **the delay is written as `leaseUntil`, not passed to a sleep**.
A draw near zero makes the row a candidate on the very next poll, so the "backoff" is not
one, and the row a dependency outage was supposed to hold off comes straight back. A floor
is therefore not optional in a lease-based design, which is a constraint AWS's client-side
sleep does not have. The secondary benefit is that the curve stays recognisable: an operator
can look at a retry histogram and see the doubling, where full jitter flattens it into
noise.

`{ kind: 'fixed', delayMs }` exists for the handler whose dependency has a known cadence — a
rate limit that resets every ten seconds — and it is jittered too, for the same reason.

`attempts` counts attempts the worker managed to **record**. §9 explains why that is not the
same as attempts made, and why the fix for it is refused.

## 6. Dead-letter: a closed reason set, and a replay that reuses the row

The terminal state is outbox §2.2's `status = 'dead'` and the notification is its `onDead`.
Step 3 asks for three more things: where it goes, what is retained, and how it is inspected
and replayed, because "a dead-letter store nobody can read is a silent data loss".

**`DeadReason` is a closed union of three values, and this is the one place this file
narrows a frozen sibling.** `../microservices/SPEC.md` §2 has
`{ kind: 'dead'; reason: string }`, which is right there: a broker's dead-letter carries a
free-text header and the transport set is open-ended. The queue owns both ends of its own
table, so it can close the set, and closing it is what makes the version-skew query
possible — `listDead({ reason: 'invalid-payload' })` is the "what did the last deploy
break?" question, and it cannot be asked of a string somebody has to grep. `detail` carries
the free text alongside.

| reason               | when                                                | §   |
| -------------------- | --------------------------------------------------- | --- |
| `invalid-payload`    | the payload failed `validate`, on the first attempt | §7  |
| `unknown-name`       | no handler for the name, after the retries ran out  | §7  |
| `attempts-exhausted` | the handler threw or timed out `attempts` times     | §5  |

Retained: `name`, the `payload` **bytes exactly as enqueued**, `attempts`, `reason`,
`detail`, `enqueuedAt` and `deadAt`. The payload is a `text` column, which outbox §2.3
argued for on the grounds that a `json` column round-trips through the driver's own JSON
handling and so "the bytes a consumer receives are not the bytes that were written". For a
dead job that argument is sharper still: the bytes are the evidence, and a payload
re-serialised on the way out cannot be compared to what the producer sent.

**`replay(jobId)` resets the existing row; it does not insert a new one. This is forced by
§4.** The id is the fallback identity in `idempotencyKey`, so a replay that created a new
row would give the work a new identity and walk straight past the completion marker — which
means replaying a job that had actually succeeded would run its effect a second time. Reset
in place and the marker still applies, so **replaying a job that succeeded is a no-op**.
That property is the reason `replay` returns `boolean` (the row was dead and is now pending)
rather than throwing, and #587 asserts the no-op directly.

Replay clears `attempts` to zero. Not preserving it, because a dead job is replayed after
somebody fixed something, and a job that arrives with four of five attempts already spent
gets one try and dies again — which reads as "the fix did not work" when it means "the
counter was not reset".

`listDead` takes a **required** `limit`. An unbounded read of a dead-letter table is the
query that works for a year and then loads two million rows into a worker process during an
incident, which is the worst possible moment for it. The rows are ordinary rows in an
ordinary table and SQL still works on them; the framework ships these two calls anyway
because `web-queues.md` already identified them as the thing "every application
rewrites".

## 7. Consume-time validation, and the two version-skew outcomes

The payload is validated **at consume**, per the epic's §2.3 citation, with a validator
generated by `@zmdb/aot-validator` — the same `assert<T>`-shaped seam the route boundary
uses at `../pipeline/index.ts:206-212`, and the reason the map in §2.1 is worth having is
that the generated validator's output type is checked against the handler's parameter.

**A payload that fails validation is `dead` on the first attempt, and no option changes
that.** `../microservices/SPEC.md` §6.1 makes the argument and it transfers without
weakening: the validator is deterministic and compiled ahead of time, so a payload that
failed it will fail it again on every retry, forever. Retrying is not a gamble that might
pay off. It is a guaranteed non-terminating loop, and here it also burns the row's lease
every `leaseMs` for as long as the table exists.

A payload that fails to **parse** — the `text` column does not contain JSON — is the same
case with `detail` carrying the raw prefix, so the sink has something to look at.

**A job whose name has no handler is retried and then dead, which deliberately differs from
the frozen sibling.** `../microservices/SPEC.md` §5 acknowledges an unhandled pattern
immediately. That is right for pub/sub, where having no subscriber for a subject is a normal
state, and wrong here: a job is addressed to exactly one handler, so no handler means the
worker's deploy is behind the enqueuer's, and acking silently destroys work that was
committed inside a transaction. Immediate dead-lettering is wrong too, because the rolling
deploy in which a new enqueuer is live sixty seconds before the new worker is normal, and it
would dead-letter every job in that window and demand a manual replay of all of them. So:
retry under the **worker's** default policy — a handler that does not exist has no policy to
consult — and `dead('unknown-name')` when the attempts run out. The window survives; a
removed name terminates.

The distinguishable-reason requirement in step 6 is therefore satisfied twice: a payload
that no longer validates is `invalid-payload` and a name that no longer exists is
`unknown-name`, and neither can retry forever.

## 8. Timeouts: the signal aborts the waiting, and the slot stays occupied

`ctx.signal` is aborted when `timeoutMs` elapses and when the drain begins. Step 4 asks for
the honest limitation to be stated; the limitation is sharper here than the step implies.

**`AbortSignal` aborts the waiting, not the work**, and in this repository that is not a
handler-discipline problem but a hard interface fact. `Driver.execute` is
`execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>`
(`packages/repository/src/index.ts:53`) and takes no signal, so a job whose work is a query
cannot be cancelled at all — the finding `../health/SPEC.md` §4 already recorded for
readiness probes, with the same conclusion and a different consequence.

**Step 4's own wording is self-contradicting and worth correcting.** "A timed-out handler is
abandoned rather than left running" describes one thing twice: abandoning a promise _is_
leaving the work running. The distinction the step is reaching for is between the worker's
bookkeeping and the handler's execution, and it has to be spelled that way to be
implementable.

So, on timeout, in order: abort `ctx.signal`; record the timeout through `onHandlerError`;
settle the job as `retry` with §5's delay; and **keep the slot occupied until the abandoned
promise settles.**

That last clause is the decision. Freeing the slot immediately is the obvious alternative
and it destroys the only bound the worker has: `concurrency` would stop counting the work
actually in flight, so a wedged dependency would produce an unbounded fan-out of abandoned
handlers each holding a connection — the same failure `../health/SPEC.md` §4 fixes with
in-flight coalescing. Holding the slot means a wedged handler reduces throughput visibly
instead of multiplying load invisibly, and with `concurrency: 1` it stalls the worker, which
is the correct and diagnosable failure rather than a quiet one.

**And a handler that ignores its signal and succeeds after the timeout is turned from a
duplicate into a no-op by §4's marker.** The sequence is worth following once: the timeout
fires, the job is settled `retry`, the abandoned handler eventually commits its effect and
its completion marker, the retry is claimed, the worker's pre-check sees the marker, and the
job is settled `done` with `skipped` incremented. Nothing ran twice. This is the payoff that
justifies the marker existing at all, and it is why `RunReport` has a `skipped` counter — a
`skipped` count that climbs is the signal that handlers are exceeding their timeouts.

`timeoutMs: 0` and `timeoutMs: Infinity` are construction-time errors (§2.4). A job with no
deadline cannot be drained, so removing the timeout removes §9.

## 9. The drain protocol, and the bound `runShutdown` does not have

Step 5's protocol, with the timing:

| phase | action                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------ |
| 1     | stop claiming; abort the idle `sleep` so no poll interval is waited out                                |
| 2     | wait for in-flight handlers, up to `graceMs`                                                           |
| 3     | abort every remaining `ctx.signal`                                                                     |
| 4     | write `leaseUntil = now` on every job that did not finish, so a surviving worker claims it immediately |
| 5     | resolve `onShutdown`, whatever step 4 achieved                                                         |

**The grace period is a construction option, and it has to be, because
`runShutdown` has no bound.** `../lifecycle.ts:49-54` is
`for (…) { … await instance.onShutdown(); }` — each hook is awaited indefinitely and they
run in sequence. `createApp` invokes it from `[Symbol.asyncDispose]()` over the construction
ledger, and `[Symbol.asyncDispose]()` takes no arguments, so there is no
place for a caller to pass a deadline even if it wanted to. This is the same reasoning
`../microservices/SPEC.md` §2.5 used to give `close(graceMs)` a required parameter, arriving
at the opposite mechanics: the bound cannot be an argument here, so it is a worker field,
and it is required for the same reason — an unbounded wait is a process that does not exit,
which under an orchestrator is a `SIGKILL` and precisely the abandoned mid-flight job the
wait existed to prevent.

Two consequences follow that the docs have to carry. **Grace periods add**, because
`runShutdown` is sequential: two workers with `graceMs: 30_000` are a sixty-second shutdown,
while a deployment's `terminationGracePeriodSeconds` is one number for the whole pod. One
worker per process is the recommendation, and where that is impossible the budget is divided
rather than repeated. A worker registered as a value provider, or returned by a factory that
was actually resolved, enters that ledger and is drained automatically. An unresolved factory
does not: shutdown never constructs a worker merely to stop it.

**Step 1's abort of the idle sleep is not a nicety.** Outbox §5's poll backs off to
`maxIdleMs: 30_000`, and a worker that waits out an idle sleep before noticing shutdown
takes up to thirty seconds to begin draining — which exceeds the default grace period of
most orchestrators before any in-flight job has been waited for. That is the entire reason
`Clock.sleep` takes an `AbortSignal` in §2 rather than being a bare timer.

**What happens to a job that neither finishes nor requeues cleanly**, which step 5 asks for
explicitly: nothing is written, the lease expires `leaseMs` after it was taken, and another
worker claims the row with `attempts` unchanged. Late is the correct failure — the same
conclusion outbox §5 reached — and the alternative of waiting for the lease is a shutdown
that blocks on a handler.

The honest cost of that is a real limitation and it gets stated rather than buried:
**`attempts` counts attempts the worker managed to record, not attempts made.** A worker
that is `SIGKILL`ed mid-job records nothing, so a job that crashes the process is retried
forever without ever reaching `attempts` and without ever appearing in `listDead`. The
obvious fix — a claim counter incremented at claim time — is refused, because it would count
a graceful drain's requeue as a failed attempt, so a rolling deploy would dead-letter
perfectly healthy jobs. The bound on the damage is that each cycle costs at least `leaseMs`,
so the loop is slow and loud rather than fast and quiet, and the thing that actually detects
it is a restart-count alert, not a column.

## 10. Dependencies and scope: there is no per-job scope, and this is already settled

`tests/api-coverage/mapping.mjs:148-152` carries a committed argument that this file must
honour rather than reopen, and five upstream suites are marked out of scope by citing it:

> Request-scoped and durable providers make the injector re-resolve a subtree per request,
> which is why NestJS needs scope bubbling, inquirer injection and parallel-resolution
> tests. zmdb has singleton and transient providers and passes request state explicitly
> through the context object, so there is no scope to bubble and nothing to resolve twice.

A job is the same shape of thing as a request and gets the same answer. **A handler runs in
no scope.** It is a method on an instance the container built once at startup, with its
`@Inject` fields resolved during that build — a module-level `currentContainer`
(`../di/index.ts:50`) is set for the duration of `build` and cleared in a `finally`
(`../di/index.ts:55-63`), so there is no later moment at which a per-job subtree could be
resolved even if one were wanted. Per-job state travels in `JobContext`, exactly as per-request state travels in
`Ctx`.

There is therefore **no `container` on `JobContext`**. A container reachable from a handler
is a service locator, and it is also the seam through which a request scope gets asked for
one call site at a time; refusing the field is what keeps the row above true.

**Registration is by value and explicit.** `createWorker({ handlers: [notify, welcome] })`,
never a scan and never a module-load side effect, because the epic's §2.7 citation forbids
it: "the scheduler registry and worker pool belong to the app. Two apps in one process must
not share them, and nothing registers itself at module load." That also means dispatch is a
`Map` built once in `createWorker` and a `Map.get` per job, which is the §1 cost-model
constraint satisfied in the same construction `../pipeline/index.ts:52-61` uses for routes.

## 11. What #587 freezes and #588 adds

1. Compile-time, in a `*.type-test.ts`: a handler whose `name` and payload type come from
   different entries of the job map is rejected by `AnyJobHandler<M>`, and — as a companion
   assertion — the same literal is _accepted_ by `readonly JobHandler<M, keyof M & string>[]`,
   so the test records why §2.1's mapped form is not a stylistic choice.
2. Compile-time: `enqueue('post.notify', <the other job's payload>)` is rejected, an unknown
   job name is rejected, and `{ kind: 'fixed', delayMs, ceilingMs }` is rejected.
3. `ctx.attempt` is `1` on first delivery and equals the stored `attempts + 1` on every
   later one — §2.5's off-by-one, asserted as a relation rather than as two numbers.
4. Retry delays fall in `[0.75 · nominal, 1.25 · nominal)` for each attempt with the
   nominal curve of §5, the ceiling holds at attempt 12, and a thousand samples of one
   attempt are not all equal. The last clause is the assertion an un-jittered implementation
   fails.
5. A handler that throws `attempts` times ends `dead` with `reason: 'attempts-exhausted'`,
   `onDead` fires exactly once, and a subsequent `runOnce` does not claim it — the poison-job
   assertion, in the shape outbox §9 item 7 already uses.
6. A payload that fails its validator is `dead` with `reason: 'invalid-payload'` on the
   **first** attempt, with the handler spy at zero calls, on a worker whose `retries.attempts`
   is greater than one so the assertion is about the decision and not about the budget.
7. A job whose name has no handler retries under the worker's default policy and then goes
   `dead` with `reason: 'unknown-name'` — both halves, because either alone passes for the
   wrong implementation.
8. `listDead({ limit, reason: 'invalid-payload' })` returns only that reason, and the stored
   `payload` is byte-identical to what was enqueued.
9. `replay` on a job whose completion marker is committed is a **no-op**: the handler is not
   invoked, the run reports `skipped: 1`, and the job ends `done`. Then the same assertion
   for a job with no marker, which does run.
10. A handler that ignores its signal and resolves after `timeoutMs`: the job is settled
    `retry`, the slot is **not** freed until the abandoned promise settles (asserted by a
    second job not starting), and the eventual retry is `skipped` because the abandoned
    handler committed the marker — §8's whole sequence in one test.
11. `onShutdown` resolves within `graceMs` even with a handler that never settles, and every
    unfinished job is left claimable with `attempts` unchanged.
12. `onShutdown` resolves promptly while the worker is inside its longest idle sleep,
    asserted against a `maxIdleMs` much larger than `graceMs`, so an implementation whose
    sleep is not abortable fails.
13. A worker registered as a constructed provider is drained by `createApp`'s dispose, while
    an unresolved worker factory is neither constructed nor drained — the pair that pins §9's
    constructed-only lifecycle rule.
14. Two workers over one store claim disjoint job sets, with no job run twice, driven by an
    interleaving rather than by wall-clock luck — the queue's form of outbox §9 item 3.
15. `timeoutMs: 0`, `timeoutMs: Infinity`, a lease no longer than the effective timeout,
    and a handler `concurrency` above the worker's are construction errors.
16. The supported memory backend installs both queue tables, the unique enqueue-dedupe
    constraint and the pending-claim index, and the runtime suite uses that backend rather
    than duplicating its own schema.
17. The `pg` adapter accepts node-postgres `Pool`, `PoolClient` and `Client`, preserves the
    `postgres` dialect and query result, and `packages/web/package.json` declares `pg` as an
    optional peer.

## 12. Follow-ups this issue does not have to make

**No `tests/api-coverage/mapping.mjs` edit is needed, and a reader will expect one.** That
file has no queue, worker, processor or scheduler entries and `tests/api-coverage/inventory.mjs`
has no corresponding upstream suite, so there is no row to move from out-of-scope to covered
— unlike `../versioning/SPEC.md` §1, whose freeze does invalidate a committed argument in
that file. What #586 does interact with there is `NO_REQUEST_SCOPE`, and §10 honours it
rather than changing it, so no edit is due when #588 lands either.

The docs pages that change are `web-queues` and `web-task-scheduling`, whose `pages.mjs`
notes (`docs-site/pages.mjs`) become freeze citations in the shape
`web-versioning`'s already has, and they stay `status: 'todo'` until the epic closes. Two
neighbouring pages need corrections that this freeze creates: `transactional-outbox` and
`web-queues` both hand-roll the loop this file specifies.

Two later ownership boundaries are explicit rather than implied. #589 owns completion-marker
cleanup because it is scheduled work; #594 owns lifecycle discovery for plain providers
because its live dispatcher DoD requires participation in the application lifecycle. Neither
is silently pulled into #588.

## Non-goals (rejected)

- **Deciding the delivery guarantee** (§1). At-least-once is inherited from outbox §8, which
  named this epic as the owner of the consumer half and nothing else.
- **A new claim protocol, `FOR UPDATE SKIP LOCKED`, or an affected-row count on `Driver`**
  (§1, §3). All three are outbox §4's rejections and none of them has become expressible.
- **Reusing the `zmdb_outbox` table** (§3). One `topic`/`name` column for two readers makes
  "no handler for this row" ambiguous, and the frozen answer for one reader silently
  destroys the other's work.
- **A framework-owned deduplication table around the handler** (§4). Claim-then-run turns a
  duplicate into a lost job, which is the trade outbox §8 refuses in its other direction.
- **A required `dedupeKey`, or a payload hash as the key** (§4).
- **`retries` as a bare number, and a `ceilingMs` on the fixed arm** (§2.3).
- **An option to disable jitter** (§5). #587's interval assertion removes the only honest
  reason to want one.
- **Full jitter from zero** (§5). The delay is a lease, so a floor is not optional.
- **Freeing the slot when a handler times out** (§8). It is the only way `concurrency` stops
  being a bound.
- **A claim counter, so that `attempts` counts attempts made** (§9). It would dead-letter
  healthy jobs on every rolling deploy.
- **`priority` on `EnqueueOptions`.** A priority column adds an `ORDER BY` to the candidate
  query and, under a lease-based claim, lets a low-priority job starve indefinitely; a
  priority that only orders within one batch is a lie told by a field name. Separate queues —
  a second worker with its own name list — say the same thing where the reader can see it.
- **`runAt: Date` on `EnqueueOptions`** (§3). `delayMs` is the whole mechanism, a caller with
  an instant writes `at - clock.now()`, and taking a `Date` would import
  `../schedule/SPEC.md`'s entire timezone question into a module that has no business with
  it.
- **`container` on `JobContext`, or any per-job scope** (§10).
- **A shipped Redis or SQS adapter.** The required real adapter is node-postgres because it
  already speaks the SQL-shaped `JobStore`; adding a broker protocol would create a second
  worker state machine rather than adapt this one.
- **A logger, or a `log` on `JobContext`.** `onHandlerError` is the sink, for the reason
  `../events/SPEC.md` §3 requires `onError`; `web-logging` argues the rest.
- **Metrics emitted from this module.** `RunReport` is the numbers; a `Meter` is
  `../observability/SPEC.md`'s and wiring one here would be a second telemetry pipeline.
