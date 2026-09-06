# @zmdb/sveltekit

`@zmdb/sveltekit` creates request-local generated clients from SvelteKit's `event.fetch`, provides typed server and browser load helpers, forwards only allow-listed credentials, and reuses the native
stores from `@zmdb/svelte`.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/svelte@alpha @zmdb/sveltekit@alpha @sveltejs/kit@^2.70.3 svelte@^5.57.0
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+**, SvelteKit 2.70, Svelte 5, and ESM.

## Server loads

Create one generated client for each request. Nothing is forwarded unless its name appears in the explicit allow-list:

```ts
import { createSvelteKitServerLoad } from '@zmdb/sveltekit/server';

import { createApiClient } from '$lib/generated/api.js';
import type { PageServerLoad } from './$types.js';

export const load = createSvelteKitServerLoad({
  key: 'account:current',
  createClient: createApiClient,
  clientOptions: {
    baseUrl: '/api',
    forward: {
      headers: ['authorization'],
      cookies: ['session'],
    },
  },
  load: async (client, _event, signal) => ({
    account: await client.getCurrentAccount({}, { signal }),
  }),
}) satisfies PageServerLoad;
```

The helper uses the current `event.fetch`, calls `depends` with the stable key, and passes `event.request.signal`. Redirects, status errors, abort reasons, and generated-client errors are never
wrapped.

## Browser navigation

The browser entry uses the current universal `LoadEvent.fetch` and re-exports the Svelte context and store primitives:

```ts
import { createSvelteKitClientLoad, createSvelteKitNavigationScope, createZmdbSvelte } from '@zmdb/sveltekit/client';

import { createApiClient } from '$lib/generated/api.js';

export const navigation = createSvelteKitNavigationScope();
export const zmdb = createZmdbSvelte<ReturnType<typeof createApiClient>>();

export const loadAccount = createSvelteKitClientLoad({
  key: 'account:current',
  navigation,
  createClient: createApiClient,
  clientOptions: { baseUrl: '/api' },
  load: async (client, _event, signal) => ({
    account: await client.getCurrentAccount({}, { signal }),
  }),
});
```

Track SvelteKit's native navigation from a mounted root layout:

```svelte
<script lang="ts">
  import { onNavigate } from '$app/navigation';
  import { navigation } from '$lib/zmdb.js';

  onNavigate(value => {
    navigation.track(value);
  });
</script>
```

If SvelteKit rejects `navigation.complete`, active generated-client work aborts with that exact rejection as its signal reason.

## Documentation

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
