There is no `forwardRef`. What happens to a cycle depends on **where** the cycle is, and the two cases behave very differently — one gives you a clear error at boot, the other gives you a stack
overflow later.

## Module import cycles: caught at boot

`compileModule` tracks the modules it is visiting and throws the moment it re-enters one:

```ts
@Module({ imports: [BModule] })
class AModule {}
@Module({ imports: [AModule] })
class BModule {}

createApp(AModule);
// Error: @zmdb/web: import cycle in the module graph: AModule -> BModule -> AModule
```

Deterministic, names the cycle path, and runs at startup rather than on a request. Lazy import edges are included in the same validation.

## Provider cycles: not detected

Factory providers resolve **lazily**, and `Container.resolve` keeps no resolution stack. A factory that resolves a token whose factory resolves it back recurses until the stack ends:

```ts
{ token: A, useFactory: c => new Aa(c.resolve(B)) }
{ token: B, useFactory: c => new Bb(c.resolve(A)) }

container.resolve(A);
// RangeError: Maximum call stack size exceeded
```

Two things make this worse than it sounds:

- The error names nothing. `RangeError` with a stack of repeated frames is all you get.
- It surfaces **when the token is first resolved**. If nothing resolves it at boot, that is on a live request.

The same applies to `@Inject` fields, which resolve during `container.build`: two controllers injecting tokens whose factories construct each other recurse the same way.

`useValue` providers cannot cycle — the value already exists.

## Breaking a cycle

Restructuring is almost always right, because a cycle means the two units share a concern that belongs in a third.

**Hoist the shared concern:**

```ts
const EVENTS = createToken<EventBus>('EVENTS');

@Module({
  providers: [
    { token: EVENTS, useValue: new EventBus() },
    { token: A, useFactory: c => new Aa(c.resolve(EVENTS)) },
    { token: B, useFactory: c => new Bb(c.resolve(EVENTS)) },
  ],
})
class AppModule {}
```

`A` and `B` now depend on `EVENTS` and not on each other. This is usually the right fix: the "cycle" was two services reaching into each other to notify.

**Depend on the container, not the instance.** If one direction is only needed occasionally, resolve it at the point of use — lazily, and after both are registered:

```ts
{ token: A, useFactory: c => new Aa(() => c.resolve(B)) }
```

`Aa` holds a `() => Bb` and calls it inside a method. Nothing recurses at construction time. Use this sparingly: it makes the dependency invisible to a reader of the constructor, which is part of why
the cycle happened.

**Split the interface.** If `A` needs one method of `B` and `B` needs one method of `A`, those two methods are a third unit. Extract it and both depend on it.

## Do not paper over it

```ts
{ token: A, useFactory: c => { const a = new Aa(); a.b = c.resolve(B); return a; } }   // wrong
```

Mutating a half-constructed instance to escape the cycle leaves a window where `a.b` is `undefined`, and the crash lands somewhere unrelated. A cycle you cannot restructure is a design problem the
container should not hide.

## What remains

Provider-cycle detection still needs a resolution stack in `Container.resolve` that throws `A → B → A` on re-entry instead of recursing to the stack limit.

---

See also: [Dependency Injection](./web-di.html) · [Modules & Providers](./web-modules.html) · [Asynchronous Providers](./web-async-providers.html)
