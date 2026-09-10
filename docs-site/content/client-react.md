Start with the [generated HTTP client](./generated-client.html), then add React only for context, effect ownership, and component-lifecycle cancellation. The generated module and `@zmdb/client` own
URL construction, authentication patches, transport, response validation, and stable errors; `@zmdb/client/react` does not duplicate them.

## Install

```bash
yarn add @zmdb/client@1.0.0-beta.2 @zmdb/client/react@1.0.0-beta.2 react@19
```

## Provide

Create one typed binding namespace and provide `client` at the application or request boundary:

```ts {"mode":"illustrative","id":"example-001","reason":"The application supplies the local modules ./api.generated.js; this fence is an excerpt of that project."}
// docs-file: fixtures/client-adapters/docs/react.ts
import { createZmdbReact } from '@zmdb/client/react';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbReact<ApiClient>('Widgets');

export function useWidget(id: string) {
  return widgets.useZmdbQuery((api, signal) => api.getWidget({ id }, { signal }), [id]);
}

export function useRenameWidget() {
  return widgets.useZmdbMutation((api, input: { id: string; name: string }, signal) => api.renameWidget(input, { signal }));
}
```

Render `widgets.ZmdbClientProvider` with the request-local `client`.

## Query

`useZmdbQuery` starts after effect activation and reruns when its dependency list changes.

## Mutate

`useZmdbMutation` gives each invocation independent pending and error state.

## Cancellation

Dependency changes, unmount, and StrictMode replay abort the exact owned request and suppress stale completion.

## Errors

Generated `ClientResponseError` and validation failures pass through unchanged.

## SSR

Create one client and provider tree per request. The binding namespace contains no client or credential singleton.

## Testing

Provide a generated client backed by a test transport and unmount the tree to assert cancellation.
