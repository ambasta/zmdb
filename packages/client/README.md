# @zmdb/client

`@zmdb/client` is the dependency-free HTTP execution runtime for generated zmdb clients and manually declared operations. It owns transport injection, deterministic URL assembly, bounded response
decoding, cancellation, authentication patches, and stable protocol errors without importing the web framework, reflection, OpenAPI, or Node built-ins.

## Install

```bash
yarn add @zmdb/client@1.0.0-beta.2
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. The runtime uses web-platform APIs and works with either an injected transport or Fetch.

## Entry points

- `@zmdb/client` — generated-operation ABI, runtime, and the body/URL primitives used by generated modules.
- `@zmdb/client/body` — request-body preparation helpers and response limits.
- `@zmdb/client/errors` — stable client error classes.
- `@zmdb/client/headers` — header normalisation and conflict-safe merging.
- `@zmdb/client/transport` — structural transport types and the Fetch adapter.
- `@zmdb/client/url` — RFC 3986 component, path, query, and base-URL helpers.
- `@zmdb/client/testing` — deterministic held-request transport.

The framework bindings below are entry points of this same package.

## Framework bindings

One generated client, one binding per UI runtime. Each binding owns only context and lifetime: it makes a request follow the framework's own mount, effect, scope or owner lifetime, and cancels the
request when that lifetime ends. None of them adds a cache, retry, polling, request encoding, or response handling; those stay application policy and `@zmdb/client` responsibilities.

| Entry point                 | Factory                 | Peers                   | Lifetime it follows                                            | Guide                                                                        |
| --------------------------- | ----------------------- | ----------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@zmdb/client/react`        | `createZmdbReact`       | `react`                 | effect and unmount                                             | [React](https://ambasta.github.io/zmdb/docs/client-react.html)               |
| `@zmdb/client/react-native` | `createZmdbReactNative` | `react`, `react-native` | `AppState`, plus application-supplied connectivity/credentials | [React Native](https://ambasta.github.io/zmdb/docs/client-react-native.html) |
| `@zmdb/client/angular`      | `createZmdbAngular`     | `@angular/core`, `rxjs` | dependency injection, signals, and `DestroyRef`                | [Angular](https://ambasta.github.io/zmdb/docs/client-angular.html)           |
| `@zmdb/client/vue`          | `createZmdbVue`         | `vue`                   | plugin install and effect scope                                | [Vue](https://ambasta.github.io/zmdb/docs/client-vue.html)                   |
| `@zmdb/client/svelte`       | `createZmdbSvelte`      | `svelte`                | context plus store subscription                                | [Svelte](https://ambasta.github.io/zmdb/docs/client-svelte.html)             |
| `@zmdb/client/solid`        | `createZmdbSolid`       | `solid-js`              | owner graph and resources                                      | [Solid](https://ambasta.github.io/zmdb/docs/client-solid.html)               |

Every framework library above is an **optional** peer of this package, because only one entry point needs it. Installing `@zmdb/client` therefore installs no framework; add the peers for the binding
you import:

```bash
yarn add @zmdb/client@1.0.0-beta.2 react@19
```

```ts
import { createZmdbReact } from '@zmdb/client/react';

import type { ApiClient } from './generated/http-client.generated.js';

export const apiReact = createZmdbReact<ApiClient>('AccountApi');
```

Next.js, Nuxt and SvelteKit integrate with a server framework as well as a UI runtime, so they keep their own packages: `@zmdb/next`, `@zmdb/nuxt` and `@zmdb/sveltekit`.

## Generated clients

`zmdb client generate` loads configured `@zmdb/web` contract exports once and writes both OpenAPI JSON and a typed TypeScript client. Commit both outputs and use `zmdb client generate --check` in CI
to reject stale output. OpenAPI is a sibling output, not the input to generation.

The generated module imports only `@zmdb/client`, so the same source can be bundled for a browser or run under Node:

```ts
import { createApiClient } from './generated/http-client.generated.js';

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  authentication: () => ({
    requirement: 0,
    headers: { authorization: 'Bearer token' },
  }),
});
```

The repository's packed-consumer fixture installs only the packed `@zmdb/client` package and exercises the same generated client in browser and Node bundles against a real `@zmdb/web` service,
including alternate success status, response validation, and authentication injection.

## Manual operations

The package can also execute a hand-authored `GeneratedOperation` directly. That path is intentionally low level: the caller supplies the request plan and response reader, and `@zmdb/client` supplies
URL assembly, transport injection, authentication patches, limits, cancellation, and stable errors. It does not inspect controllers, infer types, or parse an OpenAPI document.

## Documentation

The complete generated and manual journey is at **https://ambasta.github.io/zmdb/docs/generated-client.html**.

## License

Mozilla Public License 2.0 (MPL-2.0).
