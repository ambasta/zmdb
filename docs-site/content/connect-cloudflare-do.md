Dialect: `'sqlite'`. A Durable Object with SQLite storage gives you a private, strongly-consistent SQLite database co-located with a single-threaded actor — which changes what you can rely on compared
to [D1](./connect-cloudflare-d1.html).

## Setup

The storage API is synchronous inside the object, so the driver is trivial:

```ts
import type { Driver } from '@zmdb/repository';

export function doDriver(sql: SqlStorage): Driver {
  return {
    async execute(query) {
      return [...sql.exec(query.text, ...query.parameters)] as Record<string, unknown>[];
    },
  };
}
```

```ts
export class Room extends DurableObject {
  private readonly repo;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const driver = doDriver(ctx.storage.sql);
    for (const op of diff({ tables: {} }, snapshot([messages]))) {
      ctx.storage.sql.exec(emitUp(op, 'sqlite'));
    }
    this.repo = defineRepository(messages, driver, { dialect: 'sqlite' });
  }

  async fetch(request: Request): Promise<Response> {
    const { items } = await this.repo.list({ page: { limit: 50 } });
    return Response.json(items);
  }
}
```

Creating the schema in the constructor works here and nowhere else: each Durable Object owns its own database, and `diff` from empty is idempotent enough if you use `CREATE TABLE IF NOT EXISTS` — see
the migrations note below.

## What single-threading buys you

A Durable Object processes one request at a time, and its storage is strongly consistent. So:

- **No write contention.** The SQLite single-writer limit is not a constraint, because there is only ever one writer.
- **Read-after-write is guaranteed.** Unlike [Turso replicas](./connect-turso.html) or D1, a read immediately after a write sees it.
- **Check-then-act is safe.** The read-then-write [upsert workaround](./upsert.html) is actually correct here, without a transaction, because nothing can interleave.

That last point is unusual and worth using. Most of the concurrency caveats elsewhere in these docs do not apply inside a Durable Object.

## Migrations

`ctx.storage.sql.exec` is synchronous, so a `MigrationConnection` over it is straightforward — but the runner is async and the constructor is not. Do migrations in `blockConcurrencyWhile`, which holds
requests until it finishes:

```ts
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.blockConcurrencyWhile(async () => {
    await runCli('up', doConn(ctx.storage.sql), migrations);
  });
}
```

Every object migrates itself on first wake after a deploy. That is the right model for per-object databases — there is no central place to run it from — but it means a migration must be fast, since it
delays the first request to that object.

## The architecture this enables

One database per entity: a room, a document, a game, a user's workspace. Each is small, consistent and isolated, and multi-tenancy is structural rather than a
[filter you must remember](./entity-filters.html).

What you give up is cross-object queries. There is no join between two Durable Objects, so "list all rooms with more than 10 messages" requires each object to report upward, or a separate
[D1](./connect-cloudflare-d1.html) index maintained alongside. Decide that shape before committing to the model, because retrofitting a global query is expensive.

## Type conversion

SQLite storage classes as usual — `boolean` as `0`/`1`, `timestamp` as text, `json` as text. See [Connect: SQLite](./connect-sqlite.html).

## Limits

Per-object storage is capped, and the object is single-threaded — so a slow query blocks every request to that object, not just the current one. Index accordingly, and keep the per-object dataset
small by design.

---

See also: [Cloudflare D1](./connect-cloudflare-d1.html) · [Dialect: SQLite](./dialect-sqlite.html) · [WebSockets](./web-ws-adapter.html)
