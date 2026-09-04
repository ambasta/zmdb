> **Supported.** `@zmdb/repository/outbox` exports the declared table, the
> transaction-only writer and the dispatcher. `@zmdb/query-compiler/outbox`
> exports the migration and the dialect-aware claim statements.

## The problem it solves

You want to write a row and publish a message, and you want either both or neither. A database transaction
cannot include a broker call:

```ts
await db.transaction(async () => {
  await orderRepo.create(dto);
  await broker.publish('order.created', dto); // succeeds, then the tx rolls back
});
```

The outbox makes the publish a database write. A separate dispatcher reads only committed rows and sends them
to the broker.

## Declare and migrate the table

`OutboxSchema` is an ordinary schema value, so it participates in the committed
post-migration snapshot. Create the table with the dedicated migration: a generic
snapshot diff cannot carry its defaults, partial index or MySQL's bounded key
columns.

```ts
import { snapshot, up } from '@zmdb/query-compiler/migrations';
import { outboxMigration } from '@zmdb/query-compiler/outbox';
import { OutboxSchema } from '@zmdb/repository/outbox';

const migration = outboxMigration(17, 'postgres');
await up(connection, [migration]);

const current = snapshot([UserSchema, OrderSchema, OutboxSchema]);
// Persist `current` as the schema state after migration 17.
```

Do not also emit a generic create-table diff for `OutboxSchema`; that would try
to create the same table twice and would omit the outbox-specific physical
details. The snapshot declaration records the snake_case column names used by
the migration and dispatcher. `OutboxRow` presents timestamp and lease fields
in app-style camelCase.

The row has this public shape:

```ts
interface OutboxRow extends Table<'zmdb_outbox'> {
  id: string & Sql<'text'> & PrimaryKey;
  topic: string & Sql<'text'>;
  payload: string & Sql<'text'>;
  status: ('pending' | 'delivered' | 'dead') & Sql<'jsonEnum'> & HasDefault;
  attempts: number & Sql<'integer'> & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  leaseOwner: string & Sql<'text'> & HasDefault;
  leaseUntil: Date & Sql<'timestamp'> & HasDefault;
  deliveredAt: (Date & Sql<'timestamp'>) | null;
  lastError: (string & Sql<'text'>) | null;
}
```

Four choices are load-bearing:

- `status`, not `deliveredAt IS NULL`: the query builder has no valid `IS NULL` operator.
- `dead` is a terminal state, so a poison message leaves the pending working set.
- `payload` is text, preserving the exact bytes the caller supplied.
- `id` is application-generated text, so the writer needs no dialect-dependent `RETURNING`.

Postgres uses `TIMESTAMPTZ`, MySQL uses `DATETIME(3)`, and SQLite stores fixed-width ISO timestamps as `TEXT`; the SQLite database-clock default uses `strftime` to keep the same sortable UTC representation as driver-bound `Date` values. The Postgres and SQLite pending indexes are partial.

MySQL has no partial indexes, so its full index starts with `status` and can still seek to pending rows. `outboxMigration` handles that difference; the lower-level `createIndexDdl` remains literal and does not silently discard predicates.

The MySQL migration uses bounded `VARCHAR` storage for the UUID, lease token and status because MySQL cannot key an unrestricted `TEXT` column; the application types remain strings.

## Write inside the caller's transaction

```ts
import { outboxWriter } from '@zmdb/repository/outbox';

await db.transaction(async tx => {
  const order = await orderRepo.withTransaction(tx).create(dto);
  await outboxWriter(tx).write('order.created', JSON.stringify({ id: order.id, total: order.total }));
});
```

There is no outbox writer that accepts a bare driver. Both rows use the caller's `TransactionContext`, so a
rollback removes both. A custom `TxConnection` should expose the dialect of the driver it wraps.

## Dispatch

```ts
import { createOutboxDispatcher } from '@zmdb/repository/outbox';

const dispatcher = createOutboxDispatcher({
  driver,
  publish: (topic, payload) => broker.publish(topic, payload),
  onDead: row => alertOps(row),
});

await dispatcher.runOnce(); // one externally scheduled pass
dispatcher.start(); // or let it own the bounded polling loop
```

The bounded defaults are part of the operating contract:

