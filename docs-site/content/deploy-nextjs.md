Next.js and zmdb divide cleanly: Next owns rendering and routing, while zmdb owns the schema, generated HTTP contract, queries, and validation. There are two supported boundaries:

- use `@zmdb/next` when the Next application calls a separately deployed zmdb HTTP API through its generated client; or
- call repositories directly when the Next server process owns the database connection.

## Generated HTTP clients

Install the request-scoped adapter and framework peers:

```bash
npm add @zmdb/next@alpha next@16 react@19 react-dom@19
```

The server entry reads the current Next header and cookie stores only while creating a request scope. Nothing is forwarded by default:

```ts
import { createNextServerClient } from '@zmdb/next/server';
import { createApiClient } from '@/generated/http-client.generated.js';

const apiOrigin = process.env['API_ORIGIN'];
if (apiOrigin === undefined) throw new Error('API_ORIGIN is required');

const request = await createNextServerClient({
  createClient: createApiClient,
  baseUrl: apiOrigin,
  fetch: globalThis.fetch,
  forward: {
    headers: ['authorization', 'x-tenant-id'],
    cookies: ['session'],
  },
  fetchPolicy: { next: { revalidate: 60, tags: ['accounts'] } },
});
```

Create that scope inside the server component, route handler, or server action that owns the request. `request.memoize(load, key)` shares duplicate work only inside that scope; it never shares a
client, credential, or result map across requests. `cache: 'no-store'`, `cache: 'force-cache'`, and `next: { revalidate, tags }` pass through to the supplied Next fetch unchanged.

Client components import only `@zmdb/next/client`. It reuses the `@zmdb/react` provider and hooks; the package has no mixed root barrel, and the guarded server entry cannot enter a client component.
See [Framework Integrations](./framework-integrations.html) for the client binding.

## Direct database access

## One module for the driver

```ts
// src/server/db.ts   — server only
import 'server-only';
import { Pool } from 'pg';
import { defineRepository } from '@zmdb/repository';
import { users, posts } from '@/schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

const driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};

export const userRepo = defineRepository(users, driver, { dialect: 'postgres' });
export const postRepo = defineRepository(posts, driver, { dialect: 'postgres' });
```

`import 'server-only'` is the guard that matters. Without it, importing this from a client component is a build-time-successful, runtime-broken bundle — and it would ship your connection string to the
browser. Add it before you write anything else.

The schema file itself is safe to import anywhere: `schemaOf<Post>()` compiles to a plain object literal and the DTO types are types, so a client component can use `Entity<Post>` with no runtime cost.

## Server components

```tsx
// app/posts/page.tsx
import { postRepo } from '@/server/db';

export default async function PostsPage() {
  const { items } = await postRepo.list({
    orderBy: [{ column: 'createdAt', dir: 'desc' }],
    page: { limit: 20 },
  });

  return (
    <ul>
      {items.map(p => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  );
}
```

Query directly. No API route, no fetch, no serialisation — and `p.title` is typed from the schema.

Watch for N+1s: a server component that renders a list of children, each fetching its own row, is a query per child. Fetch with `populate` in the parent and pass down. See
[Loading Strategies](./loading-strategies.html).

## Route handlers

```ts
// app/api/posts/route.ts
import { assert } from '@zmdb/aot-validator/utilities';
import { postRepo } from '@/server/db';
import type { CreateDTO } from '@zmdb/repository';
import { posts } from '@/schema.js';

export async function POST(request: Request) {
  const dto = assert<CreateDTO<Post>>(await request.json());
  const created = await postRepo.create(dto);
  return Response.json(created, { status: 201 });
}
```

`CreateDTO<Post>` is derived, so adding a required column is a type error here rather than a runtime rejection.

## Server actions

```ts
'use server';
import { revalidatePath } from 'next/cache';

export async function createPost(formData: FormData) {
  const dto = assert<CreateDTO<Post>>({
    title: String(formData.get('title')),
    body: String(formData.get('body')),
  });
  await postRepo.create(dto);
  revalidatePath('/posts');
}
```

A server action is a public endpoint. `FormData` is entirely attacker-controlled, so validate it and authorise it in the action — the fact that it is only called from your own form is not a control.

## The transformer

This is the part that bites. Next.js compiles with SWC or Turbopack, and **the zmdb TypeScript transformer does not run in either**. So `assert<T>` in a route handler or server action silently
validates nothing.

Two workable answers:

- **Compile the validated modules separately.** Keep `assert`-using code in a small package built with `tsc` and the transformer, and import the built output. Verifiable, and the canary test covers
  it.
- **Do not use the AOT validators under Next.** Use the schema, compiler, repository and DTO types — none of which need a transformer — and validate with Zod or ajv at the Next boundary. See
  [Zod](./interop-zod.html).

Either way, put the canary somewhere it runs:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

If it fails, pick one of the two options above rather than shipping. This is the single most important thing on this page.

## Connections

`next dev` reloads modules, which means a new `Pool` per reload and a leak until you restart. Cache it on `globalThis` in development:

```ts
const g = globalThis as { __pool?: Pool };
const pool = g.__pool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
if (process.env.NODE_ENV !== 'production') g.__pool = pool;
```

In production on Vercel, prefer an HTTP driver — see [Vercel](./deploy-vercel.html) for the connection arithmetic and the transaction caveat.

## Caching

Next caches aggressively. A server component reading the database is cached unless you opt out:

```ts
export const dynamic = 'force-dynamic'; // per route
```

Or `revalidate` for time-based freshness. This interacts with zmdb not at all — but a "stale data" bug in a Next app reading from a database is much more often Next's cache than the query.

## Migrations

From CI or a release step, never from a route handler or `instrumentation.ts`. See [migrate](./cli-migrate.html).

---

See also: [Vercel](./deploy-vercel.html) · [AOT Setup](./aot-setup.html) · [Zod](./interop-zod.html)
