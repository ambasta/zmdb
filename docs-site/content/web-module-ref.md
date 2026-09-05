There is no `ModuleRef`. There are two explicit surfaces instead: `app.container`, for typed provider lookup, and `app.lazy`, for loading a module that was declared lazy.

## Getting a provider

```ts
const app = createApp(AppModule);
await app.init();

const repo = app.container.resolve(POSTS);
```

```ts
export class Container {
  register<T>(token: Token<T>, instance: T): void;
  registerFactory<T>(token: Token<T>, factory: (c: Container) => T, scope?: Scope): void;
  has<T>(token: Token<T>): boolean;
  resolve<T>(token: Token<T>): T;
  build<T>(Ctor: Constructor<T>): T;
}
```

`resolve` is typed by the token, so `resolve(POSTS)` returns the repository with no cast — that is what the phantom type parameter on `Token<T>` buys:

```ts
import { repositoryToken } from '@zmdb/web/data';
export const POSTS = repositoryToken<Post>('POSTS'); // Token<BaseRepository<Post>>
```

Note it is `resolve`, not `get`. An unregistered token throws `UnresolvedTokenError` naming the description, which is why the description should be the token's real name.

## Inside a class, prefer `@Inject`

```ts
@Controller('/posts')
export class PostsController {
  @Inject(POSTS) private readonly repo!: PostRepo;
}
```

`@Inject` is a **field** decorator. The `!` is required — the decorator supplies the initializer, so TypeScript needs the definite-assignment assertion. Constructor-parameter injection does not work:
`Container.build` calls `new Ctor()` with no arguments, and `Constructor<T>` is `new () => T`.

An injected field resolves once, during its controller's construction. Eager controllers are constructed at startup; a lazily imported controller is constructed on its first load. Neither path adds a
per-request provider proxy.

## When you genuinely need the container

Inject it. Nothing stops you registering it under a token:

```ts
export const CONTAINER = createToken<Container>('CONTAINER');

@Module({
  providers: [{ token: CONTAINER, useFactory: c => c }],
})
export class AppModule {}
```

A factory receives the container, so this is a one-liner. Use it for a genuine service locator need — a strategy chosen by name at runtime:

```ts
@Inject(CONTAINER) private readonly container!: Container;

handlerFor(kind: string) {
  const token = HANDLERS[kind];
  return token !== undefined && this.container.has(token) ? this.container.resolve(token) : undefined;
}
```

`has` before `resolve` is the pattern for an optional dependency, since there is no `{ optional: true }`.

Do not reach for this by default. A field-injected dependency is checked at compile time; a token looked up by string is not.

## A factory receiving other providers

The usual reason people want `ModuleRef` — building one provider from others — is just the factory signature:

```ts
@Module({
  providers: [
    { token: DRIVER, useValue: driver },
    { token: POSTS, useFactory: c => defineRepository(posts, c.resolve(DRIVER), { dialect }) },
  ],
})
export class DataModule {}
```

Order does not matter: factories run lazily on first `resolve`, and a singleton caches its result back into the bindings.

## Loading a declared lazy module

```ts
const admin = app.lazy.find(handle => handle.name === 'AdminModule');
await admin?.load();
```

The handle belongs to this app, reports `'unloaded' | 'loading' | 'loaded' | 'failed'`, and loads only a module already declared with `lazy(AdminModule)` in the graph. It is not an API for attaching
an arbitrary class at runtime.

## Transient providers

```ts
{ token: REQUEST_ID, useFactory: () => crypto.randomUUID(), scope: 'transient' }
```

`Scope` is `'singleton' | 'transient'`. A transient factory re-runs on every `resolve`, which is the closest thing to a non-singleton instance — but note that a field-injected transient resolves
**once**, at construction, so the holder keeps one value. Transient only behaves transiently when you call `resolve` yourself. See [Injection Scopes](./web-injection-scopes.html).

## What `ModuleRef` does that this does not

- **`resolve()` with a fresh dependency subtree.** No equivalent; scopes are singleton or transient only.
- **Module-scoped lookup.** `compileModule` builds **one flat container** for the whole graph, so there is no per-module registry to look in. Which brings us to the caveat below.
- **Arbitrary runtime module attachment.** Lazy subtrees must be declared and validated at startup. See [Lazy Modules](./web-lazy-modules.html).

> [!WARNING] `ModuleDef.exports` is accepted and **not enforced**. Every provider from every module in the graph lands in one container, so a controller can inject a token from a module it did not
> import. A token collision between two modules is refused at startup. Keep tokens unique, export them from one owner module, and treat `exports` as documentation for now.

---

See also: [DI Container](./web-di.html) · [Modules](./web-modules.html) · [Injection Scopes](./web-injection-scopes.html)
