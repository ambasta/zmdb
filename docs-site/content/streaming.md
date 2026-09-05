> **ToDo / adapter gap.** `Driver.stream?` and `repo.stream()` now provide the
> async-iterable boundary. A custom driver can supply a real cursor. The bundled
> Postgres, SQLite and SQL Server drivers do not yet implement it, so they use
> the documented buffered fallback.

The HTTP half is no longer a blocker:
[`WebResponse.body` supports streams](./web-streaming-files.html). What remains
is cursor support in the bundled database adapters.

## The repository surface

```ts
await using rows = repo.stream(
  { active: true },
  {
    batchSize: 500,
    signal: request.signal,
  },
);

for await (const row of rows) {
  await exportRow(row);
}
```

The stream is single-shot. `for await` closes it on `break` or a thrown error,
and `await using` also covers a stream that was opened and then abandoned. Rows
cross the same database-value decoder as `find`; the decoder is resolved once
before iteration.

If the driver has no `stream` method, the repository calls `execute` once and
yields the buffered rows. The first fallback per driver is reported through
`onQuery(query, { filters: [], buffered: true })`. Pass
`requireCursor: true` to refuse that fallback.

## What breaks without a cursor

Reading a million rows means a million rows in memory:

```ts
const all = await repo.findAll(); // the whole table, resident
```

Node's default heap will end the process somewhere in the low millions of rows, which is exactly when you wanted a stream.

## Paginate instead

Keyset pagination is the correct workaround, and for a batch job it is barely worse than a cursor — bounded memory, and it survives a restart because the cursor is a value you can persist:

```ts
async function* allUsers(repo: UserRepository, batch = 1_000) {
  let after = 0;
  for (;;) {
    const page = await repo.list({
      where: { id: { gt: after } },
      orderBy: [{ column: 'id', dir: 'asc' }],
      page: { limit: batch },
    });
    const last = page.items.at(-1);
    if (last === undefined) return;
    yield* page.items;
    after = last.id;
  }
}

for await (const user of allUsers(repo)) {
  /* ... */
}
```

That gives the _consumer_ an `AsyncIterable`, which is usually what the calling code wanted. It costs one round trip per batch and it holds a batch in memory, not a table.

> [!NOTE]
> Order by a unique column. Ordering by `createdAt` with ties can skip or repeat
> rows across page boundaries. Add the primary key as a tie-break — see
> [Cursor-based pagination](./guide-cursor-pagination.html).

## Until the bundled cursors land

If you need a genuine server-side cursor today, implement the optional driver
method or use your client directly for that one query:

```ts
import { Client } from 'pg';
import Cursor from 'pg-cursor';

const cursor = client.query(new Cursor('SELECT * FROM users'));
for (;;) {
  const rows = await cursor.read(1_000);
  if (rows.length === 0) break;
  for (const row of rows) handle(assert<Entity<User>>(row));
}
```

The direct-client form loses the repository decoder for that query. Compile the
SQL with the builder and hand `q.text` / `q.parameters` to the cursor if you
want the query itself to stay derived.

## What remains

The interface and repository wrapper are in place. The remaining work is
driver-specific: step SQLite statements with `iterate()`, and hold a Postgres
connection and cursor for the iterable's lifetime. Until then, the bundled
drivers deliberately advertise no cursor capability.

---

See also: [Cursor-based pagination](./guide-cursor-pagination.html) · [Writing a Driver](./custom-driver.html) · [Streaming Files](./web-streaming-files.html)
