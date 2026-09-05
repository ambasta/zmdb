import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';

import { ClientResponseError, ResponseValidationError, TransportError, UnexpectedStatusError } from '@zmdb/client';

import type { AdapterConformanceBinding } from './conformance.js';
import {
  createControllableAdapterTransport,
  type ControllableAdapterTransport,
  type HeldAdapterRequest,
} from './controllable-transport.js';
import { createApiClient, type ApiClient, type Widget } from './generated/api.generated.js';

export interface AdapterClientFixture {
  readonly client: ApiClient;
  readonly transport: ControllableAdapterTransport;
}

const cleanupFailure = new Error('adapter conformance cleanup');

export function createAdapterClientFixture(
  credential?: string,
  transport: ControllableAdapterTransport = createControllableAdapterTransport(),
): AdapterClientFixture {
  const options =
    credential === undefined
      ? { baseUrl: '/api', transport: transport.transport }
      : {
          baseUrl: '/api',
          transport: transport.transport,
          authentication: () => ({
            requirement: 0,
            headers: { authorization: `Bearer ${credential}` },
          }),
        };
  return { client: createApiClient(options), transport };
}

export async function rejectionOf(promise: PromiseLike<unknown>): Promise<unknown> {
  const fulfilled = Symbol('fulfilled');
  const outcome = await Promise.resolve(promise).then(
    () => fulfilled,
    error => error,
  );
  if (outcome === fulfilled) throw new Error('expected promise to reject');
  return outcome;
}

export async function flushAdapterCompletions(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}

async function drainTransport(transport: ControllableAdapterTransport): Promise<void> {
  for (const request of transport.heldRequests) {
    if (request.state === 'pending') request.fail(cleanupFailure);
  }
  await transport.whenIdle();
  await flushAdapterCompletions();
}

function queryOptions(client: ApiClient, id: string) {
  return {
    client,
    input: { id },
    load: (api: ApiClient, input: { readonly id: string }, signal: AbortSignal) => api.getWidget(input, { signal }),
  };
}

export async function assertNoRequestBeforeMount(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'one'));
  try {
    deepStrictEqual(query.snapshot(), { data: undefined, error: undefined, loading: false });
    deepStrictEqual(transport.requests, []);
    await query.mount();
    strictEqual(transport.requests.length, 1);
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertPendingAndSuccess(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'one'));
  try {
    await query.mount();
    const request = await transport.nextRequest();
    deepStrictEqual(query.snapshot(), { data: undefined, error: undefined, loading: true });
    request.respondJson(200, { id: 'one', name: 'First' });
    await query.whenSettled();
    deepStrictEqual(query.snapshot(), {
      data: { id: 'one', name: 'First' },
      error: undefined,
      loading: false,
    });
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertDisposalCancellation(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'one'));
  let request: HeldAdapterRequest | undefined;
  try {
    await query.mount();
    request = await transport.nextRequest();
    await query.dispose();
    await flushAdapterCompletions();
    transport.assertIdle(`${binding.package.name} disposal`);
    strictEqual(request.request.signal?.aborted, true, `${binding.package.name} did not abort on disposal`);
    strictEqual(await request.whenAborted(), request.request.signal?.reason);
    strictEqual(request.abortReason, request.request.signal?.reason);
    strictEqual(query.snapshot().error, undefined);
  } finally {
    await query.dispose();
    if (request?.state === 'pending') request.fail(cleanupFailure);
    await drainTransport(transport);
  }
}

