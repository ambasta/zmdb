import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';

import { createZmdbSolid, type SolidQuery } from '@zmdb/solid';
import { createComponent, createRoot, ErrorBoundary, Suspense } from 'solid-js';

import {
  assertClientResponseErrorIdentity,
  assertDisposalCancellation,
  assertIndependentMutations,
  assertNoImplicitRetry,
  assertNoRequestBeforeMount,
  assertOpaqueGeneratedClient,
  assertPendingAndSuccess,
  assertProtocolErrorIdentity,
  assertStaleResultSuppression,
  assertValidationErrorIdentity,
  flushAdapterCompletions,
} from './conformance-cases.js';
import { createApiClient, type ApiClient, type Widget } from './generated/api.generated.js';
import { createSolidAdapterBinding } from './solid-binding.js';
import { assertSsrCredentialIsolation } from './ssr.js';

async function contextIsolation(): Promise<void> {
  const bindings = createZmdbSolid<{ readonly owner: string }>();
  const observed: string[] = [];
  const mount = (owner: string): void => {
    createRoot(dispose => {
      createComponent(bindings.Provider, {
        client: { owner },
        get children() {
          observed.push(bindings.useClient().owner);
          return undefined;
        },
      });
      dispose();
    });
  };
  mount('first');
  mount('second');
  deepStrictEqual(observed, ['first', 'second']);
}

async function suspensePromiseIdentity(): Promise<void> {
  const bindings = createZmdbSolid<{ readonly name: string }>();
  let query: SolidQuery<string> | undefined;
  let resolveOperation: ((value: string) => void) | undefined;
  const operation = new Promise<string>(resolve => {
    resolveOperation = resolve;
  });
  let view: unknown;
  const dispose = createRoot(disposeRoot => {
    createComponent(bindings.Provider, {
      client: { name: 'client' },
      get children() {
        query = bindings.query('widget', () => operation);
        view = createComponent(Suspense, {
          fallback: 'loading',
          get children() {
            return query?.data();
          },
        });
        return undefined;
      },
    });
    return disposeRoot;
  });

  try {
    const current = query;
    if (current === undefined) throw new Error('Solid query was not created');
    strictEqual(current.pending(), operation);
    strictEqual(current.data.state, 'pending');
    if (typeof view !== 'function') throw new Error('Solid Suspense did not return a reactive accessor');
    strictEqual(view(), 'loading');
    if (resolveOperation === undefined) throw new Error('Solid query promise has no resolver');
    resolveOperation('ready');
    await operation;
    await flushAdapterCompletions();
    strictEqual(view(), 'ready');
  } finally {
    dispose();
  }
}

async function errorIdentity(): Promise<void> {
  const bindings = createZmdbSolid<{ readonly name: string }>();
  const failure = new Error('generated client failure');
  let query: SolidQuery<string> | undefined;
  let observed: unknown;
  let view: unknown;
  const dispose = createRoot(disposeRoot => {
    createComponent(bindings.Provider, {
      client: { name: 'client' },
      get children() {
        query = bindings.query('widget', () => Promise.reject(failure));
        view = createComponent(ErrorBoundary, {
          fallback(error) {
            observed = error;
            return 'failed';
          },
          get children() {
            return query?.data();
          },
        });
        return undefined;
      },
    });
    return disposeRoot;
  });

  try {
    await flushAdapterCompletions();
    if (typeof view !== 'function') throw new Error('Solid ErrorBoundary did not return a reactive accessor');
    strictEqual(view(), 'failed');
    strictEqual(observed, failure);
    strictEqual(query?.error(), failure);
  } finally {
    dispose();
  }
}

async function commonConformance(): Promise<void> {
  const binding = createSolidAdapterBinding<ApiClient>();
  await assertNoRequestBeforeMount(binding);
  await assertPendingAndSuccess(binding);
  await assertDisposalCancellation(binding);
  await assertStaleResultSuppression(binding);
  await assertClientResponseErrorIdentity(binding);
  await assertProtocolErrorIdentity(binding);
  await assertValidationErrorIdentity(binding);
  await assertNoImplicitRetry(binding);
  await assertOpaqueGeneratedClient(binding);
  await assertIndependentMutations(binding);
}

async function generatedClientSmoke(): Promise<void> {
  const binding = createSolidAdapterBinding<ApiClient>();
  const client = createApiClient({
    baseUrl: '/api',
    transport: async request => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: new Response(JSON.stringify({ id: request.url.split('/').at(-1), name: 'packed' })).body,
    }),
  });
  const result = await binding.runSsrQuery<{ readonly id: string }, Widget>({
    client,
    input: { id: 'packed' },
    load: (api, input, signal) => api.getWidget(input, { signal }),
  });
  deepStrictEqual(result, { id: 'packed', name: 'packed' });
}

const scenario = process.argv[2];
switch (scenario) {
  case 'context':
    await contextIsolation();
    break;
  case 'disposal':
    await assertDisposalCancellation(createSolidAdapterBinding<ApiClient>());
    break;
  case 'latest-input':
    await assertStaleResultSuppression(createSolidAdapterBinding<ApiClient>());
    break;
  case 'suspense':
    await suspensePromiseIdentity();
    break;
  case 'error':
    await errorIdentity();
    break;
  case 'ssr':
    await assertSsrCredentialIsolation(createSolidAdapterBinding<ApiClient>());
    break;
  case 'no-request':
    await assertNoRequestBeforeMount(createSolidAdapterBinding<ApiClient>());
    break;
  case 'pending':
    await assertPendingAndSuccess(createSolidAdapterBinding<ApiClient>());
    break;
  case 'client-error':
    await assertClientResponseErrorIdentity(createSolidAdapterBinding<ApiClient>());
    break;
  case 'protocol-error':
    await assertProtocolErrorIdentity(createSolidAdapterBinding<ApiClient>());
    break;
  case 'validation-error':
    await assertValidationErrorIdentity(createSolidAdapterBinding<ApiClient>());
    break;
  case 'no-retry':
    await assertNoImplicitRetry(createSolidAdapterBinding<ApiClient>());
    break;
  case 'opaque':
    await assertOpaqueGeneratedClient(createSolidAdapterBinding<ApiClient>());
    break;
  case 'mutations':
    await assertIndependentMutations(createSolidAdapterBinding<ApiClient>());
    break;
  case 'common':
    await commonConformance();
    break;
  case 'generated-client':
    await generatedClientSmoke();
    break;
  default:
    throw new Error(`unknown Solid adapter scenario ${String(scenario)}`);
}

ok(true);
process.stdout.write(`${String(scenario)}: ok\n`);
