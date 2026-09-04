# @zmdb/svelte

`@zmdb/svelte` binds an application-generated zmdb client to Svelte's typed component context and projects query and mutation state through native stores. Queries start on their first subscription,
abort after the final unsubscribe, restart on a later subscription, and suppress completions from superseded inputs.

## Install

```bash
npm add @zmdb/svelte@alpha svelte@^5.57.0
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+**, Svelte 5, and ESM. Svelte is a required peer and is never bundled into the adapter.

## Typed context

Create one binding namespace for the generated client type:

```ts
// src/lib/zmdb.ts
import { createZmdbSvelte } from '@zmdb/svelte';

import type { ApiClient } from './generated/api.js';

export const zmdb = createZmdbSvelte<ApiClient>();
```

Set the request- or tree-local client during provider component initialisation:

```svelte
<script lang="ts">
  import { zmdb } from '$lib/zmdb.js';
  import type { ApiClient } from '$lib/generated/api.js';

  let { client, children }: { client: ApiClient; children: import('svelte').Snippet } = $props();
  zmdb.setClient(client);
</script>

{@render children()}
```

Descendants retain every generated operation without a cast:

```svelte
<script lang="ts">
  import { writable } from 'svelte/store';

  import { zmdb } from '$lib/zmdb.js';

  let { id }: { id: string } = $props();
  const input = writable({ id });
  const widget = zmdb.query(input, (client, value, signal) => client.getWidget(value, { signal }));
  const rename = zmdb.mutation((client, value: { id: string; name: string }, signal) =>
    client.renameWidget(value, { signal }),
  );
</script>

{#if $widget.loading}
  <p>Loading…</p>
{:else if $widget.error}
  <p>Could not load the widget.</p>
{:else if $widget.data}
  <h1>{$widget.data.name}</h1>
{/if}

<button onclick={() => rename.mutate({ id, name: 'Renamed' })} disabled={$rename.pending}>Rename</button>
```

An input store change clears data for the old identity, aborts that request, and starts the new one while subscribed. A generated-client error is placed in store state by identity; it is not wrapped
or translated.

## Direct store ownership

`createQueryStore(client, input, load)` and `createMutationStore(client, run)` expose the same stores without component context. Query stores remain lazy. The last subscriber cancels active work; call
`destroy()` as well when a non-component owner has a shorter lifetime than its subscriptions.

## Documentation

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
