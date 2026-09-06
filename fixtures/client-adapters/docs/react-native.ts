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
  return widgets.useZmdbMutation((api, input: { id: string; name: string }, signal) =>
    api.renameWidget(input, { signal }),
  );
}
