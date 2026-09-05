The generated matrix below reports support in the current release. It does not turn a frozen design or open implementation issue into shipped code.

`optional` means a dedicated package ships separately from the default `zmdb` install. `documented` means a repository-backed recipe exists over current public packages. `not-planned` means this
release has no official framework adapter; use the generated HTTP client through the framework's ordinary request and lifecycle primitives.

<!-- generated: integrations framework-integrations -->

| Framework    | Status      | Public package      | Framework peer | Documentation                                           | Repository evidence                                                                             |
| ------------ | ----------- | ------------------- | -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Angular      | not-planned | —                   | —              | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| Next.js      | documented  | @zmdb/repository    | —              | [deploy-nextjs](./deploy-nextjs.html)                   | `packages/repository/src/repository.spec.ts`<br>`packages/zmdb/src/client-integrations/SPEC.md` |
| Nuxt         | not-planned | —                   | —              | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| React        | optional    | @zmdb/react         | react          | [framework-integrations](./framework-integrations.html) | `packages/react/src/react.spec.ts`<br>`fixtures/client-adapters`                                |
| React Native | documented  | @zmdb/aot-validator | —              | [connect-react-native](./connect-react-native.html)     | `packages/aot-validator/src/plugin/metro.spec.ts`<br>`fixtures/consumer-metro`                  |
| Solid        | not-planned | —                   | —              | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| Svelte       | not-planned | —                   | —              | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| SvelteKit    | not-planned | —                   | —              | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| Vue          | not-planned | —                   | —              | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |

<!-- /generated: integrations framework-integrations -->

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

React Native and Next.js remain documented recipes because their dedicated adapter packages have not landed.
