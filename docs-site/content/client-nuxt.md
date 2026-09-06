Start with the [generated HTTP client](./generated-client.html), then add Nuxt for Nitro request transport, plugin injection, native `useAsyncData` hydration, and browser navigation. The generated
module and `@zmdb/client` own URL construction, authentication patches, transport, response validation, and stable errors.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/vue@alpha @zmdb/nuxt@alpha nuxt@^4.5 vue@^3.5
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/nuxt.ts
import { createZmdbNuxt } from '@zmdb/nuxt/client';
import { createZmdbNuxtServerPlugin } from '@zmdb/nuxt/server';
import { useAsyncData } from 'nuxt/app';

import { createApiClient, type ApiClient } from './api.generated.js';

export const widgets = createZmdbNuxt<ApiClient>({ useAsyncData });
export const serverPlugin = createZmdbNuxtServerPlugin(widgets, createApiClient, {
  baseUrl: '/api',
  fetch: globalThis.fetch,
  forwardHeaders: ['authorization'],
  forwardCookies: ['session'],
});

export function useWidget(id: string) {
  return widgets.useZmdbAsyncData('get_widget', { id }, (api, input, signal) => api.getWidget(input, { signal }));
}
```

Register the official module or generated server/browser plugins at the Nuxt application boundary.

## Query

`useZmdbAsyncData` derives a stable key from operation and serializable input and delegates hydration to Nuxt.

## Mutate

Use the inherited Vue mutation binding in components or call the request-local client from server handlers.

## Cancellation

Nuxt cancellation signals flow into generated operations; Vue scopes own browser cleanup.

## Errors

Nuxt errors, redirects, and generated client errors retain their native identity.

## SSR

Each Nitro request receives an isolated local-fetch client and only allow-listed credentials. Hydration reuses its payload.

## Testing

Test the server plugin with request-local event mocks and the client binding with native `useAsyncData` behavior.
