import { createZmdbNextClient } from '@zmdb/next/client';

import type { AdapterConformanceBinding } from './conformance.js';
import { ADAPTER_PACKAGES } from './package-matrix.js';
import { createReactLifecycleConformanceBinding } from './react-binding.js';

function nextExpectation() {
  const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === '@zmdb/next');
  if (expectation === undefined) throw new Error('the adapter matrix omitted @zmdb/next');
  return expectation;
}

export function createNextConformanceBinding<Client extends object>(): AdapterConformanceBinding<Client> {
  return createReactLifecycleConformanceBinding(nextExpectation(), createZmdbNextClient<Client>);
}
