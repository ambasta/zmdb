import { deepStrictEqual } from 'node:assert/strict';

import type { AdapterConformanceBinding } from './conformance.js';
import {
  createControllableAdapterTransport,
  type ControllableAdapterTransport,
  type HeldAdapterRequest,
} from './controllable-transport.js';
import { createApiClient, type ApiClient, type Widget } from './generated/api.generated.js';

async function requestsOrFailure(
  transport: ControllableAdapterTransport,
  operations: readonly Promise<unknown>[],
): Promise<readonly [HeldAdapterRequest, HeldAdapterRequest]> {
  const requests = Promise.all([transport.nextRequest(), transport.nextRequest()]);
  const failure = Promise.race(
    operations.map(operation =>
      operation.then(
        () => new Promise<never>(() => undefined),
        error => Promise.reject(error),
      ),
    ),
  );
  return Promise.race([requests, failure]);
}

function client(transport: ControllableAdapterTransport, credential: string): ApiClient {
  return createApiClient({
    baseUrl: '/api',
    transport: transport.transport,
    authentication: () => ({
      requirement: 0,
      headers: { authorization: `Bearer ${credential}` },
    }),
  });
}

function fixtureResponse(request: HeldAdapterRequest): Widget {
  if (request.request.url.endsWith('/first')) return { id: 'first', name: 'First' };
  if (request.request.url.endsWith('/second')) return { id: 'second', name: 'Second' };
  throw new Error(`unexpected SSR fixture request ${request.request.url}`);
}

export async function assertSsrCredentialIsolation(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const transport = createControllableAdapterTransport();
  const firstResult = binding.runSsrQuery({
    client: client(transport, 'first-credential'),
    input: { id: 'first' },
    load: (api, input, signal) => api.getPrivateWidget(input, { signal }),
  });
  const secondResult = binding.runSsrQuery({
    client: client(transport, 'second-credential'),
    input: { id: 'second' },
    load: (api, input, signal) => api.getPrivateWidget(input, { signal }),
  });
  const operations = [firstResult, secondResult];

  try {
    const requests = await requestsOrFailure(transport, operations);
    const byUrl = requests.toSorted((left, right) => left.request.url.localeCompare(right.request.url));
    const credentials = byUrl.map(request => request.request.headers.authorization);
    const expectedCredentials = ['Bearer first-credential', 'Bearer second-credential'];
    const sharedCredentials = JSON.stringify(credentials) !== JSON.stringify(expectedCredentials);

    for (const request of byUrl.toReversed()) {
      const value = fixtureResponse(request);
      request.respondJson(200, value);
    }
    const results = await Promise.all(operations);

    if (sharedCredentials) {
      throw new Error(
        `${binding.package.name} shared SSR credentials: expected ${expectedCredentials.join(', ')}, received ${credentials.join(', ')}`,
      );
    }
    deepStrictEqual(results, [
      { id: 'first', name: 'First' },
      { id: 'second', name: 'Second' },
    ]);
    transport.assertIdle(`${binding.package.name} SSR`);
  } finally {
    for (const request of transport.heldRequests) {
      if (request.state === 'pending') request.fail(new Error('SSR conformance cleanup'));
    }
    await Promise.allSettled(operations);
    await transport.whenIdle();
  }
}