export async function assertStaleResultSuppression(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'first'));
  try {
    await query.mount();
    const first = await transport.nextRequest();
    await query.update({ id: 'second' });
    const second = await transport.nextRequest();

    second.respondJson(200, { id: 'second', name: 'Second' });
    await query.whenSettled();
    first.respondJson(200, { id: 'first', name: 'Late first' });
    await flushAdapterCompletions();

    deepStrictEqual(
      query.snapshot(),
      {
        data: { id: 'second', name: 'Second' },
        error: undefined,
        loading: false,
      },
      `${binding.package.name} allowed a stale result to overwrite the newer result`,
    );
    strictEqual(first.request.signal?.aborted, true, `${binding.package.name} did not abort the superseded query`);
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertClientResponseErrorIdentity(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'one'));
  try {
    await query.mount();
    (await transport.nextRequest()).respondJson(200, { id: 'one', name: 'First' });
    await query.whenSettled();

    const refreshed = query.refresh();
    (await transport.nextRequest()).respondJson(404, { code: 'missing', message: 'not found' });
    const error = await rejectionOf(refreshed);
    ok(error instanceof ClientResponseError);
    strictEqual(query.snapshot().error, error);
    deepStrictEqual(query.snapshot().data, { id: 'one', name: 'First' });
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertProtocolErrorIdentity(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'protocol'));
  try {
    await query.mount();
    (await transport.nextRequest()).respondText(418, 'short teapot');
    await query.whenSettled();
    ok(query.snapshot().error instanceof UnexpectedStatusError);
    strictEqual(query.snapshot().loading, false);
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertValidationErrorIdentity(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'validation'));
  try {
    await query.mount();
    (await transport.nextRequest()).respondJson(200, { id: 1, name: 'invalid' });
    await query.whenSettled();
    ok(query.snapshot().error instanceof ResponseValidationError);
    strictEqual(query.snapshot().loading, false);
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertNoImplicitRetry(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const query = binding.prepareQuery(queryOptions(client, 'one'));
  try {
    await query.mount();
    (await transport.nextRequest()).fail(new Error('transport unavailable'));
    await query.whenSettled();
    await flushAdapterCompletions();
    ok(query.snapshot().error instanceof TransportError);
    strictEqual(transport.requests.length, 1);
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertOpaqueGeneratedClient(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const opaqueClient = new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'getWidget') {
        throw new Error(`${binding.package.name} inspected generated-client property ${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
    getPrototypeOf() {
      throw new Error(`${binding.package.name} inspected the generated-client prototype`);
    },
    ownKeys() {
      throw new Error(`${binding.package.name} enumerated the generated-client contract`);
    },
  });
  const query = binding.prepareQuery(queryOptions(opaqueClient, 'opaque'));
  try {
    await query.mount();
    (await transport.nextRequest()).respondJson(200, { id: 'opaque', name: 'Opaque' });
    await query.whenSettled();
    deepStrictEqual(query.snapshot().data, { id: 'opaque', name: 'Opaque' });
  } finally {
    await query.dispose();
    await drainTransport(transport);
  }
}

export async function assertIndependentMutations(binding: AdapterConformanceBinding<ApiClient>): Promise<void> {
  const { client, transport } = createAdapterClientFixture();
  const mutation = binding.prepareMutation<{ readonly id: string; readonly name: string }, Widget>({
    client,
    run: (api, input, signal) => api.renameWidget(input, { signal }),
  });
  try {
    await mutation.mount();
    const firstPromise = mutation.mutate({ id: 'one', name: 'First' });
    const first = await transport.nextRequest();
    const secondPromise = mutation.mutate({ id: 'two', name: 'Second' });
    const second = await transport.nextRequest();
    strictEqual(first.request.signal?.aborted, false);
    strictEqual(mutation.snapshot().pending, true);

    second.respondJson(200, { id: 'two', name: 'Second' });
    deepStrictEqual(await secondPromise, { id: 'two', name: 'Second' });
    first.respondJson(409, { code: 'conflict', message: 'older mutation failed' });
    const firstError = await rejectionOf(firstPromise);
    ok(firstError instanceof ClientResponseError);
    deepStrictEqual(mutation.snapshot(), { error: undefined, pending: false });
  } finally {
    await mutation.dispose();
    await drainTransport(transport);
  }
}
