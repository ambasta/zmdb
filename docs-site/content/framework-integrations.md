The generated matrix below reports support in the current release. It does not turn a frozen design or open implementation issue into shipped code.

`optional` means an official package is installed only by applications using that framework. `documented` means a repository-backed recipe exists over current public packages. `not-planned` means this
release has no official framework adapter; use the generated HTTP client through the framework's ordinary request and lifecycle primitives.

<!-- generated: integrations framework-integrations -->

| Framework    | Status      | Public package      | Framework peers            | Documentation                                           | Repository evidence                                                                                                                                                      |
| ------------ | ----------- | ------------------- | -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Angular      | optional    | @zmdb/angular       | @angular/core<br>rxjs      | [framework-integrations](./framework-integrations.html) | `packages/angular/src/index.spec.ts`<br>`packages/angular/src/index.type-test.ts`<br>`fixtures/client-adapters/angular`                                                  |
| Next.js      | optional    | @zmdb/next          | next<br>react<br>react-dom | [framework-integrations](./framework-integrations.html) | `packages/next/src/client.spec.ts`<br>`packages/next/src/server.spec.ts`<br>`fixtures/next-app-router`                                                                   |
| Nuxt         | optional    | @zmdb/nuxt          | nuxt<br>vue                | [framework-integrations](./framework-integrations.html) | `packages/nuxt/src/client/client.spec.ts`<br>`packages/nuxt/src/server/server.spec.ts`<br>`packages/nuxt/src/packed-consumer.spec.ts`<br>`fixtures/client-adapters/nuxt` |
| React        | optional    | @zmdb/react         | react                      | [framework-integrations](./framework-integrations.html) | `packages/react/src/react.spec.ts`<br>`fixtures/client-adapters`                                                                                                         |
| React Native | documented  | @zmdb/aot-validator | —                          | [connect-react-native](./connect-react-native.html)     | `packages/aot-validator/src/plugin/metro.spec.ts`<br>`fixtures/consumer-metro`                                                                                           |
| Solid        | optional    | @zmdb/solid         | solid-js                   | [framework-integrations](./framework-integrations.html) | `packages/solid/SPEC.md`<br>`packages/solid/src/solid.spec.ts`<br>`packages/solid/src/packed-consumer.spec.ts`<br>`fixtures/client-adapters/src/solid-binding.ts`        |
| Svelte       | optional    | @zmdb/svelte        | svelte                     | [framework-integrations](./framework-integrations.html) | `packages/svelte/SPEC.md`<br>`packages/svelte/src/svelte.spec.ts`<br>`fixtures/client-adapters/svelte-packed`                                                            |
| SvelteKit    | not-planned | —                   | —                          | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                                                                                          |
| Vue          | optional    | @zmdb/vue           | vue                        | [framework-integrations](./framework-integrations.html) | `packages/vue/src/index.spec.ts`<br>`packages/vue/src/index.type-test.ts`<br>`fixtures/client-adapters/vue`                                                              |

<!-- /generated: integrations framework-integrations -->

## Angular

Install the generated-client runtime, Angular adapter, and its required framework peers:

```bash
npm add @zmdb/client@alpha @zmdb/angular@alpha @angular/core@">=22.1.0 <23.0.0" rxjs@">=7.4.0 <8.0.0"
```

Create one typed binding namespace for the application's generated client:

```ts
import { createZmdbAngular } from '@zmdb/angular';
import type { ApiClient } from './generated/api.js';

export const apiAngular = createZmdbAngular<ApiClient>('AccountApi');
```

`apiAngular.provideZmdbClient(client)` follows Angular injector hierarchy; `apiAngular.zmdbQuery` and `apiAngular.zmdbMutation` expose signal state and abort through the owning `DestroyRef`; and
`apiAngular.zmdbObservable` aborts its exact request when the subscription ends. SSR applications create one environment injector and generated client per request. The package does not import
`@angular/common/http` or require `HttpClient`.

## React

Install the generated-client binding with its required React peer:

```bash
npm add @zmdb/react@alpha react@19
```

Create one binding for the generated client type, then provide a client instance to the matching tree:

```ts
import { createZmdbReact } from '@zmdb/react';
import type { ApiClient } from './generated/http-client.generated.js';

export const apiReact = createZmdbReact<ApiClient>('AccountApi');
```

```ts
const account = apiReact.useZmdbQuery((client, signal) => client.getAccount({ id: accountId }, { signal }), [accountId]);

const rename = apiReact.useZmdbMutation((client, input: { id: string; name: string }, signal) => client.renameAccount(input, { signal }));
```

Queries begin after effect activation, abort on dependency changes and unmount, and suppress stale completion even when a transport ignores cancellation. Mutations remain independent and abort on
unmount. The package adds no shared cache, implicit retry, polling, focus refetch, or server-render request; those policies stay explicit in the application.

SvelteKit remains pending. React Native remains documented because its current recipe uses shipped package boundaries without claiming the future adapter.

## Vue

Install the official Vue 3 integration beside its required framework peer:

```bash
npm add @zmdb/vue@alpha vue@^3.5
```

Create a binding namespace for the generated client type, then install one client on each application:

```ts
import { createZmdbVue } from '@zmdb/vue';
import { createApp } from 'vue';

import App from './App.js';
import { createApiClient } from './generated/api.generated.js';
import type { ApiClient } from './generated/api.generated.js';

export const zmdb = createZmdbVue<ApiClient>();

const client = createApiClient({ baseUrl: '/api' });
createApp(App).use(zmdb.createZmdbPlugin(client)).mount('#app');
```

