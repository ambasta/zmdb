Start with the [generated HTTP client](./generated-client.html), then add Svelte for typed context, lazy stores, and subscriber/component teardown. The generated module and `@zmdb/client` own URL
construction, authentication patches, transport, response validation, and stable errors.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/svelte@alpha svelte@^5
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/svelte.ts
import { createZmdbSvelte } from '@zmdb/svelte';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbSvelte<ApiClient>();

export function provideWidgets(): ApiClient {
  return widgets.setClient(client);
}

export function widgetQuery(id: string) {
  return widgets.query({ id }, (api, input, signal) => api.getWidget(input, { signal }));
}

export function renameWidget() {
  return widgets.mutation((api, input: { id: string; name: string }, signal) => api.renameWidget(input, { signal }));
}
```

Call `provideWidgets` during provider component initialisation.

## Query

The query store is lazy: its first subscriber starts work and later input-store changes restart it.

## Mutate

The mutation store exposes explicit `mutate`, pending, data, and error state.

## Cancellation

The final unsubscribe and component destruction abort owned work and block stale completion.

## Errors

Generated errors remain unchanged in the store snapshot.

## SSR

Set a request-local client in each rendered component tree; context does not cross requests.

## Testing

Use direct query/mutation-store constructors outside component context and unsubscribe to verify cancellation.
