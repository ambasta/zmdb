Start with the [generated HTTP client](./generated-client.html), then add Vue for application injection, reactive state, watcher cancellation, and scope disposal. The generated module and
`@zmdb/client` own URL construction, authentication patches, transport, response validation, and stable errors.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/vue@alpha vue@^3.5
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/vue.ts
import { createZmdbVue } from '@zmdb/vue';

import { createApiClient, type ApiClient } from './api.generated.js';

export const client = createApiClient({ baseUrl: '/api' });
export const widgets = createZmdbVue<ApiClient>('Widgets');
export const plugin = widgets.createZmdbPlugin(client);

export function useWidget(id: string) {
  return widgets.useZmdbQuery({ id }, (api, input, signal) => api.getWidget(input, { signal }));
}

export function useRenameWidget() {
  return widgets.useZmdbMutation((api, input: { id: string; name: string }, signal) => api.renameWidget(input, { signal }));
}
```

Install `plugin` on the owning Vue application.

## Query

`useZmdbQuery` accepts a value, ref, computed ref, or getter and exposes read-only reactive state.

## Mutate

`useZmdbMutation` exposes typed mutation state without adding cache or retry policy.

## Cancellation

Watcher changes and `onScopeDispose` abort owned requests and suppress stale completion.

## Errors

Generated response and validation errors pass through without wrapping.

## SSR

Create one generated client and `createSSRApp` per request. Each application injection boundary is isolated.

## Testing

Install the plugin on a test application and dispose its effect scope to assert abort behavior.
