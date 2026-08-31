> **ToDo / feature gap.** There is no outbox helper, no relay worker and no
> event-publishing hook. The pattern below is entirely assembled from existing
> pieces — which works, but you write and operate all of it.

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
export const outbox = defineSchema('outbox', {
  id: serial().primaryKey(),
  topic: text().notNull(),
  payload: json<Record<string, unknown>>().notNull(),
  createdAt: timestamp().notNull().defaultTo('now()'),
  publishedAt: timestamp().nullable(),
  attempts: integer().notNull().defaultTo(0),
});

createIndexDdl(
  { name: 'outbox_unpublished', table: 'outbox', columns: ['created_at'], where: 'published_at IS NULL' },
  'postgres',
);
```

The partial index matters: the relay scans only unpublished rows, and that set stays small even when the table does not. Partial indexes are supported — `IndexDef` has a `where` field.

## The write

One transaction, two rows, no broker:

```ts
await db.transaction(async () => {
  const order = await orderRepo.create(dto);
  await outboxRepo.create({ topic: 'order.created', payload: { id: order.id, total: order.total } });
});
```

## The relay

A separate loop. `FOR UPDATE SKIP LOCKED` is what lets you run more than one copy without two of them claiming the same row:

```ts
async function relayOnce(driver: Driver) {
  const claimed = await driver.execute({
    text: `SELECT id, topic, payload FROM "outbox"
           WHERE "published_at" IS NULL
           ORDER BY "created_at"
           LIMIT 100
           FOR UPDATE SKIP LOCKED`,
    parameters: [],
  });

  for (const row of claimed) {
    const msg = assert<{ id: number; topic: string; payload: unknown }>(row);
    await broker.publish(msg.topic, msg.payload);
    await driver.execute({
      text: `UPDATE "outbox" SET "published_at" = now() WHERE "id" = $1`,
      parameters: [msg.id],
    });
  }
  return claimed.length;
}
```

The whole thing has to run inside one transaction for `SKIP LOCKED` to hold the claim, so wrap `relayOnce` in `db.transaction`. `SKIP LOCKED` is Postgres and MySQL 8; SQLite has no equivalent, so on SQLite run exactly one relay.

> [!NOTE]
> This is at-least-once delivery. The publish can succeed and the `UPDATE` can
> fail, and the message goes out twice. Consumers must be idempotent — that is a
> property of the pattern, not a limitation of this implementation. Carry a
> deduplication key in the payload.

## Operating it

Three things need to exist before this is production-ready, and none of them are in zmdb:

- **A scheduler.** No `@Cron`; run the relay as its own process or a `setInterval` in a worker. See [Task Scheduling](./web-task-scheduling.html).
- **Backoff and a dead-letter path.** Increment `attempts`, and stop retrying past a threshold — otherwise one poisoned message blocks the queue behind it.
- **A lag metric.** `MAX(now() - created_at) WHERE published_at IS NULL`, alerted on. An outbox that has stopped draining looks exactly like an outbox with nothing to do.

## Listening instead of polling

On Postgres, `NOTIFY` in a trigger wakes the relay immediately and keeps the poll as a floor:

```sql
CREATE TRIGGER outbox_notify AFTER INSERT ON outbox
  FOR EACH ROW EXECUTE FUNCTION pg_notify('outbox', '');
```

Keep the periodic poll. A missed notification — a reconnect, a restart — must not mean a message never leaves.

## What it would take

An `outbox` schema and repository in `@zmdb/repository`, a `relay(driver, publish, opts)` function with backoff built in, and something to run it on a timer. The last one is the blocker: without a scheduler in `@zmdb/web`, a shipped outbox would still leave the operationally hard half to the user, so this sits behind [task scheduling](./web-task-scheduling.html).

---

See also: [Transactions](./transactions.html) · [Batch API](./batch.html) · [Task Scheduling](./web-task-scheduling.html)
