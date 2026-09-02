Supabase Edge Functions run on Deno. zmdb's runtime works there without changes; the AOT transformer does not run, and that is the whole story of this page.

## A function

```ts
// supabase/functions/api/index.ts
import { createApp } from 'npm:@zmdb/web';
import { AppModule } from './app-module.ts';

const app = createApp(AppModule);
const ready = app.init();

Deno.serve(async request => {
  await ready;
  return app.fetch(request);
});
```

`npm:` specifiers work because zmdb is ESM-only with zero runtime dependencies — there is nothing to resolve beyond the package itself.

## The transformer does not run

Deno strips type annotations and runs the result. There is no TypeScript transformer plugin mechanism, so the descriptor argument that `assert<T>` and `is<T>` need is never emitted.

The consequence, stated plainly: **`assert<T>(body)` returns the body unchanged and validates nothing.** No error, no warning. A validation layer that reports success on every input.

```ts
// in a Supabase Edge Function, this passes
assert<{ id: number }>({ id: 'not a number' });
```

Two honest options:

**1. Do not use the AOT validators here.** Everything else works natively — the query compiler, `BaseRepository`, the derived DTO _types_, `@zmdb/web` routing and DI. `schemaOf<T>()` needs the transform, so run the build step over the function's source and deploy the output. Validate the boundary with something Deno can run:

```ts
import { z } from 'npm:zod';

const CreatePost = z.object({ title: z.string().min(1), body: z.string() });

Deno.serve(async request => {
  const parsed = CreatePost.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  return Response.json(await postRepo.create(parsed.data), { status: 201 });
});
```

You keep the typed data layer and lose only the single-declaration validation. See [Zod](./interop-zod.html).

**2. Pre-build with `tsc` and the transformer.** Compile a module that owns validation, and import the built JavaScript from the function. Workable, but it means a build pipeline in front of a platform designed not to need one.

Whichever you choose, put the canary where it will be seen:

```ts
Deno.test('the transformer is running', () => {
  assertEquals(is<{ id: number }>({ id: 'x' }), false); // fails on Deno
});
```

Expect it to fail here. That is the point — a failing canary is the signal to use option 1, not something to skip.

## Connecting

Use the Supabase-provided connection details. From an Edge Function, prefer the HTTP-capable path:

```ts
import { neon } from 'npm:@neondatabase/serverless'; // works against any Postgres over HTTP proxying
```

Or `postgres` over TCP, which Deno supports:

```ts
import postgres from 'npm:postgres';

const dbUrl = Deno.env.get('SUPABASE_DB_URL');
if (dbUrl === undefined) throw new Error('missing SUPABASE_DB_URL');

const sql = postgres(dbUrl, { max: 1, prepare: false });

export const driver = {
  execute: async q => await sql.unsafe(q.text, [...q.parameters]),
};
```

Check the variable rather than asserting it with `!`. A missing secret then fails at module evaluation — the deploy is visibly broken — instead of surfacing as a connection error on a user's request. See [Configuration](./web-configuration.html).

`prepare: false` is required through Supavisor in transaction mode. `max: 1` because functions scale horizontally. See [Supabase](./connect-supabase.html).

## Row Level Security

This is the Supabase-specific design decision. If your tables have RLS policies, they apply to the `anon` and `authenticated` roles, not to the service role.

- **Service role key**: bypasses RLS entirely. Convenient, and it means your function is the only thing enforcing authorisation. Never expose it to a client.
- **User's JWT**: RLS applies, and the database enforces tenant isolation for you — which is a stronger guarantee than application code.

zmdb has no notion of RLS and no ambient request context, so passing the user's claims means a per-request driver:

```ts
function driverFor(jwt: string) {
  const sql = postgres(url, { max: 1, prepare: false });
  return {
    execute: async q => {
      await sql`SELECT set_config('request.jwt.claims', ${jwt}, true)`;
      return await sql.unsafe(q.text, [...q.parameters]);
    },
  };
}
```

Note `true` — that makes the setting transaction-local. With `false` it persists on a pooled connection and the _next_ request inherits the previous user's claims, which is a cross-tenant data leak. Build the driver per request; do not share one.

## Migrations

Use Supabase's own migration tooling (`supabase db push`), or zmdb's runner from CI against the direct connection string. Not from a function.

## Limits

Edge Functions have a CPU-time budget and a memory cap. zmdb adds essentially nothing to either — no engine, no metadata scan, no schema construction at load — which is why the platform fit is otherwise good.

---

See also: [Supabase](./connect-supabase.html) · [AOT Setup](./aot-setup.html) · [Zod](./interop-zod.html)
