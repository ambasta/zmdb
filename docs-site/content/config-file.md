> **ToDo / feature gap.** There is no configuration file and nothing that reads
> one. No `zmdb.config.ts`, no `drizzle.config.ts` equivalent, no
> `mikro-orm.config.ts`. Everything is a function argument.

## What zmdb takes instead of config

| Concern         | How it is supplied                                                       |
| --------------- | ------------------------------------------------------------------------ |
| dialect         | `createQueryCompiler('postgres')`, `defineRepository(s, d, { dialect })` |
| connection      | a `Driver` you construct and pass                                        |
| schema location | you `import` it                                                          |
| relations       | `defineRepository(s, d, { relations })`                                  |
| migrations      | an array you build and pass to `runCli`                                  |

There is no discovery step and no ambient configuration, which has a real upside: a repository cannot be constructed against the wrong database because a config file was resolved from the wrong directory. It also means there is nothing for the database commands to read — the config loader is their prerequisite, not a prerequisite for the existing `modules` and `repl` commands.

## Doing it yourself, in TypeScript

A config module is the useful pattern even without tooling that consumes it, because it puts the environment reading in one place:

```ts
// src/config.ts
import { Pool } from 'pg';
import type { Driver, Dialect } from '@zmdb/query-compiler';

const required = (name: string): string => {
  const v = process.env[name];
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
};

export const dialect: Dialect = 'postgres';

export const pool = new Pool({
  connectionString: required('DATABASE_URL'),
  max: Number(process.env.DB_POOL_MAX ?? 10),
  statement_timeout: 5_000,
});

export const driver: Driver = {
  async execute(q) {
    const res = await pool.query(q.text, [...q.parameters]);
    return res.rows;
  },
};
```

Validate the whole environment once, at startup, rather than reading `process.env` where it is needed:

```ts
import { assert } from '@zmdb/aot-validator/utilities';

interface Env {
  DATABASE_URL: string;
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn';
}

export const env = assert<Env>({
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: Number(process.env.PORT ?? 3000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
});
```

A missing or misspelled variable fails at boot with the field name, instead of at 3am as `undefined` in a connection string. That is the single highest-value use of the validator in an application.

> [!NOTE]
> `Number(undefined)` is `NaN`, not a failure — `NaN` is a `number`, so it passes
> a `number` check. Default before coercing, as above, or type the field as a
> string and parse it after.

## Per-environment values

Plain code, no cascade to reason about:

```ts
export const config = {
  development: { poolMax: 2, logQueries: true },
  production: { poolMax: 20, logQueries: false },
}[process.env.NODE_ENV === 'production' ? 'production' : 'development'];
```

## Wiring it through DI

If you are using `@zmdb/web`, the driver belongs in the container so tests can substitute it:

```ts
export const DRIVER = createToken<Driver>('DRIVER');

@Module({
  providers: [{ token: DRIVER, useValue: driver }],
  controllers: [UsersController],
})
export class AppModule {}
```

`createTestApp(AppModule, { overrides: [{ token: DRIVER, useValue: fakeDriver }] })` then swaps it for a test. See [Testing](./testing.html).

## What a config file would need to decide

Two things, and they are the reason this is not just a JSON reader:

1. **How schemas are located.** A glob (`src/**/*.schema.ts`) means the CLI has to load TypeScript, which means a loader, which means a build-tool dependency in a project with [zero runtime dependencies](./why-zmdb.html). An explicit `schemas: () => import('./src/schema.js')` avoids that and keeps the import in your code.
2. **Whether the application reads it too.** If the config file is CLI-only, there are two sources of connection truth. If the application reads it, zmdb acquires an initialisation step — the thing its architecture currently does without.

The likely shape is a TypeScript module the CLI imports and the application may import, exporting a typed object, with no discovery and no defaults resolved from the filesystem.

---

See also: [CLI Overview](./cli-overview.html) · [Configuration](./configuration.html) · [Writing a Driver](./custom-driver.html)
