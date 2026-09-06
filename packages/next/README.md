# @zmdb/next

`@zmdb/next` keeps generated zmdb clients on the correct side of the Next.js App Router boundary. Its server entry creates one request-owned client from Next headers, cookies, fetch and cache policy;
its browser entry is the existing `@zmdb/react` provider and hooks under a Next-specific factory name.

## Install

```bash
npm add @zmdb/next@alpha next@16 react@19 react-dom@19
```

## Server components and route handlers

```ts
import { createNextServerClient } from '@zmdb/next/server';
import { createApiClient } from './generated/http-client.generated.js';

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
  fetchPolicy: { cache: 'no-store' },
});

const getAccount = request.memoize(
  (client, id: string) => client.getAccount({ id }),
  id => id,
);
```

No incoming header or cookie is forwarded unless its name appears in the explicit allow-list. Construct the request scope inside the server component, route handler or server action that owns the
request; its memoized loaders must not be moved to module scope.

`fetchPolicy.cache` and `fetchPolicy.next` are passed to the supplied Next fetch. Use `cache: 'no-store'`, `cache: 'force-cache'`, or a `next: { revalidate, tags }` policy deliberately rather than
letting an adapter invent freshness.

## Client components

```ts
'use client';

import { createZmdbNextClient } from '@zmdb/next/client';
import type { ApiClient } from './generated/http-client.generated.js';

export const api = createZmdbNextClient<ApiClient>('Accounts');
```

The client entry contains no server export, request object, environment read, credential, or cache. It reuses `@zmdb/react` directly, including its provider, query cancellation, stale-result
suppression and mutation lifecycle.

## Entry points

- `@zmdb/next/client` — browser-safe React bindings.
- `@zmdb/next/server` — guarded request-scoped Next server client and memoization.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
