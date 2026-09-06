Start with the [generated HTTP client](./generated-client.html), then add Solid for context, resources, owner disposal, Suspense, and error-boundary propagation. The generated module and
`@zmdb/client` own URL construction, authentication patches, transport, response validation, and stable errors.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/solid@alpha solid-js@^1.9
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/solid.ts
import { createZmdbSolid } from '@zmdb/solid';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbSolid<ApiClient>();

export function widgetQuery(id: string) {
  return widgets.query({ id }, (api, input, signal) => api.getWidget(input, { signal }));
}

export function renameWidget() {
  return widgets.mutation((api, input: { id: string; name: string }, signal) => api.renameWidget(input, { signal }));
}
```

Render `widgets.ZmdbClientProvider` inside the owning Solid root.

## Query

`query` uses native resources, so loading and errors participate in Solid Suspense and error boundaries.

## Mutate

`mutation` provides explicit state and a typed runner without hidden caching.

## Cancellation

Owner disposal and input changes abort the exact request and suppress stale completion.

## Errors

Generated response and validation errors propagate as their original objects.

## SSR

Create a client and owner tree per request; do not reuse a credential-bearing root.

## Testing

Create a disposable Solid root around a test-transport client and dispose it to assert cancellation.
