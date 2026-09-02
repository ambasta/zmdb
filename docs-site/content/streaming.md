> **ToDo / feature gap.** Nothing in zmdb streams. `Driver.execute` returns
> `Promise<readonly Record<string, unknown>[]>` — a fully materialised array —
> and every repository method resolves to an array or a single row. There is no
> `AsyncIterable` result and no cursor API.

This is one of two shared blockers in the project; the other is that [`WebResponse.body` is a `string`](./web-streaming-files.html), so even if a query streamed, the HTTP layer could not stream the response.

## What breaks without it

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

## Or stream in the driver, bypassing zmdb

If you need a genuine server-side cursor, use your client directly for that one query. The driver is yours, so this is a normal thing to do:

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

You lose the typed builder for that query and keep it everywhere else. Compile the SQL with the builder and hand `q.text` / `q.parameters` to the cursor if you want the query itself to stay derived.

## What it would take

The `Driver` interface has to grow a second, optional method — `stream?(query): AsyncIterable<Record<string, unknown>>` — because making `execute` return an iterable would break every existing driver and every test that does `rows.length`. Then repositories need streaming variants (`findAllStream`, `listStream`), and the HTTP layer needs `WebResponse.body` to accept an iterable. Three packages, one shared prerequisite. The `Driver` change is small and additive; the response-body change is the one that touches everything.

---

See also: [Cursor-based pagination](./guide-cursor-pagination.html) · [Writing a Driver](./custom-driver.html) · [Streaming Files](./web-streaming-files.html)
