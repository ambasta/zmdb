`App` owns no server. It exposes `handle(req)` for a framework-neutral request and `fetch(request)` for a web-standard one, and that is the whole transport surface — which is what lets one application run behind `node:http`, a Fetch runtime, a Lambda, a test harness, or no server at all.

## No `listen()`

```ts
export interface App extends AsyncDisposable {
  readonly container: Container;
  readonly lazy: readonly LazyModuleHandle[];
  handle(req: WebRequest): Promise<WebResponse>;
  fetch(request: Request): Promise<Response>;
  init(): Promise<void>;
}
```

There is deliberately no `app.listen(3000)`. Binding a socket is the host's job, and keeping it out means the same application object is driven identically by a server, a serverless invocation and a test.

## Behind `node:http`

`toNodeHandler` does the body reading and header flattening for you:

```ts
import { createServer } from 'node:http';
import { createRouter, toNodeHandler } from '@zmdb/web/pipeline';
import { PostsController } from './posts.controller.js';

const router = createRouter();
router.register(new PostsController());

createServer(toNodeHandler(router)).listen(3000, '0.0.0.0');
```

That is the router-level API. With a module graph, go through `createApp` and adapt `handle` yourself:

```ts
import { createApp } from '@zmdb/web/app';
import { bodyText } from '@zmdb/web/pipeline';

const app = createApp(AppModule);
await app.init();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');

  const out = await app.handle({
    method: req.method ?? 'GET',
    path: (req.url ?? '/').split('?')[0] ?? '/',
    headers: req.headers as Record<string, string>,
    rawBody: raw.length > 0 ? JSON.parse(raw) : undefined,
  });

  res.writeHead(out.status, { ...out.headers }).end(await bodyText(out));
}).listen(3000, '0.0.0.0');
```

Note `path` excludes the query string — `WebRequest` has a separate `query` field, and passing `/users?a=1` as `path` means no route matches.
This hand-written module adapter buffers streamed responses; the router-level
`toNodeHandler` above preserves streaming and backpressure.

## Behind a Fetch runtime

```ts
export default { fetch: (request: Request) => app.fetch(request) };
```

Works on Cloudflare Workers, Deno, Bun, Vercel Edge and Netlify Edge unchanged. `toFetchHandler(router)` is the router-level equivalent.

## With no server at all

A CLI, a queue consumer, a cron job — anything that wants the container and the services but no HTTP:

```ts
const app = createApp(AppModule);
await app.init();

const repo = app.container.resolve(POSTS);
await repo.create({ title: 'from a script', body: '…' });
```

`container.resolve(token)` is the accessor. This is the closest thing to a "standalone application" in the NestJS sense, and it needs no special mode — the container is just a property.

## Lifecycle

```ts
import type { OnModuleInit, OnApplicationBootstrap, OnShutdown } from '@zmdb/web/app';

@Controller('/posts')
export class PostsController implements OnModuleInit, OnShutdown {
  @Inject(POOL) private readonly pool!: Pool;

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }
  async onShutdown() {
    await this.pool.end();
  }
}
```

`init()` runs `onModuleInit` on every constructed eager provider and controller,
then `onApplicationBootstrap` on the same ledger. A lazily imported module runs
both passes on the instances it constructs. Disposal runs `onShutdown` in
**reverse construction order**, so a dependent stops before the dependency its
factory resolved; a lazy module that never loaded has nothing to stop.

> [!NOTE]
> Value providers enter lifecycle immediately. Factory providers enter only when
> resolved: one resolved after `init()` is still shut down, but does not receive
> retroactive init hooks, and an unresolved factory is never built merely to stop
> it.

## Graceful shutdown

`App` is `AsyncDisposable`, so `await using` handles it:

```ts
await using app = createApp(AppModule);
await app.init();
// on scope exit: every constructed provider/controller's onShutdown, in reverse order
```

With a long-lived server you want the signal handlers too, since the scope never exits:

```ts
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => void app[Symbol.asyncDispose]().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
```

The timeout matters: `server.close` waits for open connections, and one idle keep-alive connection will hang the shutdown indefinitely.

## Several apps in one process

Nothing is global. Two `createApp` calls give two containers and two routers:

```ts
const publicApp = createApp(PublicModule);
const adminApp = createApp(AdminModule);
```

See [Multiple Servers](./web-multiple-servers.html).

---

See also: [Request Lifecycle](./web-request-lifecycle.html) · [Deployment](./deployment.html) · [Testing Applications](./web-testing.html)
