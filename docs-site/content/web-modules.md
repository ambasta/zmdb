Organize controllers and providers into composable **modules** over the
[DI container](./web-di.html) — the NestJS `@Module` analogue, resolved
**statically** at compile time (no per-request graph walk, no reflection).

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
  exports: [ClockToken], // visible to modules that import this one
})
class SharedModule {}

@Module({
  imports: [SharedModule], // ClockToken becomes resolvable here
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

const { container, controllers } = compileModule(AppModule);
// providers registered (imports resolved first), controllers built with their
// @Inject-ed dependencies satisfied. Import cycles throw.
```

## Design notes

- **Static wiring** — the module graph is walked once; `resolve` is O(1). No
  per-request reflection.
- **Acyclic** — a circular `imports` graph throws at `compileModule`.
- **No `as` on the consumer surface** — provider tokens carry their type.
- Granular import: `import { Module } from '@zmdb/web/modules'`.

## Cross-links

- [Dependency injection](./web-di.html) · [Controllers & routing](./web-controllers.html)
