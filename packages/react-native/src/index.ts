import type { ClientRuntime } from '@zmdb/client';
import { createZmdbReact } from '@zmdb/react';
import type {
  MutationRunner,
  MutationState,
  QueryLoader,
  QueryState,
  ZmdbClientProviderProps,
  ZmdbReactBindings,
  ZmdbReactRequestKind,
  ZmdbReactRequestLifecycle,
} from '@zmdb/react';
import { createContext, createElement, useCallback, useContext, useEffect, useRef } from 'react';
import type { DependencyList, ReactElement } from 'react';

export type {
  MutationRunner,
  MutationState,
  QueryLoader,
  QueryState,
  ZmdbClientProviderProps,
  ZmdbReactBindings,
} from '@zmdb/react';

export type NativeBackgroundPolicy = 'abort' | 'abort-and-refresh' | 'continue';
export type NativeConnectivityState = 'offline' | 'online';
export type NativeOfflinePolicy = 'queue' | 'refuse';
export type NativeAppStateStatus = string | null | undefined;

export interface NativeSubscription {
  remove(): void;
}

/**
 * React Native's AppState object satisfies this shape directly. Tests and
 * non-device renderers can supply the same two-member structural port.
 */
export interface NativeAppState {
  readonly currentState: NativeAppStateStatus;
  addEventListener(type: 'change', listener: (state: NativeAppStateStatus) => void): NativeSubscription;
}

/**
 * Application-owned bridge for NetInfo, another connectivity library, or a
 * platform service. The adapter deliberately imports none of them.
 */
export interface NativeConnectivity {
  readonly currentState: NativeConnectivityState;
  subscribe(listener: (state: NativeConnectivityState) => void): () => void;
}

/**
 * Application-owned bridge for AsyncStorage, Keychain, SecureStore, or another
 * native credential implementation. Writing null clears the selected value.
 */
export interface NativeCredentialStore<Credential> {
  read(): PromiseLike<Credential | null>;
  write(value: Credential | null): PromiseLike<void>;
}

export interface ZmdbReactNativeOptions<Credential> {
  readonly appState: NativeAppState;
  readonly backgroundPolicy: NativeBackgroundPolicy;
  readonly connectivity: NativeConnectivity;
  readonly credentials: NativeCredentialStore<Credential>;
  readonly offlinePolicy: NativeOfflinePolicy;
  readonly bindingName?: string;
}

export interface ZmdbReactNativeBindings<Client extends object, Credential> extends ZmdbReactBindings<Client> {
  useCredentialStore(): NativeCredentialStore<Credential>;
  useConnectivity(): NativeConnectivity;
}

export class NativeOfflineError extends Error {
  override readonly name = 'NativeOfflineError';

  constructor(bindingName: string) {
    super(`${bindingName} refused the request because native connectivity is offline`);
  }
}

export class NativeBackgroundError extends Error {
  override readonly name = 'NativeBackgroundError';
  readonly state: NativeAppStateStatus;

  constructor(bindingName: string, state: NativeAppStateStatus) {
    super(`${bindingName} aborted the request because AppState changed to ${String(state)}`);
    this.state = state;
  }
}

interface NativeCoordinator<Credential> {
  readonly connectivity: NativeConnectivity;
  readonly credentials: NativeCredentialStore<Credential>;
  readonly requestLifecycle: ZmdbReactRequestLifecycle;
  activate(): () => void;
  registerRefresh(refresh: () => Promise<void>): () => void;
}

function once(cleanup: () => void): () => void {
  let complete = false;
  return () => {
    if (complete) return;
    complete = true;
    cleanup();
  };
}

function isActive(state: NativeAppStateStatus): boolean {
  return state === 'active';
}

function createCoordinator<Credential>(
  options: ZmdbReactNativeOptions<Credential>,
  bindingName: string,
): NativeCoordinator<Credential> {
  const queries = new Set<AbortController>();
  const mutations = new Set<AbortController>();
  const refreshes = new Set<() => Promise<void>>();
  let currentState = options.appState.currentState;
  let refreshOnForeground = false;

  const abortRequests = (state: NativeAppStateStatus): void => {
    if (options.backgroundPolicy === 'continue') return;
    if (options.backgroundPolicy === 'abort-and-refresh' && refreshes.size > 0) {
      refreshOnForeground = true;
    }
    const reason = new NativeBackgroundError(bindingName, state);
    for (const controller of [...queries, ...mutations]) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
  };

  const onAppState = (state: NativeAppStateStatus): void => {
    const wasActive = isActive(currentState);
    currentState = state;
    const active = isActive(state);
    if (wasActive && !active) abortRequests(state);
    if (!wasActive && active && refreshOnForeground) {
      refreshOnForeground = false;
      for (const refresh of refreshes) void refresh().catch(() => undefined);
    }
  };

  const requestLifecycle: ZmdbReactRequestLifecycle = {
    register(kind: ZmdbReactRequestKind, controller: AbortController): () => void {
      const selected = kind === 'query' ? queries : mutations;
      selected.add(controller);
      const release = once(() => {
        selected.delete(controller);
        controller.signal.removeEventListener('abort', release);
      });
      controller.signal.addEventListener('abort', release, { once: true });
      if (controller.signal.aborted) release();

      if (!isActive(currentState) && options.backgroundPolicy !== 'continue' && !controller.signal.aborted) {
        if (kind === 'query' && options.backgroundPolicy === 'abort-and-refresh') refreshOnForeground = true;
        controller.abort(new NativeBackgroundError(bindingName, currentState));
      }
      return release;
    },
  };

  return {
    connectivity: options.connectivity,
    credentials: options.credentials,
    requestLifecycle,
    activate() {
      const subscription = options.appState.addEventListener('change', onAppState);
      const mountedState = options.appState.currentState;
      if (mountedState !== currentState) onAppState(mountedState);
      else if (!isActive(mountedState)) abortRequests(mountedState);
      return once(() => {
        subscription.remove();
      });
    },
    registerRefresh(refresh) {
      refreshes.add(refresh);
      return once(() => {
        refreshes.delete(refresh);
      });
    },
  };
}

