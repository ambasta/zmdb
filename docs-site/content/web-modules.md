Organize controllers and providers into composable **modules** over the
[DI container](./web-di.html) — the NestJS `@Module` analogue, declared and
validated **statically** at compile time (no per-request graph walk or
reflection).

## Declaring a module

```ts
import { Module, createToken } from '@zmdb/web';

class Clock {
  now() {
    return Date.now();
  }
}
const ClockToken = createToken<Clock>('Clock');

@Module({
  providers: [{ token: ClockToken, useValue: new Clock() }],
  exports: [ClockToken], // documents intended visibility; not enforced yet
})
class SharedModule {}

@Module({
  imports: [SharedModule], // ClockToken enters the shared container
  controllers: [TimeController], // built through the container
  providers: [{ token: CounterToken, useFactory: c => makeCounter(), scope: 'transient' }],
})
class AppModule {}
```

## Provider kinds & scopes

| provider            | shape                                       | resolution                 |
| ------------------- | ------------------------------------------- | -------------------------- |
| value               | `{ token, useValue }`                       | returns the bound value    |
| factory (singleton) | `{ token, useFactory }`                     | runs once, then **cached** |
| factory (transient) | `{ token, useFactory, scope: 'transient' }` | runs **every** `resolve`   |

## Compiling the graph

```ts
import { compileModule } from '@zmdb/web';

const { container, controllers, lazy } = compileModule(AppModule);
// providers registered (imports resolved first), controllers built with their
// @Inject-ed dependencies satisfied. Import cycles throw.
```

`lazy` is empty for an all-eager graph or contains one per-app handle for each
lazy subtree.

> [!WARNING]
> `exports` records intent but does not enforce visibility. The graph currently
> uses one flat container, while duplicate provider tokens across modules are
> refused at startup.

## Lazy imports

```ts
import { lazy, Module } from '@zmdb/web';

@Module({
  imports: [SharedModule, lazy(AdminModule)],
})
class AppModule {}
```

The complete graph is validated during `compileModule`, but `AdminModule` is
constructed only when one of its routes is first requested or its `app.lazy`
handle is loaded. Eager remains the default. See
[Lazy-Loading Modules](./web-lazy-modules.html) for concurrency, lifecycle and
failure behavior.

## Design notes

- **Static validation** — eager and lazy declarations are checked once;
  `resolve` is O(1), with no per-request reflection.
- **Acyclic** — a circular `imports` graph, including lazy edges, throws at
  `compileModule` and names the cycle path.
- **No `as` on the consumer surface** — provider tokens carry their type.
- Granular import: `import { Module } from '@zmdb/web/modules'`.

## Cross-links

- [Dependency injection](./web-di.html) · [Controllers & routing](./web-controllers.html)
