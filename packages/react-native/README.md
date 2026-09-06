# @zmdb/react-native

`@zmdb/react-native` adds explicit AppState and connectivity policy around the `@zmdb/react` generated-client hooks. It supplies no NetInfo, AsyncStorage, SecureStore, Keychain, retry engine, cache,
or credential implementation.

## Install

```bash
npm add @zmdb/react-native@alpha @zmdb/react@alpha react@19 react-native@0.87
```

## Bind the native services

React Native's `AppState` can be passed directly. Adapt the application's chosen connectivity and credential services to the two small structural ports:

```ts
import { AppState } from 'react-native';
import { createZmdbReactNative } from '@zmdb/react-native';
import type { ApiClient } from './generated/http-client.generated.js';
import { connectivity } from './native-connectivity.js';
import { credentials } from './native-credentials.js';

export const apiNative = createZmdbReactNative<ApiClient, string>({
  appState: AppState,
  connectivity,
  credentials,
  backgroundPolicy: 'abort-and-refresh',
  offlinePolicy: 'refuse',
  bindingName: 'AccountApi',
});
```

Render the same generated client used by the web application:

```ts
import { createElement } from 'react';

createElement(apiNative.ZmdbClientProvider, { client: api }, createElement(App));
```

The query and mutation signatures remain the `@zmdb/react` signatures:

```ts
const account = apiNative.useZmdbQuery((client, signal) => client.getAccount({ id: accountId }, { signal }), [accountId]);
```

## Policies

- `backgroundPolicy: 'continue'` leaves requests alone.
- `backgroundPolicy: 'abort'` aborts active queries and mutations without replay.
- `backgroundPolicy: 'abort-and-refresh'` also refreshes mounted queries once after foregrounding; mutations are never replayed.
- `offlinePolicy: 'refuse'` throws `NativeOfflineError` before dispatch.
- `offlinePolicy: 'queue'` waits for the injected connectivity port and dispatches once.

`useCredentialStore()` returns the exact injected credential port. The package does not select or bundle a storage implementation.

## Metro

This package owns device lifecycle only. Continue to configure the ahead-of-time transform through `@zmdb/aot-validator/metro`; there is deliberately no `@zmdb/react-native/metro` export.

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
