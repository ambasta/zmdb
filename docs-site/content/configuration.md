Application configuration has no implicit initialisation step. Everything the runtime needs is still a function argument, which means a wrong repository or web configuration is usually a compile error
rather than a filesystem surprise.

Build tools and the schema-command CLI have a separate [`zmdb.config.ts`](./config-file.html) loader. Applications do not read it automatically.

## What each layer takes

```ts
createQueryCompiler(dialect)                          // SqlDialect object or temporary built-in name
schemaOf<T>()                                         // the declaration; compiled away at build time
defineRepository(schema, driver, { dialect?, schemas? })
createApp(rootModule)
toOpenApi(httpContractIR, { info? })
```

That is the complete runtime surface. There is no `reflect-metadata`, boot-time metadata scan, or ambient config read. `zmdb.config.ts` is an explicit tooling boundary for schema files, dialect and
migration paths; it does not change how an application constructs a driver or repository.

The one thing that _is_ configured outside a function argument is the build plugin, because it has to find your `tsconfig.json`. The umbrella entry discovers `zmdb.config.ts` and passes its resolved
project and naming strategy to the transformer:

```ts
// vite.config.ts / rollup.config.js / esbuild plugin list
import { zmdbAot } from 'zmdb/unplugin';

const plugin = await zmdbAot();
```

`schemaOf<T>()` and the other generic AOT calls are replaced there. See [AOT Setup](./aot-setup.html).

## A configuration module

The useful pattern is one module that reads the environment and exports typed values:

```ts
// src/config.ts
import { Pool } from 'pg';
import { assert } from '@zmdb/aot-validator/utilities';
import type { Dialect } from '@zmdb/query-compiler';
import type { Driver } from '@zmdb/repository';

interface Env {
  DATABASE_URL: string;
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DB_POOL_MAX: number;
}

export const env = assert<Env>({
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: Number(process.env.PORT ?? 3000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX ?? 10),
});

export const dialect: Dialect = 'postgres';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  statement_timeout: 5_000,
});

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

Validating the environment once, at import, is the highest-value use of the validator in an application. A missing `DATABASE_URL` fails at startup naming the field, instead of at 3am as `undefined`
inside a connection string.

> [!WARNING] `Number(undefined)` is `NaN`, and `NaN` is a `number` — so it passes a `number` check. Default _before_ coercing, as above. `Number(process.env.PORT)` with no `??` will validate cleanly
> and then bind to nothing.

## Per-environment values

Plain code, with no cascade to reason about:

```ts
const perEnv = {
  development: { poolMax: 2, logQueries: true },
  test: { poolMax: 1, logQueries: false },
  production: { poolMax: 20, logQueries: false },
} as const;

export const settings = perEnv[env.NODE_ENV] ?? perEnv.development;
```

## Wiring it into the container

Put the driver in DI so tests can replace it:

```ts
import { repositoryToken } from '@zmdb/web/data';

export const DRIVER = createToken<Driver>('DRIVER');
export const USERS = repositoryToken<User>('USERS'); // Token<BaseRepository<User>>

@Module({
  providers: [
    { token: DRIVER, useValue: driver },
    { token: USERS, useFactory: c => defineRepository(users, c.resolve(DRIVER), { dialect }) },
  ],
  controllers: [UsersController],
})
export class AppModule {}
```

```ts
const app = createTestApp(AppModule, { overrides: [{ token: DRIVER, useValue: fakeDriver }] });
```

See [Providers & Tokens](./web-modules.html) and [Testing](./testing.html).

## Secrets

Read them from the environment or a secret manager; never from a committed file. And note that a validated `env` object makes them easy to log by accident:

```ts
console.log(env); // logs DATABASE_URL, including the password
```

Log a redacted projection instead, or mark the column [`Sensitive`](./tags-reference.html) and log a `ReadDTO<T>`, which cannot name it.

## Dialect at build time versus runtime

A built-in `Dialect` name is a value, so it can come from the environment — which is how one codebase targets SQLite in tests and Postgres in production:

```ts
export const dialect = (process.env.DB_DIALECT ?? 'postgres') as Dialect;
```

The cost is that dialect differences become runtime differences. `ILIKE`, `RETURNING`, `ON CONFLICT` and transactional DDL all vary — see [Dialect: SQLite](./dialect-sqlite.html). Fine for a test
suite; think carefully before shipping two dialects to production.

A third-party database instead exports a frozen `SqlDialect` object. Pass that same object to `createQueryCompiler` and attach it to the driver; the repository then consumes its already-resolved
traits, capabilities, migration implementation and introspector without a global registry. The tooling config and CLI still use built-in names until the database-package extraction completes.

---

See also: [Config File](./config-file.html) · [Writing a Driver](./custom-driver.html) · [Providers & Tokens](./web-modules.html)