| Option        | Default                               | Effect                                           |
| ------------- | ------------------------------------- | ------------------------------------------------ |
| `batch`       | `100`                                 | maximum rows claimed in one pass                 |
| `leaseMs`     | `30_000`                              | time before another dispatcher may reclaim a row |
| `maxAttempts` | `10`                                  | failed publish count that moves a row to `dead`  |
| `backoffMs`   | `min(2 ** attempts * 1_000, 300_000)` | retry delay stored in `leaseUntil`               |
| `idleMs`      | `1_000`                               | first delay after an empty pass                  |
| `maxIdleMs`   | `30_000`                              | cap for the doubling idle delay                  |

`createOutboxDispatcher` also implements the app lifecycle structurally:
`onModuleInit()` is the idempotent alias for `start()`, and `onShutdown()` is
awaitable. Register the instance as a value provider, or resolve its factory
before `app.init()`, to have init start it and app disposal drain it.

Each pass uses three ordinary statements:

1. Read pending candidates whose lease has lapsed, oldest first.
2. Conditionally update those rows with a per-batch lease token.
3. Read back by that token to learn which rows this dispatcher actually won.

The conditional `UPDATE` is the concurrency control. Two dispatchers may see the same candidate, but only the
first can move its lease into the future; the second read-back gets no row. No database transaction or row lock
is held while the broker runs. The compiler emits the same protocol for SQLite, MySQL and Postgres; the
contention semantics and index plan are exercised against a real SQLite database.

Rows are published sequentially within a claimed batch and marked independently:

| Outcome                    | Mark                                               |
| -------------------------- | -------------------------------------------------- |
| published                  | `status = 'delivered'`, `deliveredAt = now`        |
| failed, attempts left      | pending, `leaseUntil = now + backoff`, `lastError` |
| failed, attempts exhausted | `status = 'dead'`, `lastError`, then `onDead`      |

Before `publish` runs, the dispatcher validates that the database row has string `id`, `topic` and `payload`
fields and a non-negative integer `attempts`. A malformed payload is marked dead instead of becoming a poison
retry. Parsing and validating the topic-specific contents remains the consumer's responsibility.

The default retry delay is capped exponential backoff. Idle polling doubles from 1s to 30s and resets after
work; a full batch polls again immediately.

## Guarantees

Delivery is **at least once**. If publish succeeds and the process dies before the delivered mark, the lease
expires and another dispatcher publishes the row again. Consumers must be idempotent and should carry a
deduplication key in the payload; the [queue worker's idempotency guidance](./web-queues.html) shows the same
handler-owned completion-marker rule.

Ordering is deliberately weak:

| Configuration               | Ordering                                            |
| --------------------------- | --------------------------------------------------- |
| one dispatcher, `batch: 1`  | global and per-topic by `createdAt`                 |
| one dispatcher, `batch > 1` | claimed by `createdAt`, then published sequentially |
| multiple dispatchers        | none                                                |

Those are clean-pass sequencing properties, not a durable ordering contract. A
failed older row backs off while a newer row can publish, so code that requires
per-topic order needs an application-owned per-topic sequencing rule.

## Operating it

- Use `runOnce()` for cron/serverless operation, or `start()` for the owned polling loop.
- When the dispatcher is a constructed app provider, `app.init()` starts it and
  disposal stops claiming and finishes the in-flight batch. A lazy factory first
  resolved after init is still drained, but is not retroactively started; an
  unresolved factory is never built for shutdown.
- Outside an app, call `onShutdown()` explicitly to drain the owned loop.
- Alert on pending-row lag, not only process health:
  `MAX(now() - created_at) WHERE status = 'pending'`.
- Query `status = 'dead'` for terminal rows and inspect `last_error`, `attempts`,
  `topic`, and `payload` before replaying.

There is deliberately no automatic replay helper: retrying a poison message
before fixing its cause only makes it poison again. After fixing the cause,
reset the chosen row explicitly so the normal claim path can see it:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const replay = createQueryCompiler(driver.dialect ?? 'postgres')
  .updateTable('zmdb_outbox')
  .set({
    status: 'pending',
    attempts: 0,
    lease_owner: '',
    lease_until: new Date(0),
    delivered_at: null,
    last_error: null,
  })
  .where('id', '=', deadRowId)
  .where('status', '=', 'dead')
  .compile();

await driver.execute(replay);
```

On Postgres, `LISTEN/NOTIFY` can reduce latency, but keep the periodic poll as a floor: notifications can be
missed during reconnects.

The broker adapter remains application-supplied through `publish`, and payload-specific validation remains a
consumer concern because the outbox deliberately accepts any byte-stable string, including non-JSON formats.

---

See also: [Transactions](./transactions.html) · [Batch API](./batch.html) · [Queues](./web-queues.html) · [Task Scheduling](./web-task-scheduling.html)
