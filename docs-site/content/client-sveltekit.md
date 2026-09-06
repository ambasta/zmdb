Start with the [generated HTTP client](./generated-client.html), then add SvelteKit for request-local `event.fetch`, explicit credential forwarding, hydration keys, and abandoned-navigation
cancellation. The generated module and `@zmdb/client` own URL construction, authentication patches, transport, response validation, and stable errors.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/svelte@alpha @zmdb/sveltekit@alpha @sveltejs/kit@^2.70 svelte@^5
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/sveltekit.ts
import { createSvelteKitClientLoad, createSvelteKitNavigationScope } from '@zmdb/sveltekit/client';
import { createSvelteKitServerLoad } from '@zmdb/sveltekit/server';

import { createApiClient } from './api.generated.js';

export const navigation = createSvelteKitNavigationScope();
export const browserWidget = createSvelteKitClientLoad({
  key: 'widgets:get',
  navigation,
  createClient: createApiClient,
  clientOptions: { baseUrl: '/api' },
  load: (client, _event, signal) => client.getWidget({ id: 'browser' }, { signal }),
});

export const serverWidget = createSvelteKitServerLoad({
  key: 'widgets:get',
  createClient: createApiClient,
  clientOptions: {
    baseUrl: '/api',
    forward: { headers: ['authorization'], cookies: ['session'] },
  },
  load: (client, _event, signal) => client.getWidget({ id: 'server' }, { signal }),
});
```

Keep server and client imports in their corresponding load modules.

## Query

Server and browser load helpers use the same namespaced key and generated client contract.

## Mutate

Use generated mutations in actions/endpoints or the inherited Svelte mutation store in components.

## Cancellation

Server request signals and failed/abandoned browser navigation abort the exact generated operation.

## Errors

Framework redirects/errors and generated response/validation errors pass through unchanged.

## SSR

Server loads use request-local `event.fetch` and allow-listed credentials. The server entry is absent from browser bundles.

## Testing

Test server and browser load definitions with structural event objects, then reject navigation completion to assert abort.
