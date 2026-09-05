# @zmdb/react

`@zmdb/react` binds an application-generated zmdb client to one React tree. It provides a typed client context plus query and mutation hooks whose requests follow React effect and unmount lifetimes.
The package adds no cache, retry, polling, request encoding, or response handling; those remain application policy and `@zmdb/client` responsibilities.

## Install

```bash
npm add @zmdb/react@alpha react@19
```

React is a required peer. TypeScript applications also need React's matching declaration package.

## Create one typed binding

```ts
import { createZmdbReact } from '@zmdb/react';
import type { ApiClient } from './generated/http-client.generated.js';

export const apiReact = createZmdbReact<ApiClient>('AccountApi');
```

Render the generated client at the application boundary:

```ts
import { createElement } from 'react';
import { apiReact } from './api-react.js';
import { api } from './api.js';

createElement(apiReact.ZmdbClientProvider, { client: api }, createElement(App));
```

Each factory call owns a separate context. A hook outside its matching provider throws an error naming the binding instead of reading a global fallback client.

## Query

```ts
const user = apiReact.useZmdbQuery((client, signal) => client.getUser({ id: userId }, { signal }), [userId]);
```

The query starts after React commits the effect. A dependency change clears data for the old identity, aborts its request, and generation-guards late completion. `refresh()` retains the last
successful data while the replacement request is loading. Server rendering runs no effect and therefore starts no request.

## Mutation

```ts
const rename = apiReact.useZmdbMutation((client, input: { id: string; name: string }, signal) => client.renameUser(input, { signal }));

await rename.mutate({ id: userId, name });
```

Concurrent mutation promises remain independent. The visible error belongs only to the newest-started mutation, `pending` remains true until every in-flight call settles, and unmount aborts every
active controller without writing state afterwards.

## Lifecycle policy

- StrictMode setup/cleanup replay aborts the replayed request before the replacement remains live.
- Client errors are stored and rethrown by identity; the hooks do not wrap or normalize them.
- There is no shared cache, implicit retry, focus refetch, polling, or mutation replay.
- `dependencies` follows the same stable-length and exhaustive-value rules as React's built-in dependency lists.

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
