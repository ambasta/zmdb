import { createZmdbReactNative } from '@zmdb/react-native';

import type { AdapterConformanceBinding } from './conformance.js';
import { createReactFamilyConformanceBinding } from './react-binding.js';

export function createReactNativeConformanceBinding<Client extends object>(): AdapterConformanceBinding<Client> {
  return createReactFamilyConformanceBinding('@zmdb/react-native', bindingName =>
    createZmdbReactNative<Client, string>({
      appState: {
        currentState: 'active',
        addEventListener: () => ({ remove() {} }),
      },
      backgroundPolicy: 'abort',
      connectivity: {
        currentState: 'online',
        subscribe: () => () => undefined,
      },
      credentials: {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
      },
      offlinePolicy: 'refuse',
      bindingName,
    }),
  );
}
