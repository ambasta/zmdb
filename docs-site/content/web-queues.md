> **ToDo / feature gap.** There is no queue module — no `BullModule`, no
> `@Processor`, no `@Process`. There is also no worker runtime; a zmdb application
> is a request handler.

## What matters more than the queue module

The [transactional outbox](./transactional-outbox.html) solves the problem that queue integrations usually get wrong: enqueueing atomically with the state change. It is a pattern you assemble from existing pieces rather than a shipped helper — that page's banner says so, and an earlier version of this sentence claimed it was "in the project", which it is not.

```ts
await db.transaction(async tx => {
  const post = await postRepo.withTransaction(tx).create(dto);
  await outbox.withTransaction(tx).create({
    id: globalThis.crypto.randomUUID(),
    topic: 'post.created',
    payload: JSON.stringify({ id: post.id }),
    status: 'pending',
  });
  return post;
});
```

Compare with enqueueing to Redis inside a database transaction. If the transaction rolls back, the job is already queued and processes a row that does not exist. If the process dies after commit and before the enqueue, the job never exists and nothing records that. Both are silent, both are common, and the outbox makes both impossible — the job row commits with the data or not at all.

What is missing is the consumer.

## Writing the consumer

A polling loop, and it is less code than configuring most queue libraries:

```ts
export async function drainOutbox(driver: Driver, handle: (job: Job) => Promise<void>): Promise<number> {
  const rows = await driver.execute({
    text: `SELECT id, topic, payload, attempts FROM "zmdb_outbox"
             WHERE "status" = 'pending'
             ORDER BY "created_at"
             LIMIT 20
             FOR UPDATE SKIP LOCKED`,
    parameters: [],
  });

  for (const row of rows) {
    const job = assert<Job>(row);
    try {
      await handle(job);
      await driver.execute({
        text: `UPDATE "zmdb_outbox" SET "status" = 'delivered', "delivered_at" = now() WHERE "id" = $1`,
        parameters: [job.id],
      });
    } catch (error) {
      await driver.execute({
        text: `UPDATE "zmdb_outbox"
                 SET "attempts" = $2, "last_error" = $3, "status" = $4
               WHERE "id" = $1`,
        parameters: [job.id, job.attempts + 1, String(error).slice(0, 500), job.attempts + 1 >= 5 ? 'dead' : 'pending'],
      });
    }
  }
  return rows.length;
}
```

`FOR UPDATE SKIP LOCKED` is what makes this safe with several workers: each transaction takes rows nobody else holds, so two workers never claim the same job and neither blocks. Without `SKIP LOCKED` the workers serialise; without `FOR UPDATE` they duplicate.

It is also the part to reconsider before you run this at scale, and the [outbox](./transactional-outbox.html) page's dispatcher does. `SKIP LOCKED` holds a row lock for the length of the handler, so a slow handler holds locks on twenty rows and a crashed worker holds them until its connection is reaped — and it is Postgres and MySQL 8 only. A short **lease** column claims the batch in one `UPDATE` and then releases the lock, which is both cheaper and portable to SQLite.

This is raw SQL because [`UpdateBuilder.set()` cannot reference the current column value](./guide-increment-decrement.html) — `attempts = attempts + 1` is not expressible — and because `FOR UPDATE SKIP LOCKED` is not in the compiler. Note the workaround: the `SELECT` returns `attempts`, so the worker writes `job.attempts + 1` as a plain bound value. Use `driver.execute` directly with parameters, never string interpolation.

`status = 'dead'` is the retry limit and the dead-letter queue in one: a dead row stops matching the candidate query and stays in the table for inspection. That is better than a `WHERE attempts < 5` predicate, which leaves the poison rows in the working set to be re-read and re-skipped on every poll. Query the dead ones, because a silently-growing dead-letter set is how a broken integration hides for a month.

## Running it

**As a separate process** — the arrangement to prefer. A worker crash does not take your API down, and the two scale independently:

```ts
// worker.ts
const compiled = compileModule(AppModule);
const driver = compiled.container.resolve(DRIVER);

let running = true;
process.on('SIGTERM', () => {
  running = false;
});

while (running) {
  const count = await drainOutbox(driver, dispatch);
  if (count === 0) await new Promise(r => setTimeout(r, 1_000));
}
```

Sleep only when the queue was empty, so a backlog drains at full speed instead of one batch per second. The `SIGTERM` flag lets the current batch finish rather than dying mid-job — see [Standalone Applications](./web-standalone.html).

**In the API process**, for low volume, using the interval-with-lock pattern from [Task Scheduling](./web-task-scheduling.html). Acceptable when jobs are light; a slow job now competes with requests for the event loop.

**Triggered by cron**, which is the simplest of all: a `POST /jobs/drain` route that calls `drainOutbox` once, hit every minute. No long-running process, no lock — and it works on serverless.

## Making the handler safe

`Job` is the subset of the row the loop selected — declare it yourself, since `assert<T>` needs a type to generate against:

```ts
interface Job {
  readonly id: string;
  readonly topic: string;
  readonly payload: string;
  readonly attempts: number;
}

async function dispatch(job: Job): Promise<void> {
  switch (job.topic) {
    case 'post.created':
      return notifyFollowers(assert<{ id: number }>(JSON.parse(job.payload)));
    case 'user.registered':
      return sendWelcome(assert<{ id: number }>(JSON.parse(job.payload)));
    default:
      throw new Error(`unknown job topic ${job.topic}`);
  }
}
```

`payload` is a `text` column holding JSON rather than a `json` column, so the parse is yours — which is the point: the stored string is the message, byte for byte, rather than whatever the driver's JSON handling round-tripped it to.

Two things worth being deliberate about:

- **Validate the payload.** It was written by an older version of your code and has been sitting in a table; treat it as untrusted input. A field that used to exist may not.
- **Assume it runs twice.** Delivery is at-least-once — a crash between `handle` and the `UPDATE` replays the job. Make handlers idempotent: check before sending, or record a unique key.

Never put a secret in a payload. Job rows persist, get backed up and get read in support queries; store an id and look the credential up.

## When to use a real queue

Redis-backed queues (BullMQ), SQS or a broker earn their keep when you need scheduled or delayed jobs, priorities, fan-out to many consumers, or throughput past a few hundred jobs a second — a polling table will not match that. Nothing prevents using one; write to it from the outbox consumer rather than from a request handler, so you keep the atomic enqueue.

## What it would take

A `@Processor`/`@Process` pair, a worker runtime with concurrency and graceful drain, and a decision on the backend. Directive 7's zero-dependency rule means the built-in backend would be the outbox table, with Redis or SQS as adapters you supply.

The valuable piece to ship first is not the decorators — it is `drainOutbox` as a supported, tested function with backoff and dead-lettering, because that is what every application rewrites.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Task Scheduling](./web-task-scheduling.html) · [Events](./web-events.html)
