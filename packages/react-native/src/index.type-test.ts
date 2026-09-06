import type { ZmdbReactBindings } from '@zmdb/react';
import { AppState } from 'react-native';

import {
  createZmdbReactNative,
  type NativeAppState,
  type NativeConnectivity,
  type NativeCredentialStore,
  type ZmdbReactNativeBindings,
} from './index.js';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface GeneratedClient {
  getWidget(input: { readonly id: string }, options: { readonly signal: AbortSignal }): Promise<Widget>;
  renameWidget(
    input: { readonly id: string; readonly name: string },
    options: { readonly signal: AbortSignal },
  ): Promise<Widget>;
}

const connectivity: NativeConnectivity = {
  currentState: 'online',
  subscribe: () => () => undefined,
};

const credentials: NativeCredentialStore<string> = {
  read: () => Promise.resolve('token'),
  write: () => Promise.resolve(),
};

AppState satisfies NativeAppState;

const bindings = createZmdbReactNative<GeneratedClient, string>({
  appState: AppState,
  backgroundPolicy: 'abort-and-refresh',
  connectivity,
  credentials,
  offlinePolicy: 'refuse',
  bindingName: 'WidgetsNative',
});

function inference(native: ZmdbReactNativeBindings<GeneratedClient, string>): void {
  native satisfies ZmdbReactBindings<GeneratedClient>;

  const client = native.useZmdbClient();
  client.getWidget satisfies GeneratedClient['getWidget'];

  const query = native.useZmdbQuery((api, signal) => api.getWidget({ id: 'one' }, { signal }), ['one']);
  query.data satisfies Widget | undefined;
  query.refresh satisfies () => Promise<void>;

  const mutation = native.useZmdbMutation((api, input: { readonly id: string; readonly name: string }, signal) =>
    api.renameWidget(input, { signal }),
  );
  mutation.mutate satisfies (input: { readonly id: string; readonly name: string }) => Promise<Widget>;
  native.useCredentialStore() satisfies NativeCredentialStore<string>;
  native.useConnectivity() satisfies NativeConnectivity;

  // @ts-expect-error generated mutation input still requires a name
  void mutation.mutate({ id: 'one' });
}

createZmdbReactNative({
  appState: AppState,
  backgroundPolicy: 'abort',
  connectivity,
  credentials,
  // @ts-expect-error the offline policy is explicit and closed
  offlinePolicy: 'retry',
});

// @ts-expect-error credential storage is a required application-owned port
createZmdbReactNative({ appState: AppState, backgroundPolicy: 'abort', connectivity, offlinePolicy: 'refuse' });

bindings satisfies ZmdbReactNativeBindings<GeneratedClient, string>;
void inference;
