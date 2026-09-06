The `forRoot()` / `forFeature()` analogue. `Module` is a **class decorator**, so a configurable module is a function that returns a decorated class. There is no `ConfigurableModuleBuilder` and no
`DynamicModule` type — a function returning a `ModuleClass` is the whole mechanism.

## The forRoot pattern

```ts
import { createToken } from '@zmdb/app/di';
import { Module, type ModuleClass } from '@zmdb/app/modules';

export interface MailerOptions {
  readonly apiKey: string;
  readonly from: string;
}

export const MAILER_OPTIONS = createToken<MailerOptions>('MAILER_OPTIONS');
export const MAILER = createToken<Mailer>('MAILER');

export function mailerModule(options: MailerOptions): ModuleClass {
  @Module({
    providers: [
      { token: MAILER_OPTIONS, useValue: options },
      { token: MAILER, useFactory: c => new Mailer(c.resolve(MAILER_OPTIONS)) },
    ],
    exports: [MAILER],
  })
  class ConfiguredMailerModule {}

  return ConfiguredMailerModule;
}
```

```ts
@Module({
  imports: [mailerModule({ apiKey: requireEnv('MAILER_KEY'), from: 'noreply@example.com' })],
  controllers: [SignupController],
})
export class AppModule {}
```

Each call returns a **fresh class** with its own metadata, so two differently configured instances of the same module do not interfere at the decorator level.

A factory receives the `Container`, so it resolves its own options — there is no `inject: [...]` array on a provider.

## Two behaviours to know about

> [!WARNING] **`exports` is recorded but not enforced.** `compileModule` builds one flat container: every provider from every module in the graph is visible to every controller. Listing `exports`
> documents intent, and nothing stops a controller from injecting a token you did not export. Treat module boundaries as a convention, and keep internal tokens un-exported so the intent is at least
> readable.

Importing the same dynamic module twice with the same tokens is refused at startup:

```ts
imports: [mailerModule(transactional), mailerModule(marketing)];
// Error: duplicate provider token "MAILER_OPTIONS"
```

If you need two configurations of one thing, give them distinct tokens:

```ts
export const TRANSACTIONAL = createToken<Mailer>('TRANSACTIONAL');
export const MARKETING = createToken<Mailer>('MARKETING');
```

## The forFeature pattern

The same function, parameterised per feature. A repository module is the common case:

```ts
export function repositoryModule<S extends Schema>(token: Token<Repo<S>>, schema: S): ModuleClass {
  @Module({
    providers: [{ token, useFactory: c => defineRepository(schema, c.resolve(DRIVER)) }],
  })
  class FeatureModule {}

  return FeatureModule;
}
```

```ts
@Module({
  imports: [repositoryModule(USERS, users), repositoryModule(POSTS, posts)],
  controllers: [UsersController, PostsController],
})
export class AppModule {}
```

Distinct tokens avoid that declaration conflict. `repositoryToken<S>(name)` from `@zmdb/app/data` gives you a typed token in one call — see [Repository Providers](./web-data-integration.html).

## Ordering

For eager imports, `compileModule` visits `imports` depth-first, then registers the module's own providers and builds its controllers. So:

- A module's controllers see everything its imports registered. Good.
- An **imported** module's controllers do **not** see the importing module's providers, because those are registered afterwards. `@Inject` resolves eagerly at build time, so you get
  `UnresolvedTokenError` at boot.

Put a token in the module that owns it, and import that module wherever it is needed.

## Async options

`useFactory` is synchronous. Await the options before calling the module function — top-level `await` in an ESM entry point is the whole answer:

```ts
const secrets = await loadSecrets();

@Module({ imports: [mailerModule({ apiKey: secrets.mailerKey, from: 'noreply@example.com' })] })
class AppModule {}
```

See [Asynchronous Providers](./web-async-providers.html) for the alternatives.

## Testing a configured module

```ts
await using app = createTestApp(AppModule, {
  overrides: [{ token: MAILER, useValue: new RecordingMailer() }],
});
```

Overrides are registered first and win over any provider with the same token, so you do not need to re-parameterise the module under test.

## Design notes

- A function returning a class: no builder API, no `DynamicModule` shape, no runtime graph rewriting.
- Options are ordinary providers keyed by a [`Token`](./web-di.html), so the type flows without an `as`.
- Granular imports: `@zmdb/app/di`, `@zmdb/app/modules`.

---

See also: [Modules & Providers](./web-modules.html) · [Configuration](./web-configuration.html) · [Dependency Injection](./web-di.html)
