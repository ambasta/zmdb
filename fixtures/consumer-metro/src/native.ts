import { createZmdbReactNative } from '@zmdb/react-native';
import { AppState } from 'react-native';

export const nativeBindings = createZmdbReactNative<object, string>({
  appState: AppState,
  backgroundPolicy: 'abort-and-refresh',
  connectivity: {
    currentState: 'online',
    subscribe: () => () => undefined,
  },
  credentials: {
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  },
  offlinePolicy: 'refuse',
});

globalThis.__ZMDB_REACT_NATIVE_BINDING__ = typeof nativeBindings.useZmdbQuery === 'function';
