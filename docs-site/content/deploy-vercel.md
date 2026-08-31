Vercel runs your code as functions. `App` exposes `fetch(request)` and owns no server, so it adapts directly — the work is in the connection arithmetic and the build step.

## A function

```ts
// api/[...path].ts
import { createApp } from '@zmdb/web';
import { AppModule } from '../src/app-module.js';

const app = createApp(AppModule);
const ready = app.init();

export default async function handler(request: Request) {
  await ready;
  return app.fetch(request);
}
```

Create the app at module scope and await the same promise, so `init()` runs once per instance rather than once per request. Warm invocations then reuse it.

## Connections are the problem

Two hundred concurrent instances each holding a pool of ten is two thousand connections at a database that accepts a hundred. The symptom is `too many clients already` under load — not at deploy, which is what makes it a production incident rather than a build failure.

Use an HTTP driver, which holds no connection:

```ts
import { neon } from '@neondatabase/serverless';
import type { Driver } from '@zmdb/repository';

const sql = neon(requireEnv('DATABASE_URL'));
export const driver: Driver = {
  execute: async q => await sql.query(q.text, [...q.parameters]),
};
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the first query.

[Neon](./connect-neon.html), [Supabase](./connect-supabase.html), [Vercel Postgres](./connect-vercel-postgres.html), [PlanetScale](./connect-planetscale.html) and [Turso](./connect-turso.html) all offer one.

> [!WARNING]
> HTTP drivers cannot hold a transaction across statements. `withTransaction` over
> one does not fail — each statement commits on its own and you get no atomicity.
> Use a WebSocket or TCP client where you need a real transaction.

If you must use TCP, put a pooler in front (Supavisor, PgBouncer in transaction mode) and set `max: 1` per instance.

## The build step

Vercel builds with its own pipeline, so the AOT transformer must be part of _your_ build rather than assumed:

```json
{
  "scripts": {
    "build": "tsup",
    "vercel-build": "yarn build && yarn test:transformer"
  }
}
```

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Make it a build gate. If the transformer does not run, every `assert` in your deployed application accepts anything — and nothing in the deploy output will tell you. See [AOT Setup](./aot-setup.html).

## Node runtime or Edge

|                                         | Node   | Edge   |
| --------------------------------------- | ------ | ------ |
| `node:sqlite`, `pg` (TCP)               | yes    | no     |
| HTTP drivers                            | yes    | yes    |
| zmdb compiler / repository / validators | yes    | yes    |
| Cold start                              | slower | faster |

Everything in zmdb works at the edge — the compiler is string manipulation and the validators contain no `new Function`, which is what makes them CSP- and Workers-compatible. What does not work at the edge is a TCP pool.

```ts
export const config = { runtime: 'edge' };
```

## Migrations

Not from a function. Two instances cold-starting together both run the runner.

```json
{ "buildCommand": "yarn build && node dist/scripts/migrate.js up" }
```

Use a **direct, non-pooled** connection string for this — multi-statement DDL through a transaction-mode pooler is how you get a half-applied migration. Neon and Supabase both give you a separate direct URL.

Better still, run migrations from CI before the deploy, so a failed migration does not produce a deployed application against an old schema.

## Environment variables

```ts
export const env = assert<{ DATABASE_URL: string }>({
  DATABASE_URL: process.env.DATABASE_URL,
});
```

Validating at module load means a missing variable fails the first invocation with the field name, rather than surfacing as `undefined` inside a connection string. Note that `Number(process.env.PORT)` with no default is `NaN`, and `NaN` passes a `number` check — default before coercing. See [Configuration](./configuration.html).

## Timeouts

Function timeouts are 10s on Hobby, configurable on Pro. Set `statement_timeout` below the function timeout so a slow query returns an error you can log rather than a killed invocation you cannot:

```ts
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, statement_timeout: 8_000 });
```

## Next.js

If you are on Next.js rather than bare functions, see [Next.js](./deploy-nextjs.html) — server components and route handlers change where the driver lives.

---

See also: [Serverless Performance](./perf-serverless.html) · [Neon](./connect-neon.html) · [Next.js](./deploy-nextjs.html)
