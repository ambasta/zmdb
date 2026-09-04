There is no watch mode in the framework and none is needed — Node's built-in watcher restarts the process, and a zmdb application starts in milliseconds because there is no reflection pass, no metadata scan and no dynamic module resolution at boot.

## Node's watcher

```json
{
  "scripts": {
    "dev": "node --watch --experimental-strip-types src/main.ts"
  }
}
```

Node 26 runs TypeScript directly by stripping types, and `--watch` restarts on change. No build step, no nodemon, no ts-node.

> [!WARNING]
> Type stripping does **not** run the zmdb AOT transformer, and the validators have
> no implicit fallback: the full and shallow `is`/`assert`/`validate` families all throw
> `runtime type witness required in test/fallback mode` when the transformer has not
> supplied a runtime witness. Validation does not silently weaken in development — it
> stops working, which is the direction you want, but it does mean any code path that
> validates is unrunnable under `--watch`.

Add the canary test so this cannot go unnoticed:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Run it in CI, where the build does run the transformer. Under type stripping the same test fails by throwing rather than by returning `true`, which is still the signal you want. If you rely on validation in development, use the `tsup` watcher below instead.

## Watching a real build

The arrangement that keeps the transformer in play:

```json
{
  "scripts": {
    "dev": "tsup --watch --onSuccess \"node dist/main.js\""
  }
}
```

`tsup` rebuilds on change and restarts the process. Slower per iteration than type stripping — a rebuild rather than a restart — and it exercises the same pipeline as production, including AOT validation.

This is the recommendation for a project that validates request bodies, which is most of them.

## Restarting cleanly

A restart that leaves a listening socket or an open pool produces `EADDRINUSE` on the next start, or a slow leak of database connections across dozens of reloads until the server refuses new ones.

```ts
const app = createApp(AppModule);
await app.init();
const server = createServer(async (req, res) => {
  const out = await app.handle(await webRequest(req));
  res.writeHead(out.status, { ...out.headers }).end(await bodyText(out));
});
server.listen(3000);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2'] as const) {
  process.once(signal, () => {
    server.close();
    void pool.end();
    void app[Symbol.asyncDispose]();
  });
}
```

`webRequest(req)` is the small Node-to-`WebRequest` conversion written out in
[Request Lifecycle](./web-request-lifecycle.html). This compact adapter buffers
streamed responses; use an explicitly registered `Router` with `toNodeHandler`
when streaming and disconnect cancellation matter.

`SIGUSR2` is what some watchers send. `process.once`, not `on` — a second signal during shutdown should terminate immediately rather than re-enter the handler.

`App` is `AsyncDisposable`, so `await using` handles this in a script:

```ts
await using app = createApp(AppModule);
await app.init();
```

## What "hot reload" would mean here, and why it does not exist

True hot module replacement — swapping a controller's implementation in a running process while keeping state — is not possible with this design, and would not be desirable:

- Controllers are constructed once per app — eagerly at compile or on a declared
  lazy module's first load. Replacing a class still means rebuilding the
  container and router, which is a restart in all but name.
- Decorator metadata is read at registration. New metadata needs a new registration.
- Any state on a provider survives or does not, unpredictably. That is how HMR produces bugs that do not exist after a restart, and debugging those costs more than the restart saved.

A cold start here is fast enough that the trade is not worth making. Measure yours: `console.log(performance.now())` at the top of `main.ts` and after `listen`.

## Keeping the loop tight

**Do not connect to the database at import time.** A module-level `await pool.connect()` makes every restart wait on the network. Use a factory provider so the connection happens lazily:

```ts
providers: [{ token: DRIVER, useFactory: () => makeDriver(env.DATABASE_URL) }];
```

**Do not run migrations on boot** in development either — a restart on every keystroke should not touch the schema. Run them explicitly.

**Test without a server.** `createTestApp` gives you the whole application in-process, so most iteration does not need a restart at all:

```ts
const app = createTestApp(AppModule, { overrides: [{ token: DRIVER, useValue: fakeDriver }] });
const out = await app.request({ method: 'GET', path: '/posts', headers: {} });
```

`vitest --watch` over that loop is faster than any server reload, and it is the loop to reach for first. See [Testing Applications](./web-testing.html).

---

See also: [Testing Applications](./web-testing.html) · [JIT vs AOT](./jit-vs-aot.html) · [Standalone Applications](./web-standalone.html)
