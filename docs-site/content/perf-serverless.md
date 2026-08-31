Serverless changes which costs matter. A long-running server pays startup once; a function pays it on every cold start, and that is where most data layers lose.

## What zmdb costs at cold start

Almost nothing, and for structural reasons rather than tuning:

|                             | zmdb                                                   |
| --------------------------- | ------------------------------------------------------ |
| Runtime dependencies        | zero                                                   |
| Native binaries             | none                                                   |
| Query engine                | none — the compiler is string manipulation             |
| Schema construction at load | a plain object per `defineSchema`                      |
| Validator construction      | none — descriptors are literals, built at compile time |
| Metadata reflection         | none — no `reflect-metadata`                           |
| Module graph walk           | `createApp` walks your modules once                    |

Compare that to a data layer shipping a native engine binary (unpack, load, initialise) or a validator that builds its schema graph at module load. Those costs are paid per cold start and are typically larger than the work the function does.

The [AOT validators](./jit-vs-aot.html) are where the gap is widest: a JIT validator constructs its checker on first use, on every cold start, forever. This one has nothing to construct.

## Connections are the real problem

A function that scales to 200 concurrent instances, each holding a pool of 10, is 2000 connections aimed at a database that accepts 100. The symptom is `too many clients already` under load, not at deploy.

Three answers, in order of preference:

**HTTP-based drivers.** No connection to hold, so the arithmetic disappears:

```ts
import { neon } from '@neondatabase/serverless';
const sql = neon(requireEnv('DATABASE_URL'));
export const driver: Driver = { execute: async q => await sql.query(q.text, [...q.parameters]) };
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the first query.

Available for [Neon](./connect-neon.html), [PlanetScale](./connect-planetscale.html), [Turso](./connect-turso.html), [D1](./connect-cloudflare-d1.html) and the [AWS Data API](./connect-aws-data-api.html).

> [!WARNING]
> HTTP drivers cannot hold a transaction across statements. A `db.transaction()`
> block over one does not error — it runs each statement in its own implicit
> transaction and gives you no atomicity. Use a WebSocket or TCP client where you
> need a real transaction.

**A pooler.** PgBouncer, Supavisor, RDS Proxy — in transaction mode, which breaks prepared statements and session-level `SET`. See [Postgres](./connect-postgres.html).

**A tiny pool.** `max: 1` per instance and let the platform's concurrency limit bound the total.

## Reuse across invocations

Put the client at module scope so a warm instance keeps it:

```ts
// module scope — survives between invocations on the same instance
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
export const driver: Driver = {/* ... */};

export async function handler(event: unknown) {
  const repo = defineRepository(users, driver, { dialect: 'postgres' }); // cheap, per invocation
  return repo.list({ page: { limit: 20 } });
}
```

The repository is an object over a driver, so constructing it per invocation costs nothing. The pool is what you want to keep.

Do **not** put migrations at module scope. Every cold start would race every other cold start. Run them from CI or a release step — see [migrate](./cli-migrate.html).

## `@zmdb/web` in a function

`App` exposes `fetch(request)` and `handle(req)`, so it adapts to any platform without a server:

```ts
const app = createApp(AppModule);
const ready = app.init();

export default async function (request: Request) {
  await ready;
  return app.fetch(request);
}
```

Create the app at module scope and await the same promise, so `init()` runs once per instance rather than once per request.

## Edge runtimes

The read path has no Node built-in dependencies — the compiler is string manipulation, the validators are generated code with no `new Function`, the DTOs are types. So Cloudflare Workers, Vercel Edge and Deno Deploy all work, with an HTTP driver.

What does not work at the edge: `node:sqlite`, a TCP pool, and anything needing `fs`. And note that Workers' lack of `eval` is exactly why the [no-`new Function`](./jit-vs-aot.html) property matters here rather than being a curiosity.

## Bundle size

No runtime dependencies means the data layer contributes almost nothing. What does contribute is the AOT descriptors — literals in your output, proportional to how many distinct types you validate. Usually small; worth measuring if you validate hundreds of large types at the edge.

## Timeouts and cold databases

A scale-to-zero database ([Neon](./connect-neon.html), Aurora Serverless) takes a few hundred milliseconds to resume. Set `statement_timeout` generously enough not to trip over a resume, and do not add a keep-warm ping that defeats the scale-to-zero you are paying for.

---

See also: [JIT vs AOT](./jit-vs-aot.html) · [Neon](./connect-neon.html) · [Deploy to Vercel](./deploy-vercel.html)
