import type { MutationState, QueryState } from '@zmdb/react';
import {
  NativeBackgroundError,
  NativeOfflineError,
  createZmdbReactNative,
  type NativeAppState,
  type NativeAppStateStatus,
  type NativeConnectivity,
  type NativeConnectivityState,
  type NativeCredentialStore,
} from '@zmdb/react-native';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

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
} from './conformance-cases.js';
import type { ApiClient } from './generated/api.generated.js';
import { createReactNativeConformanceBinding } from './react-native-binding.js';
import { assertSsrCredentialIsolation } from './ssr.js';

interface Pending<Value> {
  readonly signal: AbortSignal;
  resolve(value: Value): void;
}

class AppStateFixture implements NativeAppState {
  currentState: NativeAppStateStatus = 'active';
  readonly listeners = new Set<(state: NativeAppStateStatus) => void>();

  addEventListener(_type: 'change', listener: (state: NativeAppStateStatus) => void) {
    this.listeners.add(listener);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  emit(state: NativeAppStateStatus): void {
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }
}

class ConnectivityFixture implements NativeConnectivity {
  readonly listeners = new Set<(state: NativeConnectivityState) => void>();

  constructor(public currentState: NativeConnectivityState) {}

  subscribe(listener: (state: NativeConnectivityState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createRenderer(element: ReturnType<typeof createElement>): ReactTestRenderer {
  const originalError = console.error;
  console.error = (message?: unknown, ...rest: unknown[]): void => {
    if (message === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
    originalError(message, ...rest);
  };
  try {
    return create(element);
  } finally {
    console.error = originalError;
  }
}

async function runAct(action: () => void | Promise<void>): Promise<void> {
  const previous = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  try {
    await act(async () => {
      await action();
    });
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous);
  }
}

function held<Value>(signal: AbortSignal, requests: Pending<Value>[]): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    requests.push({ signal, resolve });
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function assertNativeLifecycle(): Promise<void> {
  const appState = new AppStateFixture();
  const connectivity = new ConnectivityFixture('online');
  const credentialStore: NativeCredentialStore<string> = {
    read: () => Promise.resolve('packed-token'),
    write: () => Promise.resolve(),
  };
  const bindings = createZmdbReactNative<object, string>({
    appState,
    backgroundPolicy: 'abort-and-refresh',
    connectivity,
    credentials: credentialStore,
    offlinePolicy: 'refuse',
    bindingName: 'PackedNative',
  });
  const queries: Pending<string>[] = [];
  const mutations: Pending<string>[] = [];
  let mutation: MutationState<string, string> | undefined;
  let observedStore: NativeCredentialStore<string> | undefined;
  let renderer: ReactTestRenderer | undefined;

  function Probe() {
    bindings.useZmdbQuery((_client, signal) => held(signal, queries), []);
    mutation = bindings.useZmdbMutation((_client, input, signal) => held(signal, mutations).then(() => input));
    observedStore = bindings.useCredentialStore();
    return null;
  }

  await runAct(() => {
    renderer = createRenderer(createElement(bindings.ZmdbClientProvider, { client: {} }, createElement(Probe)));
  });
  assert(observedStore === credentialStore, 'packed native provider did not preserve credential-store identity');
  const selectedMutation = mutation;
  assert(selectedMutation !== undefined, 'packed native mutation did not mount');
  const mutationSettlement = selectedMutation.mutate('rename').then(
    () => undefined,
    error => error,
  );
  await Promise.resolve();

  await runAct(() => {
    appState.emit('background');
  });
  assert(queries[0]?.signal.aborted === true, 'packed native query was not aborted on background');
  assert(
    queries[0]?.signal.reason instanceof NativeBackgroundError,
    'packed native query did not retain the background reason',
  );
  assert(mutations[0]?.signal.aborted === true, 'packed native mutation was not aborted on background');
  assert(
    (await mutationSettlement) === mutations[0]?.signal.reason,
    'packed native mutation changed the signal reason',
  );

  await runAct(async () => {
    appState.emit('active');
    await Promise.resolve();
  });
  assert(queries.length === 2, 'packed native foreground did not refresh exactly once');

  const selectedRenderer = renderer;
  assert(selectedRenderer !== undefined, 'packed native renderer did not mount');
  await runAct(() => {
    selectedRenderer.unmount();
  });
}

async function assertOfflineRefusal(): Promise<void> {
  const appState = new AppStateFixture();
  const connectivity = new ConnectivityFixture('offline');
  const bindings = createZmdbReactNative<object, string>({
    appState,
    backgroundPolicy: 'abort',
    connectivity,
    credentials: {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
    },
    offlinePolicy: 'refuse',
    bindingName: 'PackedOffline',
  });
  let dispatches = 0;
  let query: QueryState<string> | undefined;
  let renderer: ReactTestRenderer | undefined;

  function Probe() {
    query = bindings.useZmdbQuery(() => {
      dispatches += 1;
      return Promise.resolve('unexpected');
    }, []);
    return null;
  }

  await runAct(async () => {
    renderer = createRenderer(createElement(bindings.ZmdbClientProvider, { client: {} }, createElement(Probe)));
    await Promise.resolve();
  });
  assert(dispatches === 0, 'packed native offline refusal dispatched the application callback');
  assert(query?.error instanceof NativeOfflineError, 'packed native offline refusal lost its adapter error');
  const selectedRenderer = renderer;
  assert(selectedRenderer !== undefined, 'packed offline renderer did not mount');
  await runAct(() => {
    selectedRenderer.unmount();
  });
}

const binding = createReactNativeConformanceBinding<ApiClient>();
const commonCases = [
  () => assertNoRequestBeforeMount(binding),
  () => assertPendingAndSuccess(binding),
  () => assertDisposalCancellation(binding),
  () => assertStaleResultSuppression(binding),
  () => assertClientResponseErrorIdentity(binding),
  () => assertProtocolErrorIdentity(binding),
  () => assertValidationErrorIdentity(binding),
  () => assertNoImplicitRetry(binding),
  () => assertOpaqueGeneratedClient(binding),
  () => assertIndependentMutations(binding),
  () => assertSsrCredentialIsolation(binding),
];

for (const run of commonCases) await run();
await assertNativeLifecycle();
await assertOfflineRefusal();

process.stdout.write(
  JSON.stringify({
    package: binding.package.name,
    commonCases: commonCases.length,
    nativeCases: 2,
    source: 'packed-tarballs',
  }),
);
