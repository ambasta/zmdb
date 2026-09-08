import assert from 'node:assert/strict';

import { createZmdbReactNative, type NativeAppState } from '@zmdb/react-native';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const appState: NativeAppState = {
  currentState: 'active',
  addEventListener: () => ({ remove() {} }),
};
const bindings = createZmdbReactNative<{ readonly value: string }>({
  appState,
  backgroundPolicy: 'abort',
  connectivity: { currentState: 'online', subscribe: () => () => {} },
  offlinePolicy: 'refuse',
  credentials: { read: () => Promise.resolve('credential'), write: () => Promise.resolve() },
});
function Child() {
  return createElement('span', null, bindings.useZmdbClient().value);
}
assert.equal(
  renderToStaticMarkup(
    createElement(bindings.ZmdbClientProvider, { client: { value: 'native-π' } }, createElement(Child)),
  ),
  '<span>native-π</span>',
);
