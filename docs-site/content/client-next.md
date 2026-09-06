Start with the [generated HTTP client](./generated-client.html), then add Next.js for request-local App Router clients, explicit credential forwarding, cache policy, and a separate browser entry. The
generated module and `@zmdb/client` own URL construction, authentication patching, transport, response validation, and stable errors. Generated HTTP clients do not need the repository transformer's
historical server-only workaround.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/react@alpha @zmdb/next@alpha next@^16.3 react@19 react-dom@19
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/next.ts
import { createZmdbNextClient } from '@zmdb/next/client';
import { createNextServerClient, type NextRequestSources } from '@zmdb/next/server';

import { createApiClient, type ApiClient } from './api.generated.js';

export const browserWidgets = createZmdbNextClient<ApiClient>('Widgets');

export async function serverWidget(request: NextRequestSources, id: string) {
  const scope = await createNextServerClient({
    createClient: createApiClient,
    baseUrl: 'https://api.example.com',
    fetch: globalThis.fetch,
    request,
    forward: { headers: ['authorization'], cookies: ['session'] },
    fetchPolicy: { cache: 'no-store' },
  });
  return scope.client.getWidget({ id });
}
```

Use `@zmdb/next/server` only from server code and `@zmdb/next/client` only from client components.

## Query

Server components call the request-local generated client; client components use the inherited React query hook.

## Mutate

Route/server actions call generated mutations directly. Client components use the inherited React mutation hook.

## Cancellation

Pass framework/request signals to generated operations; React-owned browser work aborts on effect cleanup.

## Errors

Next redirects and framework errors pass through; generated response and validation errors are not wrapped.

## SSR

Each request gets isolated fetch, credentials, memoization, and cache policy. The server entry is absent from browser bundles.

## Testing

Test server scope with request-like headers/cookies and client bindings with a test transport. See [Next deployment](./deploy-nextjs.html) for direct repository/AOT routes.
