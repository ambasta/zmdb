`@zmdb/app` provides dependency injection **without `emitDecoratorMetadata` or `reflect-metadata`**. Instead of reflecting constructor parameter types at runtime (the NestJS approach), you use
explicit, **typed tokens** and a small `Container`. The injected field's type is inferred from its token — so you never write an `as` cast to satisfy the container.

## Tokens

A `Token<T>` carries its instance type at compile time and is identified by reference:

```ts
import { createToken } from '@zmdb/app/di';

class Logger {
  log(m: string) {
    console.log(m);
  }
}

const LoggerToken = createToken<Logger>('Logger');
```

## The container

```ts
import { Container } from '@zmdb/app/di';

const container = new Container();
container.register(LoggerToken, new Logger());

container.resolve(LoggerToken); // Logger  (typed — no cast)
container.has(LoggerToken); // true

// container.register(LoggerToken, 42) → compile error (42 is not a Logger)
```

Resolving an unregistered token throws `UnresolvedTokenError`:

```ts
new Container().resolve(LoggerToken); // throws UnresolvedTokenError
```

## `@Inject` fields

Declare a field and annotate it with `@Inject(token)`. Build the class through the container to satisfy its injected fields:

```ts
import { Inject } from '@zmdb/app/di';

class UserService {
  @Inject(LoggerToken)
  logger!: Logger; // type inferred from the token — no 'as'

  greet() {
    this.logger.log('hi');
  }
}

const svc = container.build(UserService);
svc.greet();
```

> [!NOTE] Injection is resolved at `container.build(...)` (class-init) time and cached on the instance — **not** re-resolved per method call. The container is the one explicit, opt-in registry; there
> is no hidden global request-time state (the "current container" is set only for the duration of `build` and cleared in a `finally`).

## Design notes

- **No reflection / no `reflect-metadata`** — tokens are plain values; `@Inject` records requests in `Symbol.metadata`.
- **No `as` on the consumer surface** — the field type comes from the token. (The framework contains exactly one isolated, documented boundary cast for its internal heterogeneous token→instance map;
  see the source.)
- **O(1) resolution** keyed by token identity.
- Granular import: `import { Container } from '@zmdb/app/di'`.

## Cross-links

- [Controllers & routing](./web-controllers.html)
- [@zmdb/web overview](./web-overview.html)
