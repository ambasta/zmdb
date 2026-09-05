`repo.stream()` returns a single-shot `AsyncIterable` and `AsyncDisposable`. Prefer `await using`: a started database cursor owns its connection until the iterator closes, and disposal covers paths
that never reach another `iterator.next()`.

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

`for await` closes the iterator on `break` or a thrown error. `await using` additionally closes a stream whose iterator was started and then handed to code that returns without finishing it. A stream
that was never started acquires no connection. Manual iteration carries the corresponding manual responsibility: call `iterator.return()` when stopping early.

Rows cross the same database-value decoder as `find`; the decoder is resolved once before iteration. Reads are not schema-validated on either path.

The HTTP response layer also supports streams through [`WebResponse.body`](./web-streaming-files.html).

## Driver capability and fallback

If the driver has no `stream` method, the repository calls `execute` once and yields the buffered rows. The first fallback per driver is reported through
`onQuery(query, { filters: [], buffered: true })`. Pass `requireCursor: true` to refuse that fallback.

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

> [!NOTE] Order by a unique column. Ordering by `createdAt` with ties can skip or repeat rows across page boundaries. Add the primary key as a tie-break — see
> [Cursor-based pagination](./guide-cursor-pagination.html).

## Bundled driver behaviour

`sqliteDriver` calls `StatementSync.iterate()` and decodes one stepped row at a time. `batchSize` has no effect because there is no client/server round trip to batch. An abort is observed between
native steps; `node:sqlite` exposes no `sqlite3_interrupt`, so JavaScript cannot interrupt one slow step already running inside SQLite.

`pgDriver(pool)` checks out one connection for the iterable, opens an explicit transaction, declares a parameterised cursor, fetches `batchSize` rows per round trip, and closes the cursor and releases
the connection in `finally`. Breaking a `for await` loop therefore returns the connection to the pool. A consumer that manually calls `iterator.next()` still owns calling `iterator.return()` when it
stops early.

Other drivers can implement the same optional `Driver.stream` contract. When they do not, use `requireCursor: true` to refuse buffering or use keyset pagination as above.

## Fallback limits

The bundled SQL Server adapter and third-party drivers without `stream` still buffer. A bare Postgres `Client` also omits cursor streaming; pass a `Pool` so the adapter can own and release one
checked-out connection. Request abort wiring remains explicit at the application boundary.

---

See also: [Cursor-based pagination](./guide-cursor-pagination.html) · [Writing a Driver](./custom-driver.html) · [Streaming Files](./web-streaming-files.html)
