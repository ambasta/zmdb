> **ToDo / feature gap.** There is no outbox helper, no dispatcher loop and no
> event-publishing hook. The pattern below is entirely assembled from existing
> pieces — which works, but you write and operate all of it.
>
> The shape it will ship as is frozen in
> `packages/query-compiler/src/outbox/SPEC.md`, and everything on this page has
> been aligned to it, so a table you create today will not need migrating.

## The problem it solves

You want to write a row and publish a message, and you want either both or neither. You cannot get that with a database transaction plus a broker call, because the broker is not in the transaction:

```ts
await db.transaction(async () => {
  await orderRepo.create(dto);
  await broker.publish('order.created', dto); // succeeds, then the tx rolls back
});
```

The outbox fixes it by making the publish a _database write_, and moving the actual send to a separate process that reads committed rows.

## The table

```ts
import type { HasDefault, PrimaryKey, Sql, Table } from 'zmdb/tags';

type OutboxStatus = 'pending' | 'delivered' | 'dead';

export interface Outbox extends Table<'zmdb_outbox'> {
  id: string & Sql<'text'> & PrimaryKey;
  topic: string & Sql<'text'>;
  payload: string & Sql<'text'>;
  status: OutboxStatus & Sql<'jsonEnum'>;
  attempts: number & Sql<'integer'> & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  leaseOwner: string & Sql<'text'> & HasDefault;
  leaseUntil: Date & Sql<'timestamp'> & HasDefault;
  deliveredAt: (Date & Sql<'timestamp'>) | null;
  lastError: (string & Sql<'text'>) | null;
}

createIndexDdl(
  {
    name: 'zmdb_outbox_pending',
    table: 'zmdb_outbox',
    columns: ['status', 'lease_until', 'created_at'],
    where: "status = 'pending'",
  },
  'postgres',
);
```

Four things in that declaration are not the obvious choice, and each one is forced by what the query builder can actually emit — the reasoning is in `packages/query-compiler/src/outbox/SPEC.md`, and the short version is:

- **`status`, not `publishedAt IS NULL`.** `Operator` has no `is`, and an unrecognised operator is passed through into the SQL verbatim, so `where('publishedAt', 'is', null)` compiles to `"published_at" is $1` — a syntax error on Postgres. **No nullable column can be a predicate here.** `deliveredAt` and `lastError` stay nullable only because they are read and never filtered on.
- **A third state.** `'dead'` is what stops one poisoned message from being retried forever; a two-state column cannot express it, and a threshold on `attempts` leaves the poison row in the working set on every poll.
- **`payload` is `text`, not `json`.** A `json` column round-trips through the driver's own JSON handling, so key order and number formatting become the driver's choice and a payload cannot be signed, hashed for deduplication, or compared to a replay. Serialise once at the write and the stored string is the message.
- **`id` is `text` and generated in the application** with `globalThis.crypto.randomUUID()`. `SqlType` has no `uuid`, and a `Serial` id would not be known until after the insert — which matters when the write is inside someone else's transaction.

`createdAt`, `attempts`, `leaseOwner` and `leaseUntil` say `HasDefault`, so the migration carries `DEFAULT now()`, `DEFAULT 0`, `DEFAULT ''` and an epoch default — the values live in the DDL, not the declaration. `leaseUntil` defaulting to a past instant rather than being nullable is what makes "unclaimed" a comparison (`lease_until < now`) instead of an `IS NULL`.

The partial index matters: the dispatcher scans only pending rows, and that set stays small even when the table does not. Partial indexes are Postgres and SQLite; **MySQL has none**, which is why `status` is the leading column — the full composite index still seeks straight to the pending rows, so the plan degrades to an index prefix over a small set rather than to a table scan.

The dialect argument above is `'postgres'` on purpose. `createIndexDdl` emits ` WHERE ${def.where}` with **no dialect guard**, so passing `'mysql'` produces `CREATE INDEX … (…) WHERE status = 'pending'` — a syntax error rather than a silently-widened index. Drop the `where` yourself when the target is MySQL; the column order is what makes that acceptable.

## The write

One transaction, two rows, no broker:

```ts
await db.transaction(async tx => {
  const order = await orderRepo.withTransaction(tx).create(dto);
  await outboxRepo.withTransaction(tx).create({
    id: globalThis.crypto.randomUUID(),
    topic: 'order.created',
    payload: JSON.stringify({ id: order.id, total: order.total }),
    status: 'pending',
  });
});
```

`repo.withTransaction(tx)` returns a **new repository bound to the transaction's connection**, and every repository taking part has to be rebound. An `outboxRepo.create(…)` that skips it commits on its own pooled connection, and the atomicity is a fiction that reads exactly like the correct code.

## The dispatcher

A separate loop, and the interesting part is how it claims a batch without two copies taking the same row.

The obvious answer is `FOR UPDATE SKIP LOCKED`, and it is the wrong one here for two reasons. It is not expressible through the query builder at all — there is no lock clause on `SelectBuilder`, so it has to be hand-written SQL. And holding a row lock while calling a broker means the claim's lifetime is a network round trip per message, so a slow broker holds locks on a hundred rows and a crashed dispatcher holds them until its connection is reaped. `SKIP LOCKED` is also Postgres and MySQL 8 only.

A **lease** does the same job with three ordinary statements and works on SQLite:

