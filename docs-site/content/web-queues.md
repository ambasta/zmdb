## What ships

The queue has two public constructors:

- `createQueue<Jobs>({ store, clock })` inserts typed jobs, including delayed jobs and enqueue-side deduplication.
- `createWorker<Jobs>(options)` claims jobs under a lease, validates at consume, applies bounded retries, exposes dead letters and drains on shutdown.

The durable declarations are `JobRow` and `JobDoneRow` from `@zmdb/repository/jobs`. Generate their tables through the same tagged-schema migration path as application tables, and include `jobPendingIndexDdl(dialect)`. The pending index is partial on Postgres and SQLite and status-leading on MySQL. The supported in-memory backend installs the same shape automatically because it is ephemeral test storage.

`JobStore` is structural: a zmdb `Driver` satisfies it directly, and a transaction satisfies `enqueueInTransaction`. The package also ships an isolated SQLite memory backend and a node-postgres adapter. `pg` is an optional peer, so the core queue entry does not load it.

## Choosing a backend

For tests and local process-only work, the memory backend is ready immediately:

```ts
import { createMemoryJobStore } from '@zmdb/web/queues/backends/memory';

using store = createMemoryJobStore();
```

It creates `zmdb_job`, `zmdb_job_done`, the unique `dedupe_key` constraint and the pending-claim index in a fresh `node:sqlite` `:memory:` database. `store.database` is exposed for deterministic seed and assertion queries. Closing or disposing the store destroys all rows.

For durable Postgres storage, install the optional peer and adapt a caller-owned pool:

```sh
npm add pg
```

```ts
import { Pool } from 'pg';
import { createPgJobStore } from '@zmdb/web/queues/backends/pg';

const pool = new Pool({ connectionString: env.DATABASE_URL });
const store = createPgJobStore(pool);
```

The adapter does not create tables, open a second pool or close the supplied client. Apply the `JobRow`/`JobDoneRow` migration first, and close the pool in the application's normal database lifecycle.

## Registering typed work

```ts
import { createQueue, createWorker, type Clock, type JobHandler } from '@zmdb/web/queues';

type Jobs = {
  readonly 'email.send': { readonly userId: number };
  readonly 'audit.write': { readonly message: string };
};

const clock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  },
};

const sendEmail: JobHandler<Jobs, 'email.send'> = {
  name: 'email.send',
  validate(raw) {
    if (typeof raw !== 'object' || raw === null || !('userId' in raw) || typeof raw.userId !== 'number') {
      throw new Error('email.send requires a numeric userId');
    }
    return { userId: raw.userId };
  },
  async handle(payload, ctx) {
    await mailer.send(payload.userId, { idempotencyKey: ctx.idempotencyKey });
  },
};

const queue = createQueue<Jobs>({ store: driver, clock });
const worker = createWorker<Jobs>({
  handlers: [sendEmail],
  store: driver,
  clock,
  concurrency: 8,
  graceMs: 10_000,
  leaseMs: 60_000,
  onDead: job => alerts.deadJob(job),
  onHandlerError: (ctx, error) => logger.error({ jobId: ctx.jobId, error }),
});

worker.start();
await queue.enqueue('email.send', { userId: 42 });
```

Registration is explicit and by value. `createWorker` builds one dispatch `Map` at startup; there is no module scan, decorator side effect or process-global registry. Build handlers through the container first when they have injected dependencies, then pass those instances in the `handlers` array.

The worker itself implements `onShutdown()`. Register a value instance as a provider, or resolve a factory provider before it is needed, and application disposal drains it automatically. The worker has no `onModuleInit`, so start it explicitly during bootstrap. It does not install process signal handlers.

## Transactions, delay and enqueue deduplication

Use the transaction overload when creating a row and its job must be atomic:

```ts
await db.transaction(async tx => {
  const order = await orderRepo.withTransaction(tx).create(dto);
  await queue.enqueueInTransaction(
    tx,
    'audit.write',
    { message: `order ${order.id} created` },
    { dedupeKey: `order-created:${order.id}` },
  );
});
```

