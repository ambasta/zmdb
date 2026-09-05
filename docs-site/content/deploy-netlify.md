Netlify has two runtimes: Functions (Node, on AWS Lambda) and Edge Functions (Deno). zmdb runs on both; the transformer and the connection count are what need attention.

## A Function

```ts
// netlify/functions/api.mts
import { createApp } from '@zmdb/web';
import { AppModule } from '../../src/app-module.js';
import type { Config } from '@netlify/functions';

const app = createApp(AppModule);
const ready = app.init();

export default async (request: Request) => {
  await ready;
  return app.fetch(request);
};

export const config: Config = { path: '/api/*' };
```

`app.fetch` takes a web-standard `Request`, which is exactly what Netlify's modern function signature provides — so there is no adapter.

Module-scope app, awaited once. `config.path` routes everything under `/api` to this function; your controllers see the full path, so declare them as `@Controller('/api/posts')`.

## An Edge Function

```ts
// netlify/edge-functions/api.ts
import { createApp } from '@zmdb/web';
import { AppModule } from '../../src/app-module.js';

const app = createApp(AppModule);
const ready = app.init();

export default async (request: Request) => {
  await ready;
  return app.fetch(request);
};

export const config = { path: '/api/*' };
```

Same code. Edge Functions run on Deno, so:

- No `node:sqlite`, no `pg` over TCP, no `fs`.
- HTTP drivers only — [Neon](./connect-neon.html), [Turso](./connect-turso.html), [PlanetScale](./connect-planetscale.html), [Supabase](./connect-supabase.html).
- zmdb's compiler, repository and validators all work: no runtime codegen, no Node built-ins on the read path.

## The transformer

Netlify builds functions with esbuild, which **does not run TypeScript transformers**. Type annotations are stripped and nothing else happens — so `assert<T>` receives no descriptor and validates
nothing, silently.

Build with `tsc` yourself and point Netlify at the output:

```toml
# netlify.toml
[build]
  command = "yarn build && yarn test:transformer"
  publish = "dist"

[functions]
  directory = "dist/functions"
  node_bundler = "none"
```

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

`node_bundler = "none"` with pre-built output is the reliable arrangement: your build produces the transformed JavaScript, Netlify ships it unchanged. Since zmdb has zero runtime dependencies, there
is very little for a bundler to do anyway.

Make the canary a build gate. It is the only thing standing between a misconfigured build and a deployed application whose validation layer reports success unconditionally. See
[AOT Setup](./aot-setup.html).

## Connections

Lambda-backed Functions scale to many concurrent instances, so the arithmetic from [Serverless Performance](./perf-serverless.html) applies: an HTTP driver, or a pooler plus `max: 1`.

```ts
import { neon } from '@neondatabase/serverless';
const sql = neon(requireEnv('DATABASE_URL'));
export const driver: Driver = { execute: async q => await sql.query(q.text, [...q.parameters]) };
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the
first query.

> [!WARNING] An HTTP driver cannot hold a transaction across statements. `withTransaction` over one gives you no atomicity and no error — each statement commits alone.

## Environment and secrets

Set them in the Netlify UI or `netlify env:set`, scoped per context (production, deploy-preview, branch). Validate at module load:

```ts
export const env = assert<{ DATABASE_URL: string }>({ DATABASE_URL: process.env.DATABASE_URL });
```

Deploy previews are the trap here: a preview pointed at the production database will happily let a test run destroy real data. Give previews their own database, or fail the build when the context is a
preview and the URL is production.

## Migrations

From CI, before the deploy, with a direct non-pooled connection. Not from a function — concurrent cold starts race. See [migrate](./cli-migrate.html).

## Timeouts

Functions default to 10s (26s configurable); Edge Functions have a 50ms CPU budget with unbounded wall time for I/O. Set `statement_timeout` under the function limit so a slow query is a logged error
rather than a killed invocation.

---

See also: [Serverless Performance](./perf-serverless.html) · [AOT Setup](./aot-setup.html) · [Vercel](./deploy-vercel.html)
