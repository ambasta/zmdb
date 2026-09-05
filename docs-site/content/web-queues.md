## Delivery is at-least-once: make the effect idempotent

A worker can commit an effect and die before it marks the job done. That crash window makes delivery **at-least-once**, so every handler must make a repeated invocation harmless. Scaling from one
worker to many does not change that obligation.

The framework gives every invocation a stable key:

```ts
ctx.idempotencyKey === (dedupeKey ?? jobId);
```

For an effect that must happen once, write `ctx.idempotencyKey` to `zmdb_job_done` in the same transaction as the effect. The worker checks that table before invoking the handler. A later retry or
replay then finishes as `done` with `skipped: 1`.

The worker cannot safely write the marker around the handler: writing it first can lose work, while writing it afterwards cannot be atomic with an application effect in another transaction. The
handler owns the only transaction that can make the effect and marker one fact.

Enqueue-side deduplication solves a different race. Repeating a non-empty `dedupeKey` returns the existing job id because `dedupe_key` has a unique constraint. Use both mechanisms when both duplicate
enqueue and duplicate delivery matter.

Marker cleanup is deliberately application policy. Retention must exceed the retry and manual-replay horizon, and the framework cannot infer either value. The shipped scheduler can trigger cleanup,
but it does not choose the retention interval.

## What ships

The queue has two public constructors:

- `createQueue<Jobs>({ store, clock })` inserts typed jobs, including delayed jobs and enqueue-side deduplication.
- `createWorker<Jobs>(options)` claims jobs under a lease, validates at consume, applies bounded retries, exposes dead letters and drains on shutdown.

The durable declarations are `JobRow` and `JobDoneRow` from `@zmdb/repository/jobs`. Generate their tables through the same tagged-schema migration path as application tables, and include
`jobPendingIndexDdl(dialect)`. The pending index is partial on the Postgres family, SQLite and SQL Server, and status-leading on the MySQL family. The supported in-memory backend installs the same
shape automatically because it is ephemeral test storage.

`JobStore` is structural: a zmdb `Driver` satisfies it directly, and a transaction satisfies `enqueueInTransaction`. Core jobs ships one isolated SQLite memory backend and no external client or
runtime peer.

## Choosing a backend

For tests and local process-only work, the memory backend is ready immediately:

```ts
import { createMemoryJobStore } from '@zmdb/jobs/memory';

using store = createMemoryJobStore();
```

It creates `zmdb_job`, `zmdb_job_done`, the unique `dedupe_key` constraint and the pending-claim index in a fresh `node:sqlite` `:memory:` database. `store.database` is exposed for deterministic seed
and assertion queries. Closing or disposing the store destroys all rows.

For durable storage, pass the same structural `Driver` or transaction connection the application already owns. Core jobs does not open, wrap, or close an external database client. Apply the
`JobRow`/`JobDoneRow` migration first and keep connection lifecycle with the database owner.

For a caller-owned node-postgres pool, install the dedicated adapter:

```bash
npm add @zmdb/jobs-postgres pg
```

```ts
import { createPgJobStore } from '@zmdb/jobs-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = createPgJobStore(pool, {
  prepared: true,
  maxCacheSize: 128,
});
```

The adapter delegates parameterized and prepared execution to the repository PostgreSQL driver but does not create, end, or release the supplied pool/client. The application remains responsible for
pool shutdown.

## Registering typed work

```ts
import { createQueue, createWorker, jobsExtension, type Clock, type JobHandler } from '@zmdb/jobs';

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

await queue.enqueue('email.send', { userId: 42 });

const backgroundWork = jobsExtension({ workers: [worker] });
```

Registration is explicit and by value. `createWorker` builds one dispatch `Map` at startup; there is no module scan, decorator side effect or process-global registry. Build handlers through the
container first when they have injected dependencies, then pass those instances in the `handlers` array.

Pass `backgroundWork` in `createApplication(..., { extensions: [backgroundWork] })` or `createApp(..., { extensions: [backgroundWork] })`. App initialization starts the worker after bootstrap;
application disposal stops intake and drains it within the remaining app-wide grace budget. Standalone programs may call `worker.start()` and `worker.onShutdown()` directly. No process signal handler
is installed.

## Transactions, delay and enqueue deduplication

Use the transaction overload when creating a row and its job must be atomic:

```ts
await db.transaction(async tx => {
  const order = await orderRepo.withTransaction(tx).create(dto);
  await queue.enqueueInTransaction(tx, 'audit.write', { message: `order ${order.id} created` }, { dedupeKey: `order-created:${order.id}` });
});
```

A repeated `dedupeKey` returns the original job id. The unique `dedupe_key` column is the race-safe part; the read before insert only avoids an expected constraint error in the ordinary repeated-call
path.

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

The default is five attempts with exponential backoff from one second to a five-minute ceiling. Every delay gets proportional jitter in `[75%, 125%)`; fixed backoff is jittered too. A handler may
override its timeout and retry policy or lower its concurrency, but cannot raise its concurrency above the worker's process-wide bound.

`leaseMs` must be strictly greater than the worker timeout and every handler timeout override. This keeps a live handler's row out of another worker's claim set for its entire execution window.

`ctx.attempt` is one-based. `ctx.signal` is aborted on timeout and after the shutdown grace period. A timed-out handler that ignores the signal keeps occupying its concurrency slot until its promise
settles, so the configured bound continues to count the work actually running.

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

`replay` resets the same row and its attempt count. Reusing the id is load-bearing: if a completion marker already exists, the replay is skipped instead of assigning the work a fresh identity and
running it twice.

## Drain and multiple workers

Claiming is a three-statement lease protocol: select candidates, conditionally update their lease, then read back only rows carrying this batch's random token. The conditional update is the
arbitration, so several workers can share one table without `FOR UPDATE SKIP LOCKED` or a transaction held for the duration of a handler.

On shutdown the worker:

1. stops claiming and aborts any idle sleep;
2. waits up to `graceMs`;
3. aborts unfinished job signals;
4. writes their lease back to the current instant without incrementing attempts.

An abort signal is cooperative. A handler that ignores `ctx.signal` cannot be forcibly stopped and keeps occupying its concurrency slot until its promise settles. Drain still returns after the bounded
grace period and requeues the row; the old JavaScript invocation may therefore overlap its replacement, which is another reason the effect must be idempotent.

If the final lease write fails, the original lease still expires and another worker claims the row later. Work becomes late rather than silently lost.

## Backend boundary

The worker has one SQL-shaped `JobStore` state machine. The built-in memory backend implements it with `node:sqlite`. External database and broker integrations are separately installed packages or
application-owned structural adapters; Redis, SQS and BullMQ are not hidden dependencies or aliases for this SQL contract.

Recurring work remains [Task Scheduling](./web-task-scheduling.html). The scheduler should enqueue short, deduplicated jobs rather than perform durable work in its lease-holding callback.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Task Scheduling](./web-task-scheduling.html) · [Standalone Applications](./web-standalone.html)
