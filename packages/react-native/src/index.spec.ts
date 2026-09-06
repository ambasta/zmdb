import { readFileSync } from 'node:fs';

import type { MutationState, QueryState } from '@zmdb/react';
import { createElement } from 'react';
import type { AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import {
  createZmdbReactNative,
  NativeBackgroundError,
  NativeOfflineError,
  type NativeAppState,
  type NativeBackgroundPolicy,
  type NativeConnectivity,
  type NativeConnectivityState,
  type NativeCredentialStore,
} from './index.js';

interface Pending<Value> {
  readonly signal: AbortSignal;
  resolve(value: Value): void;
}

class AppStateFixture implements NativeAppState {
  currentState: AppStateStatus = 'active';
  readonly listeners = new Set<(state: AppStateStatus) => void>();

  addEventListener(type: 'change', listener: (state: AppStateStatus) => void) {
    expect(type).toBe('change');
    this.listeners.add(listener);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  emit(state: AppStateStatus): void {
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

  emit(state: NativeConnectivityState): void {
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }
}

function credentials(): NativeCredentialStore<string> {
  let selected: string | null = 'fixture-token';
  return {
    read: () => Promise.resolve(selected),
    write(value) {
      selected = value;
      return Promise.resolve();
    },
  };
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

async function unmount(renderer: ReactTestRenderer | undefined): Promise<void> {
  if (renderer === undefined) return;
  await runAct(() => {
    renderer.unmount();
  });
}

function nativeOptions(
  appState: AppStateFixture,
  connectivity: ConnectivityFixture,
  backgroundPolicy: NativeBackgroundPolicy,
) {
  return {
    appState,
    backgroundPolicy,
    connectivity,
    credentials: credentials(),
    offlinePolicy: 'refuse' as const,
    bindingName: `NativeFixture:${backgroundPolicy}`,
  };
}

describe('@zmdb/react-native native lifecycle', () => {
  it('backgrounding applies the configured cancellation policy', async () => {
    const abortState = new AppStateFixture();
    const abortRequests: Pending<string>[] = [];
    const abortMutations: Pending<string>[] = [];
    const abortBindings = createZmdbReactNative<object, string>(
      nativeOptions(abortState, new ConnectivityFixture('online'), 'abort'),
    );
    let mutation: MutationState<string, string> | undefined;
    let abortRenderer: ReactTestRenderer | undefined;

    function AbortProbe() {
      abortBindings.useZmdbQuery((_client, signal) => held(signal, abortRequests), []);
      mutation = abortBindings.useZmdbMutation((_client, input, signal) =>
        held(signal, abortMutations).then(() => input),
      );
      return null;
    }

    await runAct(() => {
      abortRenderer = createRenderer(
        createElement(abortBindings.ZmdbClientProvider, { client: {} }, createElement(AbortProbe)),
      );
    });
    const selectedMutation = mutation;
    if (selectedMutation === undefined) throw new Error('native mutation did not mount');
    const mutationResult = selectedMutation.mutate('rename').then(
      () => undefined,
      error => error,
    );
    await Promise.resolve();
    await runAct(() => {
      abortState.emit('background');
    });

    expect(abortRequests[0]?.signal.aborted).toBe(true);
    expect(abortRequests[0]?.signal.reason).toBeInstanceOf(NativeBackgroundError);
    expect(abortMutations[0]?.signal.aborted).toBe(true);
    await expect(mutationResult).resolves.toBe(abortMutations[0]?.signal.reason);
    await unmount(abortRenderer);

    const continueState = new AppStateFixture();
    const continueRequests: Pending<string>[] = [];
    const continueBindings = createZmdbReactNative<object, string>(
      nativeOptions(continueState, new ConnectivityFixture('online'), 'continue'),
    );
    let continueRenderer: ReactTestRenderer | undefined;

    function ContinueProbe() {
      continueBindings.useZmdbQuery((_client, signal) => held(signal, continueRequests), []);
      return null;
    }

    await runAct(() => {
      continueRenderer = createRenderer(
        createElement(continueBindings.ZmdbClientProvider, { client: {} }, createElement(ContinueProbe)),
      );
    });
    await runAct(() => {
      continueState.emit('background');
    });
    expect(continueRequests[0]?.signal.aborted).toBe(false);
    await unmount(continueRenderer);
  });

  it('foreground refresh is opt-in', async () => {
    async function requestsFor(policy: NativeBackgroundPolicy): Promise<number> {
      const appState = new AppStateFixture();
      const requests: Pending<string>[] = [];
      const bindings = createZmdbReactNative<object, string>(
        nativeOptions(appState, new ConnectivityFixture('online'), policy),
      );
      let renderer: ReactTestRenderer | undefined;

      function Probe() {
        bindings.useZmdbQuery((_client, signal) => held(signal, requests), []);
        return null;
      }

      await runAct(() => {
        renderer = createRenderer(createElement(bindings.ZmdbClientProvider, { client: {} }, createElement(Probe)));
      });
      await runAct(() => {
        appState.emit('background');
      });
      await runAct(async () => {
        appState.emit('active');
        await Promise.resolve();
      });
      const count = requests.length;
      await unmount(renderer);
      return count;
    }

    await expect(requestsFor('abort')).resolves.toBe(1);
    await expect(requestsFor('abort-and-refresh')).resolves.toBe(2);

    async function settledRequestsFor(policy: NativeBackgroundPolicy): Promise<number> {
      const appState = new AppStateFixture();
      let requests = 0;
      const bindings = createZmdbReactNative<object, string>(
        nativeOptions(appState, new ConnectivityFixture('online'), policy),
      );
      let renderer: ReactTestRenderer | undefined;

      function Probe() {
        bindings.useZmdbQuery(() => {
          requests += 1;
          return Promise.resolve(`request-${String(requests)}`);
        }, []);
        return null;
      }

      await runAct(async () => {
        renderer = createRenderer(createElement(bindings.ZmdbClientProvider, { client: {} }, createElement(Probe)));
        await Promise.resolve();
      });
      await runAct(() => {
        appState.emit('background');
      });
      await runAct(async () => {
        appState.emit('active');
        await Promise.resolve();
      });
      await unmount(renderer);
      return requests;
    }

    await expect(settledRequestsFor('abort')).resolves.toBe(1);
    await expect(settledRequestsFor('abort-and-refresh')).resolves.toBe(2);
  });

  it('offline state refuses before network dispatch', async () => {
    const connectivity = new ConnectivityFixture('offline');
    const bindings = createZmdbReactNative<object, string>({
      ...nativeOptions(new AppStateFixture(), connectivity, 'abort'),
      offlinePolicy: 'refuse',
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

    expect(dispatches).toBe(0);
    expect(query?.loading).toBe(false);
    expect(query?.error).toBeInstanceOf(NativeOfflineError);
    await unmount(renderer);
  });

  it('queued offline work dispatches once after connectivity returns', async () => {
    const connectivity = new ConnectivityFixture('offline');
    const bindings = createZmdbReactNative<object, string>({
      ...nativeOptions(new AppStateFixture(), connectivity, 'abort'),
      offlinePolicy: 'queue',
    });
    const requests: Pending<string>[] = [];
    let query: QueryState<string> | undefined;
    let renderer: ReactTestRenderer | undefined;

    function Probe() {
      query = bindings.useZmdbQuery((_client, signal) => held(signal, requests), []);
      return null;
    }

    await runAct(() => {
      renderer = createRenderer(createElement(bindings.ZmdbClientProvider, { client: {} }, createElement(Probe)));
    });
    expect(requests).toHaveLength(0);
    expect(query?.loading).toBe(true);

    await runAct(async () => {
      connectivity.emit('online');
      await Promise.resolve();
    });
    expect(requests).toHaveLength(1);
    expect(connectivity.listeners.size).toBe(0);

    await runAct(async () => {
      requests[0]?.resolve('online');
      await Promise.resolve();
    });
    expect(query?.data).toBe('online');
    expect(requests).toHaveLength(1);
    await unmount(renderer);
  });

  it('unmount removes AppState and queued-connectivity subscriptions', async () => {
    const appState = new AppStateFixture();
    const connectivity = new ConnectivityFixture('offline');
    const bindings = createZmdbReactNative<object, string>({
      ...nativeOptions(appState, connectivity, 'abort'),
      offlinePolicy: 'queue',
    });
    let renderer: ReactTestRenderer | undefined;

    function Probe() {
      bindings.useZmdbQuery(() => Promise.resolve('online'), []);
      return null;
    }

    await runAct(() => {
      renderer = createRenderer(createElement(bindings.ZmdbClientProvider, { client: {} }, createElement(Probe)));
    });
    expect(appState.listeners.size).toBe(1);
    expect(connectivity.listeners.size).toBe(1);

    await unmount(renderer);
    expect(appState.listeners.size).toBe(0);
    expect(connectivity.listeners.size).toBe(0);
  });

  it('credential storage is injected and never bundled', async () => {
    const store = credentials();
    const bindings = createZmdbReactNative<object, string>({
      ...nativeOptions(new AppStateFixture(), new ConnectivityFixture('online'), 'abort'),
      credentials: store,
    });
    let observed: NativeCredentialStore<string> | undefined;
    let renderer: ReactTestRenderer | undefined;

    function Probe() {
      observed = bindings.useCredentialStore();
      return null;
    }

    await runAct(() => {
      renderer = createRenderer(createElement(bindings.ZmdbClientProvider, { client: {} }, createElement(Probe)));
    });
    expect(observed).toBe(store);

    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    expect(declared.has('@react-native-async-storage/async-storage')).toBe(false);
    expect(declared.has('@react-native-community/netinfo')).toBe(false);
    expect(declared.has('expo-secure-store')).toBe(false);
    expect(declared.has('react-native-keychain')).toBe(false);
    await unmount(renderer);
  });

  it('React hooks are reused rather than duplicated', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { createZmdbReact } from '@zmdb/react'");
    expect(source).toContain('react.useZmdbQuery(guardedLoad');
    expect(source).toContain('react.useZmdbMutation(guardedRun');
    expect(source).not.toMatch(/\buseState\b/);
    expect(source).not.toContain('interface QuerySnapshot');
    expect(source).not.toContain('interface MutationSnapshot');
  });

  it('creating bindings performs no native subscription', () => {
    const appState = new AppStateFixture();
    const connectivity = new ConnectivityFixture('online');
    createZmdbReactNative<object, string>(nativeOptions(appState, connectivity, 'abort'));
    expect(appState.listeners.size).toBe(0);
    expect(connectivity.listeners.size).toBe(0);
  });
});
