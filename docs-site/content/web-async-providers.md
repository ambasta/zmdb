`ProviderDef.useFactory` is typed `(container: Container) => T` — **synchronous**. There is no `await` in the container and none in `createApp`, so "async provider" is a pattern you assemble rather
than a feature you switch on. Three shapes work; the first is the one to reach for.

## 1. Await before you build the module

ESM has top-level `await`, and a module graph built after the pool is open needs no async DI at all:

```ts
import { createToken } from '@zmdb/app/di';
import { Module } from '@zmdb/app/modules';
import { createApp } from '@zmdb/web/app';

const POOL = createToken<Pool>('POOL');

const pool = await openPool(config.databaseUrl); // top-level await

@Module({
  providers: [{ token: POOL, useValue: pool }],
  controllers: [UsersController],
})
class AppModule {}

await using app = createApp(AppModule);
await app.init();
```

Everything downstream sees a plain `Pool`, not a `Promise<Pool>`. Connection failure crashes the process before a single request is accepted, which is what you want from a dependency the application
cannot run without.

`createApp` is **synchronous** and takes the root module only — it returns an `App`, and `await app.init()` runs the lifecycle hooks. There is no options argument and no
`createApp({ controllers, providers })` object form.

## 2. Let the token hold the promise

When the dependency is genuinely optional or slow to warm, register the promise itself. A singleton factory caches its first result, so the work happens once no matter how many consumers there are:

```ts
const WARM = createToken<Promise<Index>>('WARM');

@Module({
  providers: [{ token: WARM, useFactory: () => buildIndex() }],
  controllers: [SearchController],
})
class SearchModule {}
```

```ts
@Controller('/search')
class SearchController {
  @Inject(WARM) private readonly index!: Promise<Index>;

  @Get('/')
  async search(ctx: Ctx<Record<never, string>, unknown>) {
    return (await this.index).query(String(ctx.query?.q ?? ''));
  }
}
```

The type tells the truth — consumers see `Promise<Index>` and must await it — and the factory waits until the token is first resolved. If an eager controller injects `WARM`, that resolution happens
during `createApp`; put `lazy(SearchModule)` in its importer when construction should wait for the first matching route.

> [!WARNING] A rejected promise is cached like any other value. If `buildIndex()` fails, every subsequent request gets the same rejection until the process restarts. Either let the failure be fatal
> (shape 1) or add your own retry inside the factory.

## 3. `onModuleInit` on a provider or controller

`app.init()` awaits `onModuleInit`, then `onApplicationBootstrap`, on each constructed eager provider and controller in construction order. A lazy module runs the same two passes on the instances
constructed when it loads:

```ts
@Controller('/users')
class UsersController {
  @Inject(POOL) private readonly pool!: Pool;

  async onModuleInit() {
    await this.pool.query('select 1'); // fail fast on a bad connection
  }

  async onShutdown() {
    await this.pool.end();
  }
}
```

> [!NOTE] A value provider enters the lifecycle ledger immediately. A factory provider enters only after it has actually been resolved. If that first resolution happens after `app.init()`, it receives
> shutdown but not retroactive init hooks; an unresolved factory receives neither.

Shutdown runs `onShutdown` in **reverse construction order**, so a provider or controller flushes before the dependency its factory or injected fields resolved.

## Which shape to pick

| Situation                                     | Shape                     |
| --------------------------------------------- | ------------------------- |
| The app cannot serve traffic without it       | 1 — top-level await       |
| Expensive, not needed on every route          | 2 — a promise-typed token |
| A readiness check or owned resource lifecycle | 3 — `onModuleInit`        |

## Ordering inside the module graph

For eager modules, `compileModule` walks depth-first: it visits `imports`, then registers the module's own `providers`, then **builds that module's controllers**. Lazy declarations are validated in
the same startup pass but constructed later. Because `@Inject` resolves eagerly at build time, an imported module's controller cannot inject a token that the importing module provides — you get
`UnresolvedTokenError` at boot, not at request time. Provide a token in the same module as the controllers that need it, or in a module they import.

## Design notes

- All provider factories remain synchronous. A first request to a lazy module may await that module's lifecycle hooks before the handler.
- No async container, no `forRootAsync`, no reflection.
- Granular imports: `@zmdb/app/di`, `@zmdb/app/modules`, `@zmdb/web/app`.

---

See also: [Application Bootstrap](./web-app.html) · [Modules & Providers](./web-modules.html) · [Dependency Injection](./web-di.html)