Inside component setup, pass a ref, computed ref, or getter to `useZmdbQuery`:

```ts
import { ref } from 'vue';

import { zmdb } from './zmdb.js';

const widgetId = ref('one');
const widget = zmdb.useZmdbQuery(
  () => ({ id: widgetId.value }),
  (client, input, signal) => client.getWidget(input, { signal }),
);

const rename = zmdb.useZmdbMutation((client, input: { id: string; name: string }, signal) => client.renameWidget(input, { signal }));
```

The query exposes read-only `data`, `error`, and `loading` refs plus `refresh()`. The mutation exposes read-only `error` and `pending` refs plus `mutate(input)`. Watcher changes abort the old query
and generation guards suppress stale completion. Vue `onScopeDispose` aborts active queries and mutations. Generated-client errors are published without wrapping or changing object identity.

Creating bindings or installing the plugin performs no request. For SSR, create one generated client and one `createSSRApp` per request and install that request's client on its application. The
binding namespace retains only an injection key, so concurrent applications do not share clients, credentials, query state, or mutation state.

## Nuxt

Install the Nuxt 4 integration beside its Vue base adapter and required framework peers:

```bash
npm add @zmdb/nuxt@alpha @zmdb/vue@alpha nuxt@^4.5 vue@^3.5
```

Create one application integration module that exports the generated-client factory and typed Nuxt bindings:

```ts
import { createZmdbNuxt } from '@zmdb/nuxt/client';
import { useAsyncData } from '#app';

import { createApiClient } from './generated/api.generated.js';
import type { ApiClient } from './generated/api.generated.js';

export { createApiClient };
export const zmdb = createZmdbNuxt<ApiClient>({ useAsyncData });
```

Register the module with the integration path, API base URL, and only the incoming credentials the server may forward:

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

The module generates separate server and browser plugins. Each SSR plugin invocation creates a request-local generated client over Nitro local fetch, snapshots only allow-listed header and cookie
values, and installs that client on the request's Vue application. The browser plugin constructs a browser-fetch client for navigation. Empty allow-lists forward no incoming credentials.

`zmdb.useZmdbAsyncData(operationKey, input, load)` derives a stable key from the explicit operation name and serializable input, then delegates payload storage, de-duplication, abort signals,
hydration, and navigation behavior to Nuxt's native `useAsyncData`. A matching server payload is consumed without dispatching the browser handler. The inherited client, query, and mutation composables
are the real `@zmdb/vue` bindings rather than a copied state implementation.

## Svelte 5

Install the native adapter beside its required framework peer:

```bash
npm add @zmdb/svelte@alpha svelte@^5.57.0
```

Create one typed context namespace for the generated client:

```ts
import { createZmdbSvelte } from '@zmdb/svelte';

import type { ApiClient } from './generated/api.js';

export const zmdb = createZmdbSvelte<ApiClient>();
```

Set a tree- or request-local client during provider component initialisation. Descendants call `zmdb.query(input, load)` and `zmdb.mutation(run)`. Query stores make no request until their first
subscription, abort after their final unsubscribe, restart for a later subscriber, and suppress stale completions after an input-store change. Context-owned stores also register component destruction
cleanup. Direct `createQueryStore(...)` and `createMutationStore(...)` exports support owners outside component context and the later SvelteKit integration.

## Next.js

Install the App Router adapter with its required framework peers:

```bash
npm add @zmdb/next@alpha next@16 react@19 react-dom@19
```

Create a request-owned generated client in a server component or route handler. Only explicitly selected incoming credentials are forwarded:

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
```

`request.memoize(load, key)` de-duplicates duplicate RSC work only inside that request scope. Another request receives another client and memo table. Use `fetchPolicy.cache` or
`fetchPolicy.next = { revalidate, tags }` to pass an explicit Next cache policy through unchanged.

Client components import only the browser entry, which is the existing React binding:

```ts
'use client';

import { createZmdbNextClient } from '@zmdb/next/client';
import type { ApiClient } from './generated/http-client.generated.js';

export const apiNext = createZmdbNextClient<ApiClient>('AccountApi');
```

The package has no mixed root export. `@zmdb/next/server` carries the real `server-only` boundary, while `@zmdb/next/client` cannot reach Next request APIs or server credentials.

React Native remains a documented recipe because its dedicated client adapter has not landed.

## Solid

Install the generated-client binding with its required Solid peer:

```bash
npm add @zmdb/solid@alpha solid-js@1
```

Create one binding for the generated client type and provide a client to each application or server owner:

```ts
import { createZmdbSolid } from '@zmdb/solid';
import { createSignal } from 'solid-js';

import type { ApiClient } from './generated/http-client.generated.js';

export const apiSolid = createZmdbSolid<ApiClient>();

function Account() {
  const [accountId] = createSignal('current');
  const account = apiSolid.query(
    () => ({ id: accountId() }),
    (client, input, signal) => client.getAccount(input, { signal }),
  );

  return account.data()?.name;
}
```

Render `Account` beneath `<apiSolid.Provider client={client}>`. The returned `data` is a native Solid resource, so reads retain native Suspense and error-boundary behaviour. Source changes abort the
older request and suppress stale completion; owner disposal aborts the active query and every active mutation. The package adds no shared cache, implicit retry, polling, or module-level client.
