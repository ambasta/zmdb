# @zmdb/vue

`@zmdb/vue` binds an application-generated zmdb client to Vue 3's native plugin, provide/inject, watcher, and effect-scope lifecycles. It exposes typed query and mutation composables without adding a
cache, retry policy, transport, or second client runtime.

## Install

```bash
npm add @zmdb/vue@alpha vue@^3.5
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+**, is **ESM-only**, and declares Vue as a required peer dependency.

## Create bindings for the generated client

Create one binding namespace for the generated client type, then install a client on each Vue application:

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

Creating bindings or installing the plugin performs no request. `useZmdbClient()` returns the client from the current application and reports a useful error when the plugin is absent.

## Reactive queries

`useZmdbQuery` accepts a Vue ref, computed ref, or getter. It starts in the current component/effect scope, aborts the active request when the input changes, and prevents an older completion from
overwriting the newest state.

```ts
import { ref } from 'vue';

import { zmdb } from './zmdb.js';

const widgetId = ref('one');
const widget = zmdb.useZmdbQuery(
  () => ({ id: widgetId.value }),
  (client, input, signal) => client.getWidget(input, { signal }),
);

widget.data.value;
widget.error.value;
widget.loading.value;
await widget.refresh();
```

`data`, `error`, and `loading` are read-only Vue refs. An input change clears data for the old identity; an explicit refresh retains the last successful value while loading.

## Mutations

```ts
const rename = zmdb.useZmdbMutation((client, input: { id: string; name: string }, signal) => client.renameWidget(input, { signal }));

const updated = await rename.mutate({ id: 'one', name: 'Renamed' });
rename.pending.value;
rename.error.value;
```

Concurrent mutation promises remain independent. Only the newest-started mutation may publish a visible error, and disposing the owning scope aborts every active mutation.

## Scope and SSR ownership

Queries and mutations require an active Vue component setup or `effectScope`. `onScopeDispose` aborts their active controllers and suppresses later state writes. Errors from the generated client,
including `ClientResponseError`, retain object identity.

For SSR, create one Vue application and one generated client per request, then install that client on the request's application. The binding namespace contains only an immutable injection key; it has
no module-level client, credentials, request state, or cache, so concurrent applications remain isolated.

## Documentation

See the [framework integration guide](https://ambasta.github.io/zmdb/docs/framework-integrations.html) and the package contract in `SPEC.md`.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
