There is no `ConfigModule` and no `ConfigService`. Configuration is a typed provider: one [`Token`](./web-di.html), one object, validated once with [`assert`](./validators-assert.html) so a
misconfigured process dies at startup instead of at 3am on a live request.

## A typed config provider

```ts
import { createToken } from '@zmdb/app/di';
import { Module } from '@zmdb/app/modules';
import { assert } from '@zmdb/aot-validator/utilities';

interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly logLevel: 'debug' | 'info' | 'warn';
}

export const CONFIG = createToken<Config>('CONFIG');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing env ${name}`);
  return value;
}

export function loadConfig(): Config {
  const config = {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: requireEnv('DATABASE_URL'),
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
  // logLevel is inferred as `string`, so this is a narrowing, not a formality:
  // assert returns the validated value typed as Config, or throws AssertError.
  return assert<Config>(config);
}
```

`createToken` comes from `@zmdb/app/di`, not from `@zmdb/app/modules` — the modules entry point exports `Module`, `compileModule` and the provider types only.

## Registering it

```ts
@Module({
  providers: [{ token: CONFIG, useValue: loadConfig() }],
  controllers: [UsersController],
})
export class AppModule {}
```

> [!WARNING] Use `useValue: loadConfig()`, not `useFactory: loadConfig`. Factory providers are **lazy** — `Container.resolve` runs the factory on first use and caches it. A validating factory that
> nothing resolves at boot moves your configuration error onto the first request that happens to need it, which is exactly the failure mode this page exists to prevent.

`useValue` evaluates while the class decorator argument is being built, so a bad environment throws before `createApp` is ever called.

## Deriving other providers from it

A factory receives the `Container`, so it resolves whatever else it needs. There is no `inject: [...]` array:

```ts
import { Pool } from 'pg';
import { postgresDriver } from '@zmdb/postgres';
import { defineRepository } from '@zmdb/repository';
import type { Driver } from '@zmdb/repository';
import { repositoryToken } from '@zmdb/app/data';

export const DRIVER = createToken<Driver>('DRIVER');
export const USERS = repositoryToken<User>('USERS');

@Module({
  providers: [
    { token: CONFIG, useValue: loadConfig() },
    { token: DRIVER, useFactory: c => postgresDriver(new Pool({ connectionString: c.resolve(CONFIG).databaseUrl })) },
    { token: USERS, useFactory: c => defineRepository(users, c.resolve(DRIVER)) },
  ],
  controllers: [UsersController],
})
export class AppModule {}
```

Laziness is the right default here: the driver is only constructed when something actually resolves it, so a unit test that overrides `DRIVER` never opens a socket.

## Consuming it

```ts
@Controller('/users')
export class UsersController {
  @Inject(CONFIG) private readonly config!: Config;
  @Inject(USERS) private readonly users!: BaseRepository<User>;
}
```

`@Inject` is a **field** decorator, and `repositoryToken<User>` is `Token<BaseRepository<User>>` — so the injected field is typed from the schema with no `as` anywhere. See
[Dependency Injection](./web-di.html) and [Repository Providers](./web-data-integration.html).

## Where the values come from

Node reads `.env` itself — `node --env-file=.env dist/main.js`. There is no loader to configure, no `envFilePath`, and no interpolation. If you need per-environment layering, load two files
(`--env-file=.env --env-file=.env.local`); later files win.

| Source                                 | Use for                    |
| -------------------------------------- | -------------------------- |
| Process environment                    | everything, in production  |
| `--env-file`                           | local development          |
| A secret manager, read in `loadConfig` | credentials, in production |

> [!WARNING] Never commit `.env`, and never log the config object — `databaseUrl` contains a password. Log the keys, or a redacted view: `{ ...config, databaseUrl: '<set>' }`.

## Typing environment variables

`process.env.X` is `string | undefined`, and every value arrives as a string. Both facts are load-bearing:

- `Number(process.env.PORT)` is `NaN` when the variable is absent or misspelt, and `NaN` is a `number` as far as TypeScript is concerned — `assert<Config>` is what catches it, so do not skip it.
- `LOG_LEVEL=verbose` is a `string`, not the union member you declared. `assert<Config>` rejects it with the offending path.

That is the whole argument for validating: the type says `Config`, the environment says otherwise, and only a runtime check reconciles the two.

## Testing with a different config

```ts
await using app = createTestApp(AppModule, {
  overrides: [{ token: CONFIG, useValue: { port: 0, databaseUrl: 'memory://', logLevel: 'warn' } }],
});
```

Overrides are registered before any controller is built, so the controller under test sees the substitute. See [Testing](./web-testing.html).

## Design notes

- One `Token<Config>` keeps the type flowing with no `as` at any call site.
- No namespaced registry and no `configService.get('a.b.c')` string paths — a dotted string is an unchecked path, and a field access is a checked one.
- Granular imports: `@zmdb/app/di`, `@zmdb/app/modules`.

---

See also: [Dependency Injection](./web-di.html) · [Dynamic Modules](./web-dynamic-modules.html) · [assert()](./validators-assert.html)
