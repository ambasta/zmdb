# @zmdb/solid

`@zmdb/solid` binds an application-generated zmdb client to Solid context, resources and owner disposal. It keeps request encoding, validation and errors in the generated client while making
cancellation and reactive source changes follow Solid's owner graph.

## Install

```bash
yarn add @zmdb/client @zmdb/solid solid-js
```

> **Prerelease** (`1.0.0-alpha.4`, configured for the `alpha` dist-tag). Requires **Node.js 26+**, is **ESM-only**, and supports Solid `>=1.9.0 <2.0.0`.

## Usage

```ts
import { createZmdbSolid } from '@zmdb/solid';
import { createSignal } from 'solid-js';

import type { ApiClient } from './generated/api.js';

const zmdb = createZmdbSolid<ApiClient>();
const [id] = createSignal('one');

function Widget() {
  const widget = zmdb.query(
    () => ({ id: id() }),
    (client, input, signal) => client.getWidget(input, { signal }),
  );

  return widget.data()?.name;
}
```

Install `zmdb.Provider` above consumers with one generated client per application or SSR owner. Reading `query.data()` uses Solid's native resource semantics, including Suspense and error-boundary
propagation. `query.latest()` exposes the last successful value without reading through a resource error.

## Public API

- `createZmdbSolid`
- `SolidQuery`, `SolidMutation`, `ZmdbSolidBindings`
- `QueryLoader`, `MutationRunner`, `SolidQuerySource`

The package has no shared cache, retry loop, request de-duplication or module-level client.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