A repeated `dedupeKey` returns the original job id. The unique `dedupe_key` column is the race-safe part; the read before insert only avoids an expected constraint error in the ordinary repeated-call path.

`delayMs` writes the lease into the future:

```ts
await queue.enqueue('email.send', { userId: 42 }, { delayMs: 60_000 });
```

Priority is deliberately absent. Under lease claiming, a priority column can starve old work indefinitely; use separate workers and handler sets when work needs separate capacity.

## Validation and retries

Payloads are stored as text and parsed and validated when consumed. This is a version boundary: an older deploy may have written the row.

- Invalid JSON or a validator failure goes dead immediately as `invalid-payload`.
- A name with no registered handler retries under the worker policy, then goes dead as `unknown-name`. This allows a rolling deployment's worker to catch up with a newer enqueuer.
- A thrown or timed-out handler retries and eventually goes dead as `attempts-exhausted`.

The default is five attempts with exponential backoff from one second to a five-minute ceiling. Every delay gets proportional jitter in `[75%, 125%)`; fixed backoff is jittered too. A handler may override its timeout and retry policy or lower its concurrency, but cannot raise its concurrency above the worker's process-wide bound.

`leaseMs` must be strictly greater than the worker timeout and every handler timeout override. This keeps a live handler's row out of another worker's claim set for its entire execution window.

`ctx.attempt` is one-based. `ctx.signal` is aborted on timeout and after the shutdown grace period. A timed-out handler that ignores the signal keeps occupying its concurrency slot until its promise settles, so the configured bound continues to count the work actually running.

## At-least-once and the completion marker

Delivery is at-least-once. The crash window is unavoidable: a handler can commit its effect and the process can die before the worker marks the job done.

The framework supplies a stable key:

```ts
ctx.idempotencyKey === (dedupeKey ?? jobId);
```

For an effect that must happen once, write `ctx.idempotencyKey` to `zmdb_job_done` in the same transaction as the effect. The worker checks that table before invoking the handler. This turns a later retry or replay into `done` with `skipped: 1`.

The worker cannot write that marker around the handler safely. Writing it first creates a lost-job window; writing it afterwards cannot be atomic with an application effect in another transaction. The handler owns the only transaction that can make those two writes one fact.

Marker cleanup is not automatic yet. Retention must exceed the retry and manual-replay horizon; #589 owns the scheduled cleanup path. Until then, applications retain or remove marker rows through their own operational policy.

## Dead letters and replay

Dead rows remain in `zmdb_job` and are available through bounded APIs:

```ts
const invalid = await worker.listDead({
  limit: 100,
  reason: 'invalid-payload',
});

const first = invalid[0];
if (first !== undefined) await worker.replay(first.jobId);
```

`replay` resets the same row and its attempt count. Reusing the id is load-bearing: if a completion marker already exists, the replay is skipped instead of assigning the work a fresh identity and running it twice.

## Drain and multiple workers

Claiming is a three-statement lease protocol: select candidates, conditionally update their lease, then read back only rows carrying this batch's random token. The conditional update is the arbitration, so several workers can share one table without `FOR UPDATE SKIP LOCKED` or a transaction held for the duration of a handler.

On shutdown the worker:

1. stops claiming and aborts any idle sleep;
2. waits up to `graceMs`;
3. aborts unfinished job signals;
4. writes their lease back to the current instant without incrementing attempts.

If that final write fails, the original lease still expires and another worker claims the row later. Work becomes late rather than silently lost.

## Backend boundary

The worker has one SQL-shaped `JobStore` state machine. The shipped memory backend implements it with `node:sqlite`; the shipped real adapter maps node-postgres `Pool`/`Client` objects through the repository's `pgDriver`. Redis, SQS and BullMQ adapters are not hidden dependencies or aliases for this SQL contract.

Recurring work remains [Task Scheduling](./web-task-scheduling.html). The scheduler should enqueue short, deduplicated jobs rather than perform durable work in its lease-holding callback.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Task Scheduling](./web-task-scheduling.html) · [Standalone Applications](./web-standalone.html)
