// Work that happens outside a request: background jobs and scheduled tasks in one epic, then the
// application-level messaging trio (events, CQRS, outbox) in another. The outbox is the piece that
// makes the second epic worth building — it is the only one that requires the database.

export const JOB_EPICS = [
  {
    key: 'jobs',
    title: '[EPIC] Background work — a queue module with workers, and scheduled tasks',
    labels: ['enhancement', 'area:web', 'area:ops', 'parity:nestjs'],
    pages: ['web-queues', 'web-task-scheduling'],
    packages: ['@zmdb/web'],
    motivation: `
"no queue module or worker abstraction" and "no @Cron/@Interval decorators or scheduler registry".

These are the two ways work escapes a request, and both have failure modes that are invisible in
development and expensive in production. A queue whose jobs are not idempotent will double-charge
someone the first time a worker is killed mid-job. A scheduler with no leader election will run the
nightly billing job once per instance — which is a correctness bug that appears the day the service is
scaled from one replica to three, and by then the scheduler is trusted.

Both of those are design properties, not features, and that is what makes this an epic rather than two
decorators. The deliverable is not "\`@Cron\` exists"; it is "\`@Cron\` exists and running three replicas
does not run the job three times, and that fact is tested".

The other thing worth getting right is that job payloads are external data. A job enqueued by an older
version of the code and consumed by a newer one is a versioning boundary, and a payload read from Redis
is untrusted input the same way a request body is. zmdb generates validators, so a typed job payload with
a real validator at the consume boundary is close to free — and it turns a class of deploy-time failure
into a clear error.

Both features also need to interact with the existing lifecycle properly: a shutdown that kills a worker
mid-job without letting it finish or requeue is how at-least-once delivery becomes lost work.
`,
    dod: [
      'A queue module registers typed job handlers with payload validation at the consume boundary and a documented retry and backoff policy.',
      'Jobs have bounded concurrency, per-job timeouts, and a dead-letter path after exhausted retries.',
      'A worker drains in-flight jobs on shutdown within a bounded grace period, and requeues rather than loses anything it cannot finish.',
      'Idempotency has a documented, supported story — an idempotency key or a deduplication window — not just advice.',
      '`@Cron` and `@Interval` schedule tasks, with cron parsing tested against a table including DST transitions.',
      'Multi-instance safety is solved and tested: a scheduled task runs once across replicas, or the docs state plainly that it does not and why.',
      'Overlapping runs are prevented by default when a task is slower than its interval.',
      'Both pages flip to supported.',
    ],
    invariants: [
      '§2.3 validation at the boundary: a job payload is untrusted input. Validate at consume, not at enqueue only, because the code that enqueued may be a different version.',
      '§2.7 no hidden state: the scheduler registry and worker pool belong to the app. Two apps in one process must not share them, and nothing registers itself at module load.',
      '§1 cost model: dispatch is through a startup-built map. No scanning of registered patterns or cron expressions per tick.',
      'Bounded by construction: concurrency, per-job timeout, retry count and backoff ceiling all have safe defaults that cannot be removed.',
      'Correctness under scale-out is a requirement, not a documentation note. A feature that silently multiplies with replica count is a defect.',
      'Queue backends are optional peer dependencies.',
    ],
    nonGoals: [
      'Writing a queue. A backend adapter over an existing queue (Redis-based or the transactional outbox) is the scope.',
      'A distributed cron service. Leader election over the database or the queue backend is enough.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] retry, idempotency, drain, and multi-instance scheduling',
        labels: ['spec'],
        goal: 'Freeze the job handler contract, retry and backoff, the dead-letter path, the drain protocol, the idempotency mechanism, cron semantics including DST, and multi-instance coordination. No code.',
        why: 'Every hard part of this epic is a distributed-systems decision that cannot be retrofitted: whether delivery is at-least-once or at-most-once, who owns idempotency, and how two replicas agree on who runs the nightly job. Writing them down forces the awkward questions — like what a cron expression means when the clock jumps forward — to be answered rather than inherited from whatever a library does.',
        files: ['`packages/web/src/queues/SPEC.md` (new)', '`packages/web/src/schedule/SPEC.md` (new)'],
        api: `
export interface JobHandler<T> {
  readonly name: string;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly retries: { readonly attempts: number; readonly backoff: 'exponential' | 'fixed'; readonly ceilingMs: number };
  handle(payload: T, ctx: JobContext): Promise<void>;
}

export interface JobContext {
  readonly attempt: number;
  readonly signal: AbortSignal;         // aborted on timeout and on shutdown
  readonly idempotencyKey: string;
}

export declare function Cron(expression: string, opts?: { readonly timezone?: string; readonly singleton?: boolean }): MethodDecorator;
export declare function Interval(ms: number, opts?: { readonly overlap?: false }): MethodDecorator;
`,
        steps: [
          "Specify the delivery guarantee explicitly — at-least-once — and therefore that handlers must be idempotent. Then specify what the framework does to help: a stable idempotency key derived from the job identity, and a supported deduplication mechanism (a table, or the backend's own). Advice alone is not a deliverable.",
          'Specify retry and backoff with concrete defaults, including jitter (a thundering herd of synchronised retries is the standard failure of an un-jittered exponential backoff) and a ceiling.',
          'Specify the dead-letter path: where an exhausted job goes, what is retained, and how it is inspected and replayed. A dead-letter store nobody can read is a silent data loss.',
          'Specify per-job timeouts driven by `AbortSignal`, and that a timed-out handler is abandoned rather than left running — including the honest limitation that a handler ignoring its signal cannot be stopped, and what the worker does then.',
          'Specify the drain protocol: on shutdown stop claiming new jobs, wait for in-flight jobs up to a grace period, then abort and requeue rather than dropping. Say what happens to a job that neither finishes nor requeues cleanly.',
          'Specify payload validation at consume, and the version-skew behaviour: a payload that fails validation because it was enqueued by older code goes to the dead-letter path with a distinguishable reason, not into an infinite retry.',
          'Specify cron semantics: the expression dialect (which fields, whether seconds are supported), the timezone handling, and DST behaviour — what `0 2 * * *` means on the day 02:00 does not exist, and on the day it happens twice. Every scheduler gets asked this eventually; answer it in the spec.',
          'Specify overlap prevention as the default for both `@Cron` and `@Interval`, and what a skipped run looks like (logged, and whether it is caught up or dropped).',
          "Specify multi-instance coordination: a lease or advisory lock (a database row with a lease expiry, or the backend's primitive), the lease duration relative to the task duration, and what happens when the lease expires mid-task — which is the case that causes a double run if it is not handled. If the decision is to not solve this, say so on the page in the first paragraph.",
          'Specify how a scheduled task or job handler gets container-resolved dependencies and what scope it runs in.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'At-least-once stated, with a supported idempotency mechanism rather than advice.',
          'Retry, jittered backoff, ceiling and a readable/replayable dead-letter path specified.',
          '`AbortSignal` timeouts with the ignoring-handler limitation stated; full drain protocol specified.',
          'Consume-time validation with a distinguishable version-skew outcome that cannot retry forever.',
          'Cron dialect, timezone and both DST cases answered explicitly.',
          'Overlap prevention default and skipped-run behaviour specified.',
          'Multi-instance coordination decided with lease-expiry-mid-task handled, or the limitation stated up front.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] retries, drain, idempotency, DST, and three replicas',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests over a controllable in-memory backend and a fake clock, covering every failure path, plus a multi-instance test that actually runs three schedulers.',
        why: 'The three-replica test is the one that matters most and the one most likely to be skipped as awkward. It is entirely runnable in process: three schedulers sharing one coordination store, asserting the task ran once.',
        files: ['`packages/web/src/queues/queues.spec.ts` (new)', '`packages/web/src/schedule/schedule.spec.ts` (new)'],
        tests: [
          '`validates a job payload at consume and dead-letters an invalid one` — assert the handler never ran and it did not retry forever.',
          '`retries with jittered exponential backoff up to the ceiling` — assert the delay sequence against a fake clock, and that two jobs failing together do not retry simultaneously.',
          '`dead-letters after exhausted attempts, retaining the payload and the last error`.',
          '`replays a dead-lettered job`.',
          '`aborts a handler that exceeds its timeout` and `logs and requeues when a handler ignores its abort signal` — per the spec.',
          '`respects the concurrency limit` — assert peak simultaneous handlers.',
          '`drains in-flight jobs on shutdown within the grace period`.',
          '`requeues an unfinished job rather than losing it when the grace period expires`.',
          '`deduplicates a job with a repeated idempotency key`.',
          '`fires a cron task at the expected times` — table-driven against a fake clock.',
          '`handles a spring-forward cron time that does not exist` and `handles a fall-back cron time that occurs twice` — the two DST cases, asserted per the spec.',
          '`honours the configured timezone rather than the host timezone`.',
          '`does not overlap a task that runs longer than its interval, and records the skip`.',
          '`runs a scheduled task exactly once across three concurrent schedulers` — the headline test.',
          '`does not double-run when a lease expires mid-task` — expire the lease deliberately and assert the specified behaviour.',
          '`does not share a scheduler registry between two apps in one process`.',
          '`resolves handler dependencies from the container in the specified scope`.',
        ],
        steps: [
          'Build a fake clock and an in-memory backend that can be told to fail, delay and lose messages, so every path in the spec is reachable deterministically.',
          'Write the three-replica test with three real scheduler instances over one shared coordination store; that is a genuine test of the mechanism, not a mock of it.',
          'Write the DST tests with explicit real dates and a real timezone, since that is the only way they mean anything.',
        ],
        dod: [
          'Every retry, timeout, drain and dead-letter path tested against a fake clock and a controllable backend.',
          'Idempotency deduplication asserted.',
          'Cron table plus both DST cases and a non-host timezone tested.',
          'Overlap prevention, per-app isolation and container resolution asserted.',
          'Exactly-once-across-three-schedulers and lease-expiry-mid-task both tested.',
        ],
      },
      {
        key: 'queues',
        title: 'The queue module and worker runtime',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship typed job registration, consume-time validation, retries with jittered backoff, dead-lettering with replay, bounded concurrency, timeouts and a correct drain.',
        files: [
          '`packages/web/src/queues/index.ts` (new)',
          '`packages/web/src/queues/backends/` (new) — an in-memory backend and one real adapter.',
          '`packages/web/package.json` — a `./queues` subpath.',
        ],
        steps: [
          'Register handlers explicitly through a module and build the dispatch map at startup.',
          'Validate at consume with an AOT-emitted validator, and route a validation failure to the dead-letter path with a reason that distinguishes it from a handler failure — otherwise a bad deploy looks like a flaky handler.',
          'Implement retries with jitter and a ceiling, and make the attempt count visible to the handler so it can behave differently on a last attempt.',
          'Implement the dead-letter store so it is readable and replayable through a supported API, not just a table someone might query.',
          'Drive timeouts and shutdown from one `AbortSignal` per job, so a handler has a single thing to observe.',
          'Implement the drain: stop claiming, wait, then abort and requeue. Wire it to the existing `OnShutdown`/`AsyncDisposable` lifecycle rather than a process signal handler inside library code.',
          'Provide the idempotency key and the deduplication mechanism the spec chose.',
          'Ship one real backend adapter (Redis-based is the obvious choice) as an optional peer dependency, and keep the in-memory one supported for tests since that is what users will want too.',
        ],
        tests: ['All queue tests green, including drain, requeue, dead-letter replay and deduplication.'],
        dod: [
          'Startup-built dispatch; consume-time validation with a distinguishable version-skew outcome.',
          'Jittered retries with a ceiling; readable and replayable dead-letter store.',
          'One `AbortSignal` per job covering timeout and shutdown; drain requeues rather than loses.',
          'Idempotency supported concretely; one real backend as an optional peer dependency.',
        ],
      },
      {
        key: 'schedule',
        title: 'Cron and interval scheduling that survives scale-out',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship `@Cron` and `@Interval` with a tested cron implementation, timezone and DST handling, overlap prevention, and coordination so a task runs once across replicas.',
        why: 'The scheduling API is small; the multi-instance guarantee is the work. It is also the difference between a feature people can trust with billing and one they cannot.',
        files: [
          '`packages/web/src/schedule/index.ts` (new)',
          '`packages/web/src/schedule/lease.ts` (new) — coordination.',
        ],
        steps: [
          'Compute next-fire times from a real cron implementation, and decide whether to depend on a maintained parser or implement one. Either is defensible; if implementing, the DST cases are the reason it needs the full test table.',
          'Handle timezones explicitly and never fall back to the host timezone silently — a task scheduled without a timezone on a UTC container and a local-time laptop behaves differently, and that surprise should be a required parameter or a documented default, not an accident.',
          'Implement both DST behaviours per the spec, and comment the reasoning at the code, because it will look like a bug to the next reader.',
          'Prevent overlap by default, log a skip, and make catch-up behaviour explicit.',
          'Implement leasing: acquire before running, renew during a long task, and handle expiry mid-task the way the spec chose. Renewal is what stops a long task from being double-run, and it is the part that is usually missing.',
          'Build the tick loop so it does not scan every expression per tick — compute next-fire times and sleep to the earliest.',
          'Own the registry at the app level so two apps in one process are independent.',
        ],
        tests: [
          'All schedule tests green including the cron table, both DST cases, a non-host timezone, and overlap prevention.',
          '`runs a scheduled task exactly once across three concurrent schedulers`.',
          '`does not double-run when a lease expires mid-task`.',
        ],
        dod: [
          'Cron correctness including both DST cases, with reasoning commented; timezone never silently host-derived.',
          'Overlap prevented by default with explicit catch-up behaviour.',
          'Leasing with renewal and defined expiry behaviour; exactly-once across replicas tested.',
          'Tick loop sleeps to the earliest next fire; registry app-owned.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] queues and task scheduling',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['queues', 'schedule'],
        goal: 'Flip both pages to supported, leading with the two things that bite: idempotency and scale-out.',
        files: ['`docs-site/pages.mjs`', 'the two content files'],
        steps: [
          'Open the queues page with at-least-once delivery and what it obliges a handler to do, then show the supported deduplication mechanism. A reader who skims should still learn that handlers must be idempotent.',
          'Document retries, jitter, the dead-letter store and how to inspect and replay it, since that is what an on-call engineer needs at 3am.',
          'Document the drain and the grace period, including that a handler ignoring its abort signal cannot be stopped.',
          'Open the scheduling page with the scale-out question and the answer, because that is the mistake this page exists to prevent.',
          'Document the cron dialect, timezone requirement and both DST behaviours with worked dates.',
          'Document overlap prevention and skipped-run logging.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Both pages supported; idempotency and multi-instance behaviour documented first; dead-letter inspection, drain limits and DST behaviour all covered with worked examples.',
        ],
      },
    ],
  },

  {
    key: 'messaging',
    title: '[EPIC] Application messaging — events, CQRS, and a transactional outbox',
    labels: ['enhancement', 'area:web', 'area:query', 'parity:nestjs'],
    pages: ['web-events', 'web-cqrs', 'transactional-outbox'],
    packages: ['@zmdb/web', '@zmdb/query-compiler', '@zmdb/repository'],
    motivation: `
"no application event emitter module; EventBus covers entity lifecycle only", "no command/query bus or saga
runtime", and "no outbox table helper and no dispatcher loop".

\`EventBus\` exists (packages/repository/src/entity-modeling/index.ts:17) but it is about entity lifecycle,
which is a different thing from an application event. So the first gap is real but small.

The third is the one that justifies the epic, and it is worth stating why rather than treating it as a
third feature. The dual-write problem is the most common correctness bug in service architectures: a
handler writes a row and publishes an event, the publish fails, and the system is now inconsistent with no
record that it happened. The transactional outbox fixes it by writing the event to a table in the same
transaction as the data, and dispatching from there. zmdb owns the transaction and the schema, which means
it can offer this properly — declare an outbox table, publish inside a transaction, and a dispatcher does
the rest. Very few data layers are positioned to do that, and it is the most valuable single thing in this
epic.

CQRS is the piece to be most careful with, and honestly it is the one most at risk of being
over-engineered. A command bus that adds indirection without adding a property is exactly the
over-abstraction §2.6 warns about. It earns its place only if it gives something concrete: typed
command-to-result mapping enforced at compile time, one place where validation and authorisation happen,
and a saga runtime with real compensation semantics. If the saga part is cut, the rest is a function call
with extra steps — so the spec should decide that deliberately, and be willing to scope CQRS down to what
carries weight.
`,
    dod: [
      'An application event emitter supports typed events, sync and async handlers, and error isolation so one failing handler does not stop the others.',
      'The relationship to the existing entity-lifecycle `EventBus` is clear: either unified or explicitly separate with a documented reason.',
      'A command/query bus provides compile-time-checked command-to-result typing, one validation and authorisation point, and either a saga runtime with compensation or a written decision not to ship one.',
      'An outbox table can be declared, events can be published inside a transaction, and a dispatcher delivers them at least once with ordering guarantees stated.',
      'The dispatcher is safe with multiple instances, does not lose events on crash, and cannot spin on a permanently failing event.',
      'A test proves the dual-write property: an event published in a rolled-back transaction is never delivered.',
      'All three pages flip to supported.',
    ],
    invariants: [
      '§2.6 no over-abstraction, applied hardest here: every layer must carry a property that a direct call does not. The spec must be willing to cut CQRS features that do not.',
      '§2.7 no hidden state: emitters, buses and dispatchers are app-owned. No module-level singleton bus.',
      '§2.3 validation at the boundary: an event read back from the outbox table is deserialised external data and gets validated.',
      '§2.4 explicit SQL: the outbox table is a declared schema object with a real migration, not a magic table created at runtime.',
      'Transactional integrity is the point: an event published in a transaction that rolls back must not be delivered, and that must be a test rather than a claim.',
      '§1 cost model: handler dispatch resolves through a startup-built map; the dispatcher poll must not be a busy loop.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] event typing, what CQRS must earn, and outbox delivery semantics',
        labels: ['spec'],
        goal: 'Freeze the event model and its relationship to `EventBus`, decide exactly which CQRS pieces earn their abstraction, and freeze the outbox schema, publish path, dispatcher semantics and ordering guarantees. No code.',
        why: 'Two different kinds of decision. The outbox needs precision because delivery semantics are what make it trustworthy. CQRS needs restraint: this is the place to decide against features, and doing that in the spec is much cheaper than deleting them after they ship with a compatibility promise attached.',
        files: [
          '`packages/web/src/events/SPEC.md` (new)',
          '`packages/web/src/cqrs/SPEC.md` (new)',
          '`packages/query-compiler/src/outbox/SPEC.md` (new)',
        ],
        api: `
export declare function OnEvent<T>(event: EventType<T>): MethodDecorator;
export interface EventEmitter {
  emit<T>(event: EventType<T>, payload: T): Promise<void>;
  emitInTransaction<T>(tx: Transaction, event: EventType<T>, payload: T): Promise<void>;  // via the outbox
}

/** A command's result type is part of its identity, so a wrong-typed handler is a compile error. */
export interface Command<Result> { readonly _result?: Result }
export declare function CommandHandler<C extends Command<unknown>>(command: new (...a: never[]) => C): ClassDecorator;

export interface OutboxRecord {
  readonly id: string;
  readonly topic: string;
  readonly payload: string;
  readonly createdAt: Date;        // TIMESTAMPTZ in postgres, ISO string in OpenAPI
  readonly deliveredAt: Date | null;
  readonly attempts: number;
  readonly lastError: string | null;
}
`,
        steps: [
          'Specify typed events and how a handler is bound. Decide the relationship to the existing entity-lifecycle `EventBus`: unify if the semantics genuinely match, and if not, say plainly why there are two things and how a user chooses.',
          'Specify error isolation: one handler throwing must not prevent the others, and specify where the error goes. Also specify whether `emit` waits for handlers — awaiting all of them makes an event emitter a synchronous fan-out with the latency of its slowest handler, which surprises people. Pick and document.',
          'Specify ordering: whether handlers run in registration order or concurrently, and that a caller must not depend on ordering unless it is guaranteed.',
          'For CQRS, go feature by feature and require each to name a property it provides. Compile-time command-to-result typing: yes, that is real and hard to get otherwise. A single validation and authorisation point: yes. A separate query bus: probably not — say why, since read paths already go through repositories. Event sourcing: out of scope, and say so. Sagas: decide, and if yes, specify compensation precisely (what runs when step three fails, whether compensations can fail, and what happens then — an uncompensatable failure needs a defined terminal state).',
          'Be explicit that scoping CQRS down is a legitimate outcome, and record what was cut and why, so it is not re-proposed as an oversight.',
          'Specify the outbox table as a declared schema object with a migration, its columns and indexes (a partial index on undelivered rows is what keeps the dispatcher query cheap — specify it, and note the dialect support).',
          "Specify the publish path: `emitInTransaction` writes to the outbox in the caller's transaction, so rollback discards the event. State the guarantee and require a test for it.",
          'Specify the dispatcher: how it claims rows (a lease column or `FOR UPDATE SKIP LOCKED` — name the mechanism per dialect, and say what happens on a dialect without `SKIP LOCKED`), batch size, poll interval with backoff when idle, retry policy, and the terminal state for a permanently failing event. Without that last one the dispatcher spins forever on one bad row and delivers nothing else.',
          'Specify ordering guarantees honestly: per-topic ordering with a single dispatcher, no global ordering with several. Say which, because users will assume more than is true.',
          'Specify duplicate delivery: at-least-once, so consumers need idempotency, cross-referencing the queue epic rather than restating it.',
          'Specify multi-instance dispatcher safety and what happens when a dispatcher crashes after delivering but before marking delivered — that is the duplicate, and it should be named as the reason at-least-once is the guarantee.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Event model specified with the `EventBus` relationship resolved, error isolation, await semantics and ordering all decided.',
          'Each CQRS feature justified by a named property or cut, with the cuts recorded as decisions.',
          "Outbox table specified as a real declared object with the dispatcher's index; publish-in-transaction guarantee stated with a required test.",
          'Dispatcher claiming, batching, backoff, retries and a terminal state for permanently failing events specified, per dialect.',
          'Ordering and at-least-once guarantees stated honestly, with the crash-after-delivery duplicate named.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] the rollback guarantee, dispatcher failure modes, and command typing',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests: the transactional guarantee against a real database, dispatcher crash and contention cases, event error isolation, and type-tests for command-to-result typing.',
        why: 'One test in this list is the epic: an event published in a rolled-back transaction is never delivered. Everything else supports it. The dispatcher failure tests come next, because a dispatcher that stalls on a bad row is an outage that looks like a quiet queue.',
        files: [
          '`packages/web/src/events/events.spec.ts` (new)',
          '`packages/web/src/cqrs/cqrs.type-test.ts`, `cqrs.spec.ts` (new)',
          '`packages/query-compiler/src/outbox/outbox.spec.ts` (new)',
        ],
        tests: [
          '`never delivers an event published in a rolled-back transaction` — real database, real transaction, real rollback. The headline test.',
          '`delivers an event published in a committed transaction exactly once under normal operation`.',
          '`may deliver twice when the dispatcher crashes after delivery but before marking delivered` — assert the documented behaviour rather than pretending it cannot happen.',
          '`does not deliver the same row twice from two concurrent dispatchers` — real contention, two dispatchers, one table.',
          '`moves a permanently failing event to a terminal state and keeps delivering the rest` — the anti-stall test.',
          '`backs off when the outbox is empty rather than polling hot` — assert the query count over time.',
          '`uses the partial index for the undelivered query` — assert the plan on a dialect that can show it, since this is what keeps the dispatcher cheap as the table grows.',
          '`validates an event payload read back from the outbox`.',
          '`isolates a throwing event handler from the others` — assert the other handlers ran and the error was reported.',
          '`emits with the specified await semantics` — per the decision.',
          '`fails to compile a command handler whose result type does not match the command` — type-test, the CQRS property that justifies the bus.',
          '`validates and authorises in one place for every command` — assert a command cannot bypass it.',
          '`compensates completed steps when a saga step fails` and `reaches the specified terminal state when a compensation itself fails` — if sagas ship.',
          '`does not share an emitter or dispatcher between two apps in one process`.',
        ],
        steps: [
          'Write the rollback test against a real database — this cannot be proven with a driver double, because the guarantee is about the database transaction.',
          'Write the two-dispatcher test with genuine concurrency against the real claiming mechanism; a mock would assert only that our code calls what we think it calls.',
          'Write the anti-stall test with a row that always fails, and assert a later row is still delivered.',
        ],
        dod: [
          'Rollback guarantee tested against a real database and transaction.',
          'Dispatcher tested for concurrency, crash duplication, stalling, idle backoff and index usage.',
          'Event isolation and await semantics asserted; per-app isolation asserted.',
          'Command-to-result typing enforced by type-test; saga compensation covered if in scope.',
        ],
      },
      {
        key: 'outbox',
        title: 'The transactional outbox and dispatcher',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship the declared outbox table, publish-inside-transaction, and a dispatcher that is multi-instance safe, cannot stall, and does not poll hot.',
        why: 'The most valuable slice in the epic, and it goes first because the events and CQRS work reads better once transactional publishing exists — an event emitter that can publish transactionally is a different thing from one that cannot.',
        files: [
          '`packages/query-compiler/src/outbox/index.ts` (new) — table declaration and dispatcher.',
          '`packages/repository/src/index.ts` — publishing within a transaction.',
          '`packages/query-compiler/src/migrations/index.ts` — the outbox table in a migration.',
        ],
        steps: [
          'Declare the outbox table as a normal schema object so it appears in snapshots and migrations like any other table — no runtime table creation (§2.4).',
          'Follow the project timestamp rule for `createdAt`/`deliveredAt`: `Date` in Node, `TIMESTAMPTZ` in Postgres, ISO string in any generated document.',
          'Create the partial index on undelivered rows, with the dialect fallback where partial indexes are unavailable, and note the cost difference in a comment.',
          "Implement publishing on the caller's transaction so the guarantee comes from the database and not from ordering in our code. Make it impossible to publish transactionally without a transaction handle.",
          'Implement claiming with `FOR UPDATE SKIP LOCKED` where available and the specified alternative elsewhere, so two dispatchers never claim one row.',
          'Implement the retry policy and the terminal state, so one poison row cannot stall the queue.',
          'Implement idle backoff so an empty outbox does not generate constant queries, and cap the interval.',
          'Validate payloads on read (§2.3) and route a payload that fails validation to the terminal state rather than retrying forever.',
          'Wire the dispatcher into the app lifecycle so it stops cleanly, finishing or releasing whatever it has claimed.',
        ],
        tests: [
          'All outbox tests green, including the rollback guarantee, two-dispatcher contention, anti-stall, backoff and index usage.',
        ],
        dod: [
          'Outbox is a declared table in migrations with dialect-correct timestamps and a partial index (or a documented fallback).',
          'Transactional publishing enforced by the API; claiming safe under concurrency.',
          'Poison rows terminate; idle polling backs off; payloads validated on read.',
          'Dispatcher participates in the app lifecycle and releases claims on shutdown.',
        ],
      },
      {
        key: 'events',
        title: 'The application event emitter',
        labels: ['enhancement'],
        blockedBy: ['outbox'],
        goal: 'Ship typed application events with error isolation, the decided await semantics, and transactional emission through the outbox.',
        files: [
          '`packages/web/src/events/index.ts` (new)',
          '`packages/repository/src/entity-modeling/index.ts` — the `EventBus` relationship.',
        ],
        steps: [
          'Register handlers explicitly and build the dispatch map at startup.',
          "Isolate handler errors, report them through the app's error path, and never let one handler's failure hide another's success.",
          'Implement the decided await semantics and make the choice visible at the API, so a caller is not surprised by either latency or fire-and-forget.',
          'Wire `emitInTransaction` to the outbox so a transactional event is durable with its data.',
          'Resolve the `EventBus` relationship as the spec decided — unify or document the split at both call sites, so a user reading either one finds out about the other.',
          'Own the emitter at the app level.',
        ],
        tests: [
          'All event tests green, including isolation, await semantics, transactional emission and per-app isolation.',
        ],
        dod: [
          'Startup-built dispatch; handler errors isolated and reported.',
          'Await semantics implemented and evident at the API; transactional emission goes through the outbox.',
          '`EventBus` relationship resolved and cross-documented; emitter app-owned.',
        ],
      },
      {
        key: 'cqrs',
        title: 'The command bus, scoped to what it earns',
        labels: ['enhancement'],
        blockedBy: ['events'],
        goal: 'Ship the command bus with compile-time command-to-result typing and a single validation/authorisation point, plus sagas if the spec kept them — and nothing that does not carry a property.',
        why: 'Deliberately last and deliberately smallest. The value is the typing and the single boundary; the risk is building a message-passing layer that adds indirection to a function call. If the spec cut sagas, this slice is small and that is the correct outcome.',
        files: ['`packages/web/src/cqrs/index.ts` (new)', '`packages/web/package.json` — a `./cqrs` subpath.'],
        steps: [
          'Implement command-to-result typing so a handler returning the wrong type is a compile error, with no `as` anywhere in the mechanism (§2.5). This is the property that justifies the bus, so it must be airtight.',
          'Make validation and authorisation happen in the bus for every command, with no bypass — that single boundary is the second justification.',
          'Implement sagas only if the spec kept them, with compensation running in reverse order and a defined terminal state when a compensation fails. A saga that can silently leave a half-completed workflow is worse than no saga.',
          'Resolve handlers from the container in the specified scope.',
          'Implement nothing the spec cut, and leave a note in the spec pointing at the reasoning rather than a TODO in the code.',
          'Check the type-instantiation budget — a command-to-result mapping over a registry is exactly the pattern that inflates it.',
        ],
        tests: [
          'Command typing type-tests green; single-boundary validation asserted with no bypass.',
          'Saga compensation and compensation-failure tests green if in scope.',
          '`yarn verify:instantiations` within budget.',
        ],
        dod: [
          'Command-to-result typing enforced at compile time with no assertions; validation and authorisation unbypassable.',
          'Sagas shipped with reverse compensation and a defined terminal state, or explicitly absent per the spec.',
          'Nothing shipped that the spec cut; instantiation budget respected.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] application events, CQRS, and the transactional outbox',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['outbox', 'events', 'cqrs'],
        goal: 'Flip all three pages to supported, leading the outbox page with the dual-write problem and being explicit about what CQRS does and does not include.',
        files: ['`docs-site/pages.mjs`', 'the three content files'],
        steps: [
          'Open the outbox page with the dual-write problem stated concretely — write the row, publish fails, systems diverge — then show that publishing in the transaction removes it. That framing is why the feature exists.',
          'Document the guarantees exactly: at-least-once, per-topic ordering with one dispatcher, no global ordering with several, and duplicates on a crash after delivery. Overstating any of these would be worse than the missing feature was.',
          "Document the dispatcher's operational behaviour: batch size, backoff, retries, the terminal state, and how to find and replay terminal rows.",
          "Document the event emitter's await semantics and error isolation, and the relationship to entity-lifecycle events with guidance on which to use.",
          'Document what CQRS includes and — with the same prominence — what it deliberately does not, with the reasoning. A page that explains why there is no query bus is more useful than one that quietly lacks it.',
          'Cross-link idempotency guidance to the queues page rather than repeating it.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Three pages supported; dual-write framing leads the outbox page; guarantees stated without overstatement; CQRS omissions documented as decisions.',
        ],
      },
    ],
  },
];
