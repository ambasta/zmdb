`Scope` has two members — `'singleton'` (the default) and `'transient'`. There is **no request scope**, and that is a design decision rather than an omission.

## Singleton and transient

```ts
import { createToken } from '@zmdb/app/di';
import { Module } from '@zmdb/app/modules';

export const DRIVER = createToken<Driver>('DRIVER');
export const REQUEST_ID = createToken<string>('REQUEST_ID');

@Module({
  providers: [
    { token: DRIVER, useValue: driver }, // singleton
    { token: REQUEST_ID, useFactory: () => randomUUID(), scope: 'transient' }, // new per resolve
  ],
  controllers: [PostsController],
})
export class AppModule {}
```

`ProviderDef` is one of two shapes:

```ts
{ token, useValue }
{ token, useFactory: (c: Container) => T, scope?: Scope }
```

A factory receives the `Container`, so a provider can depend on another:

```ts
{ token: POSTS, useFactory: (c) => defineRepository(posts, c.resolve(DRIVER), { dialect: 'postgres' }) }
```

`scope` only applies to `useFactory`. A `'singleton'` factory runs once and the result is cached; a `'transient'` factory runs on every `resolve`.

> [!NOTE] The method is `resolve(token)`, not `get(token)`. `has(token)` checks for a registration without resolving, and `build(Ctor)` constructs a class and populates its `@Inject` fields.

## Why there is no request scope

A request-scoped provider means the container rebuilds a sub-graph on every request. That is per-request allocation and resolution work, which is precisely what constructing each controller once per
app avoids. A lazy controller moves that one construction to its first load; it does not become request-scoped. See [Performance](./web-performance.html).

The consequence is that request-specific values are **passed**, not injected. There is [no ambient request context](./web-request-context.html) either — no `AsyncLocalStorage`, no `ctx.state` bag.

```ts
@Controller('/posts')
export class PostsController {
  @Inject(POSTS) private readonly repo!: PostRepo;

  @Get('/')
  list(ctx: Ctx<Record<never, string>, unknown>) {
    return this.service.listFor(tenantFrom(ctx.headers)); // request value as an argument
  }
}
```

## The pattern for genuinely request-scoped resources

Build the dependency per request in the handler. A repository is an object over a `Driver`, so this allocation is trivial:

```ts
@Get('/')
async list(ctx: Ctx<Record<never, string>, unknown>) {
  const repo = defineRepository(posts, driverFor(tenantFrom(ctx.headers)), { dialect: 'postgres' });
  return repo.list({ page: { limit: 20 } });
}
```

That covers tenant scoping, row-level security, per-request query budgets and per-request batching without a scope mechanism. The full treatment, including the `set_config(..., true)`
transaction-local detail that prevents a cross-tenant leak on a pooled connection, is in [Request Context](./web-request-context.html).

> [!WARNING] Never store request state on a controller or provider field. Both are **singletons** — each instance is constructed once per app — so `this.currentUser = …` in a handler is a race that
> serves one user's data to another, and it looks correct in every single-request test.

## Transactions

A transaction is the request-scoped lifecycle people usually reach for a scope to express, and it needs no scope mechanism — `db.transaction` owns the callback, and `repo.withTransaction(tx)` returns
a **new repository instance** bound to that transaction's connection:

```ts
await this.db.transaction(async tx => {
  const posts = this.repo.withTransaction(tx);
  const post = await posts.create(dto);
  await posts.update(post.id, { slug: slugify(post.title) });
  return post;
});
```

The bound repository lives for the callback and no longer; `this.repo` is untouched and still runs outside the transaction. See [Transactions](./transactions.html).

## Substituting a provider in tests

Because everything is a singleton behind a token, overrides are the whole testing story:

```ts
const app = createTestApp(AppModule, {
  overrides: [{ token: DRIVER, useValue: fakeDriver }],
});
```

`compileModule(root, overrides)` registers the overrides **first**, so they win over anything in the module graph. See [Testing Applications](./web-testing.html).

---

See also: [Dependency Injection](./web-di.html) · [Request Context](./web-request-context.html) · [Modules](./web-modules.html)