function aborted(signal: AbortSignal): Promise<never> {
  return Promise.reject(signal.reason);
}

function waitForConnectivity(connectivity: NativeConnectivity, signal: AbortSignal): Promise<void> {
  if (connectivity.currentState === 'online') return Promise.resolve();
  if (signal.aborted) return aborted(signal);

  return new Promise<void>((resolve, reject) => {
    let complete = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (action: () => void): void => {
      if (complete) return;
      complete = true;
      signal.removeEventListener('abort', onAbort);
      unsubscribe?.();
      unsubscribe = undefined;
      action();
    };
    const onAbort = (): void => {
      finish(() => reject(signal.reason));
    };
    const onConnectivity = (state: NativeConnectivityState): void => {
      if (state === 'online') finish(resolve);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    const selectedUnsubscribe = connectivity.subscribe(onConnectivity);
    if (complete) selectedUnsubscribe();
    else unsubscribe = selectedUnsubscribe;
    if (signal.aborted) onAbort();
    else if (connectivity.currentState === 'online') finish(resolve);
  });
}

async function dispatchWhenAvailable<Output>(
  connectivity: NativeConnectivity,
  offlinePolicy: NativeOfflinePolicy,
  bindingName: string,
  signal: AbortSignal,
  dispatch: () => PromiseLike<Output>,
): Promise<Output> {
  if (signal.aborted) return aborted(signal);
  if (connectivity.currentState === 'offline') {
    if (offlinePolicy === 'refuse') throw new NativeOfflineError(bindingName);
    await waitForConnectivity(connectivity, signal);
  }
  if (signal.aborted) return aborted(signal);
  return dispatch();
}

export function createZmdbReactNative<Client extends object = ClientRuntime, Credential = string>(
  options: ZmdbReactNativeOptions<Credential>,
): ZmdbReactNativeBindings<Client, Credential> {
  const bindingName = options.bindingName ?? '@zmdb/react-native';
  const react = createZmdbReact<Client>(bindingName);
  const NativeContext = createContext<NativeCoordinator<Credential> | undefined>(undefined);

  function useNativeContext(): NativeCoordinator<Credential> {
    const coordinator = useContext(NativeContext);
    if (coordinator !== undefined) return coordinator;
    throw new Error(
      `${bindingName} native services are unavailable; render this hook under ${bindingName}.ZmdbClientProvider`,
    );
  }

  function ZmdbClientProvider(props: ZmdbClientProviderProps<Client>): ReactElement {
    const coordinator = useRef<NativeCoordinator<Credential> | undefined>(undefined);
    if (coordinator.current === undefined) coordinator.current = createCoordinator(options, bindingName);
    const selectedCoordinator = coordinator.current;

    useEffect(() => selectedCoordinator.activate(), [selectedCoordinator]);

    return createElement(
      NativeContext.Provider,
      { value: selectedCoordinator },
      createElement(
        react.ZmdbClientProvider,
        {
          client: props.client,
          requestLifecycle: selectedCoordinator.requestLifecycle,
        },
        props.children,
      ),
    );
  }

  function useZmdbQuery<Output>(load: QueryLoader<Client, Output>, dependencies: DependencyList): QueryState<Output> {
    const coordinator = useNativeContext();
    const guardedLoad = useCallback(
      (client: Client, signal: AbortSignal) =>
        dispatchWhenAvailable(coordinator.connectivity, options.offlinePolicy, bindingName, signal, () =>
          load(client, signal),
        ),
      [coordinator, ...dependencies],
    );
    const query = react.useZmdbQuery(guardedLoad, [guardedLoad]);
    useEffect(() => coordinator.registerRefresh(query.refresh), [coordinator, query.refresh]);
    return query;
  }

  function useZmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): MutationState<Input, Output> {
    const coordinator = useNativeContext();
    const guardedRun = useCallback(
      (client: Client, input: Input, signal: AbortSignal) =>
        dispatchWhenAvailable(coordinator.connectivity, options.offlinePolicy, bindingName, signal, () =>
          run(client, input, signal),
        ),
      [coordinator, run],
    );
    return react.useZmdbMutation(guardedRun);
  }

  function useCredentialStore(): NativeCredentialStore<Credential> {
    return useNativeContext().credentials;
  }

  function useConnectivity(): NativeConnectivity {
    return useNativeContext().connectivity;
  }

  return Object.freeze({
    ZmdbClientProvider,
    useZmdbClient: react.useZmdbClient,
    useZmdbMutation,
    useZmdbQuery,
    useCredentialStore,
    useConnectivity,
  });
}