```ts
async function dispatchOnce(tx: TransactionContext, batch = 100, leaseMs = 30_000) {
  const token = globalThis.crypto.randomUUID();
  const now = new Date();
  const until = new Date(now.getTime() + leaseMs);

  // 1. candidates
  const ids = await tx.execute({
    text: `SELECT "id" FROM "zmdb_outbox"
           WHERE "status" = 'pending' AND "lease_until" < $1
           ORDER BY "created_at" ASC LIMIT $2`,
    parameters: [now, batch],
  });

  // 2. claim — the UPDATE's own row locks are the mutual exclusion
  await tx.execute({
    text: `UPDATE "zmdb_outbox" SET "lease_owner" = $1, "lease_until" = $2
           WHERE "status" = 'pending' AND "lease_until" < $3 AND "id" = ANY($4)`,
    parameters: [token, until, now, ids.map(r => r.id)],
  });

  // 3. read back what we actually won
  return tx.execute({
    text: `SELECT "id", "topic", "payload", "attempts" FROM "zmdb_outbox" WHERE "lease_owner" = $1`,
    parameters: [token],
  });
}
```

Step 2 is the whole trick. The predicate is re-tested inside the `UPDATE`, so if another dispatcher claimed a candidate between steps 1 and 2, our `UPDATE` matches nothing for that row — the database's per-row write lock does the arbitration, and it is held for the length of one `UPDATE` rather than for the length of the publish.

Step 3 exists because there is no way to ask how many rows an `UPDATE` changed: `Driver.execute` resolves to rows, and `RETURNING` is emitted without a dialect guard, so it is a syntax error on MySQL. Reading back by the lease token is how the dispatcher learns what it won.

Publish outside the transaction, then mark each row:

| Outcome                      | Mark                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| published                    | `status = 'delivered'`, `deliveredAt = now`                     |
| failed, attempts left        | `status = 'pending'`, `leaseUntil = now + backoff`, `lastError` |
| failed, `attempts` exhausted | `status = 'dead'`, `lastError`                                  |

A dispatcher that dies mid-batch needs no cleanup: its lease expires and the rows become candidates again.

> [!NOTE]
> `attempts = attempts + 1` is not expressible — `UpdateBuilder.set()` binds every
> value as a parameter, so a column cannot reference itself (see
> [increment/decrement](./guide-increment-decrement.html)). It costs nothing here:
> step 3 already returned the authoritative `attempts` under a lease nobody else
> can take, so the dispatcher writes `attempts + 1` as a literal value.

> [!NOTE]
> This is at-least-once delivery. The publish can succeed and the `UPDATE` can
> fail, and the message goes out twice. Consumers must be idempotent — that is a
> property of the pattern, not a limitation of this implementation. Carry a
> deduplication key in the payload.

## Operating it

Two things you still write yourself, and one you always write:

- **Something to run the loop.** There is no `@Cron`, so run the dispatcher as its own process or a `setInterval` in a worker. See [Task Scheduling](./web-task-scheduling.html). Poll with a backoff — idle at 1s doubling to 30s — so an empty outbox is not a query per second forever.
- **Stopping it.** The loop has to finish its in-flight batch before the process exits, or those rows wait out their lease before anyone retries them. Note that lifecycle hooks are detected on [controllers only](./web-standalone.html), so a dispatcher registered as a plain provider is never told to stop.
- **A lag metric.** `MAX(now() - created_at) WHERE status = 'pending'`, alerted on. An outbox that has stopped draining looks exactly like an outbox with nothing to do, and this is the only signal that distinguishes them.

Backoff and the dead-letter path are not on that list any more: they are `status = 'dead'` plus a `leaseUntil` in the future, both of which the table above can express.

## Listening instead of polling

On Postgres, `NOTIFY` in a trigger wakes the dispatcher immediately and keeps the poll as a floor:

```sql
CREATE TRIGGER outbox_notify AFTER INSERT ON zmdb_outbox
  FOR EACH ROW EXECUTE FUNCTION pg_notify('outbox', '');
```

Keep the periodic poll. A missed notification — a reconnect, a restart — must not mean a message never leaves.

## What it would take

Less than this page used to claim. The declaration, the claim protocol and the dispatcher are frozen in `packages/query-compiler/src/outbox/SPEC.md` as `outboxWriter(tx)` and `createOutboxDispatcher(opts)`, with `runOnce()` for tests and `start()`/`onShutdown()` for a process.

Two corrections to what was here before. The split runs through the middle of the pattern rather than landing in one package: the table DDL, the partial index and the three claim statements are `@zmdb/query-compiler`, because they are dialect-aware SQL and nothing else, while the `OutboxRow` declaration and `createOutboxDispatcher` are `@zmdb/repository`. The forcing constraint is that `packages/query-compiler/package.json` has **zero** dependencies — not even `@zmdb/schema-core` — so `OutboxRow extends Table<'zmdb_outbox'>` cannot be declared there without giving that package its first dependency, and `Driver` is one package further out again. An earlier version of this page said "An `Outbox` declaration and repository in `@zmdb/repository`", and that was right. And this no longer sits behind [task scheduling](./web-task-scheduling.html): the dispatcher owns its own timer and its own `onShutdown`, so a scheduler would only replace a `setInterval` it already has. What scheduling adds is coordination between replicas, and the lease means the dispatcher does not need any. The scheduler frozen in #586 reaches the same conclusion from the other side: its own recommendation for durable work is that a task should enqueue rather than do the work in its body, so a dispatcher owning its loop is the pattern rather than the exception.

---

See also: [Transactions](./transactions.html) · [Batch API](./batch.html) · [Task Scheduling](./web-task-scheduling.html)
