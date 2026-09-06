# @zmdb/nuxt

`@zmdb/nuxt` binds an application-generated zmdb client to Nuxt 4. It installs separate server and browser plugins, uses a request-local Nitro transport with explicit credential allow-lists, reuses
`@zmdb/vue`, and delegates SSR payload hydration to native `useAsyncData`.

## Install

```bash
npm add @zmdb/nuxt@alpha @zmdb/vue@alpha nuxt@^4.5 vue@^3.5
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+**, is **ESM-only**, and declares Nuxt and Vue as required peers.

## Create the typed integration

Create one application module that exports the generated-client factory and a binding namespace. Passing Nuxt's own `useAsyncData` keeps payload storage, hydration de-duplication, cancellation, and
navigation refreshes inside Nuxt rather than adding another cache.

```ts
import { createZmdbNuxt } from '@zmdb/nuxt/client';
import { useAsyncData } from '#app';

import { createApiClient } from './generated/api.generated.js';
import type { ApiClient } from './generated/api.generated.js';

export { createApiClient };
export const zmdb = createZmdbNuxt<ApiClient>({ useAsyncData });
```

Register the module and name only credentials that may cross from the incoming request:

```ts
export default defineNuxtConfig({
  modules: [
    [
      '@zmdb/nuxt',
      {
        integration: '~/app/zmdb.ts',
        baseUrl: '/api',
        forwardHeaders: ['authorization', 'x-tenant-id'],
        forwardCookies: ['session'],
      },
    ],
  ],
});
```

The module generates separate `.server` and `.client` plugins. The server plugin creates one generated client per Nitro request over Nitro's local fetch and forwards only the selected values. The
client plugin creates a browser-fetch client after hydration. Neither plugin starts a request during installation.

## Native hydration

Use an explicit operation key and serializable input:

```ts
const route = useRoute();
const widget = await zmdb.useZmdbAsyncData(
  'getWidget',
  () => ({ id: String(route.params.id) }),
  (client, input, signal) => client.getWidget(input, { signal }),
);
```

The adapter derives a deterministic key from the operation key and canonical JSON input. A matching Nuxt payload result is reused during hydration, while a new navigation input selects a new key and
uses the browser client. Non-finite numbers, cycles, class instances, functions, symbols, bigints, sparse arrays, arrays with named properties, and `undefined` values are rejected before dispatch.

The inherited `useZmdbClient`, `useZmdbQuery`, and `useZmdbMutation` methods are the real `@zmdb/vue` bindings. Vue effect-scope cancellation, stale-result suppression, and mutation semantics are not
copied into this package.

## Entry points

- `@zmdb/nuxt` — Nuxt module.
- `@zmdb/nuxt/client` — typed bindings, native `useAsyncData`, and browser plugin.
- `@zmdb/nuxt/server` — Nitro request transport and server plugin.

## Documentation

See the [framework integration guide](https://ambasta.github.io/zmdb/docs/framework-integrations.html) and the package contract in `SPEC.md`.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
