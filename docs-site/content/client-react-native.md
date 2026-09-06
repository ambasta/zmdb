Start with the [generated HTTP client](./generated-client.html), then add React Native for AppState, connectivity, and application-selected credential storage. The generated module and `@zmdb/client`
own URL construction, authentication patches, transport, response validation, and stable errors.

## Install

```bash
npm add @zmdb/client@alpha @zmdb/react@alpha @zmdb/react-native@alpha react@19 react-native@">=0.87 <0.88"
```

## Provide

```ts
// docs-file: fixtures/client-adapters/docs/react-native.ts
import { createZmdbReactNative } from '@zmdb/react-native';
import type { NativeAppState, NativeConnectivity, NativeCredentialStore } from '@zmdb/react-native';

import { createApiClient, type ApiClient } from './api.generated.js';

const appState: NativeAppState = {
  currentState: 'active',
  addEventListener: () => ({ remove() {} }),
};
const connectivity: NativeConnectivity = {
  currentState: 'online',
  subscribe: () => () => undefined,
};
const credentials: NativeCredentialStore<string> = {
  read: async () => null,
  write: async () => undefined,
};

export const client = createApiClient({ baseUrl: 'https://api.example.com' });
export const widgets = createZmdbReactNative<ApiClient, string>({
  appState,
  backgroundPolicy: 'abort-and-refresh',
  connectivity,
  credentials,
  offlinePolicy: 'refuse',
});

export function useWidget(id: string) {
  return widgets.useZmdbQuery((api, signal) => api.getWidget({ id }, { signal }), [id]);
}

export function useRenameWidget() {
  return widgets.useZmdbMutation((api, input: { id: string; name: string }, signal) => api.renameWidget(input, { signal }));
}
```

Render `widgets.ZmdbClientProvider` and inject structural ports for AppState, connectivity, and secure credentials.

## Query

Queries use the React binding plus explicit offline and foreground-refresh policy.

## Mutate

Mutations use the same lifecycle coordinator and never persist credentials themselves.

## Cancellation

Unmount and configured background transitions abort owned requests; queued work remains abortable while offline.

## Errors

Generated errors pass through. Native policy adds only `NativeOfflineError` and `NativeBackgroundError`.

## SSR

React Native has no SSR contract. For device builds, follow [Metro and AOT setup](./aot-setup.html) and the [React Native/Expo guide](./connect-react-native.html).

## Testing

Inject fake AppState/connectivity/credential ports. For embedded persistence, use the [SQLite guide](./connect-sqlite.html); it is separate from the HTTP client adapter.
