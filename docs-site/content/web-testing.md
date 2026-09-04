`createTestApp` builds an app from a [module](./web-modules.html) with **DI
overrides** and drives routes **in-process** — no socket, no live server. It's
the `@nestjs/testing` analogue: swap a provider for a fake, then assert on the
response.

## In-process requests

```ts
import { bodyText, createTestApp } from '@zmdb/web';

const app = createTestApp(AppModule);
const res = await app.request({ method: 'GET', path: '/hello', headers: {} });
expect(JSON.parse(await bodyText(res))).toEqual({ message: 'hello' });
```

`request()` returns the production `WebResponse`. Use `bodyText()` to read text,
bytes or a stream uniformly; reading a stream consumes it.

## Overriding a provider

Replace any provider **before** controllers are built, so the controller under
test injects your stub:

```ts
const stub = { greet: () => 'stubbed' };

const app = createTestApp(AppModule, {
  overrides: [{ token: GreeterToken, useValue: stub }],
});

await app.request({ method: 'GET', path: '/hello', headers: {} });
// → { msg: 'stubbed' }

app.get(GreeterToken) === stub; // resolve any provider to assert on a spy
```

The same override applies inside a
[lazy module](./web-lazy-modules.html). Its route is available immediately, and
the first test request constructs the deferred controller with the stub.

## Lifecycle in tests

`createTestApp` is an `AsyncDisposable`, so `await using` cleans up:

```ts
await using app = createTestApp(AppModule);
await app.init(); // runs onModuleInit hooks
// ... assertions ...
// dispose runs onShutdown hooks at scope exit
```

## Design notes

- **Overrides apply before build** — the injected value is the override, through
  the same [container](./web-di.html).
- **In-process** — `request` uses the router's dispatcher; no socket.
- **No `as`** on the consumer surface.
- Granular import: `import { createTestApp } from '@zmdb/web/testing'`.

## Cross-links

- [Modules & providers](./web-modules.html) · [Application bootstrap](./web-app.html)
