# `@zmdb/react-native` — native lifecycle and connectivity SPEC

> Issue #696, parent #687. This package implements the React Native slice of the common adapter contract frozen by #688 and reuses the React request/state implementation delivered by #691.

## 1. Package boundary

`@zmdb/react-native` is ESM-only, has `sideEffects: false`, depends only on `@zmdb/client` and `@zmdb/react`, and declares React 19.2 and React Native 0.87 as required peers. It is opt-in and is not
re-exported by `zmdb`.

The package owns device lifecycle policy around an opaque application-generated client. It does not inspect operations, construct URLs, encode requests, validate responses, choose a connectivity
library, choose credential persistence, import a database or server package, or expose a `./metro` entry. `@zmdb/compiler/metro` owns the AOT build integration.

## 2. Structural native ports

`createZmdbReactNative<Client, Credential>(options)` receives three application-owned ports:

```ts
export interface NativeAppState {
  readonly currentState: string | null | undefined;
  addEventListener(
    type: 'change',
    listener: (state: string | null | undefined) => void,
  ): {
    remove(): void;
  };
}

export interface NativeConnectivity {
  readonly currentState: 'offline' | 'online';
  subscribe(listener: (state: 'offline' | 'online') => void): () => void;
}

export interface NativeCredentialStore<Credential> {
  read(): PromiseLike<Credential | null>;
  write(value: Credential | null): PromiseLike<void>;
}
```

React Native's `AppState` satisfies the first shape directly. An application may adapt NetInfo, another reachability service, AsyncStorage, SecureStore, Keychain, or an application vault to the other
two shapes. None is a dependency, peer, dynamic import, default implementation, or package-owned singleton.

Creating bindings performs no subscription. Each mounted `ZmdbClientProvider` owns its AppState subscription and removes it on unmount. `useCredentialStore()` and `useConnectivity()` return the exact
injected ports rather than wrapping or discovering an implementation.

## 3. Reused React lifecycle

The returned binding extends `ZmdbReactBindings<Client>` with only the two native-port accessors. Provider, query, mutation, error, stale-result, StrictMode, and unmount semantics remain implemented
by `@zmdb/react`.

`@zmdb/react` exposes a per-provider `ZmdbReactRequestLifecycle` registration seam. The native provider passes that seam to the React provider, so AppState aborts the actual query and mutation
controllers owned by the base hooks. The native package contains no query or mutation snapshot state machine and no copy of React's generation, pending-count, or error-publication logic.

An environment abort is lifecycle control flow: the React query clears `loading`, retains successful data, and does not publish the `NativeBackgroundError`. Mutation promises still reject with the
exact signal reason and are never replayed.

## 4. AppState policy

`backgroundPolicy` is required and closed:

- `continue` leaves active requests running and performs no foreground refresh;
- `abort` aborts active queries and mutations and performs no foreground refresh; and
- `abort-and-refresh` aborts active requests, then refreshes mounted queries once when AppState next becomes `active`.

Foreground refresh is therefore opt-in. A mutation is never replayed on foreground because cancellation cannot prove a non-idempotent server operation did not execute. Repeated background events do
not create additional requests. If a request starts while AppState is already non-active under an aborting policy, it is aborted before its application callback dispatches.

## 5. Connectivity policy

`offlinePolicy` is required and closed:

- `refuse` rejects with `NativeOfflineError` before the application callback and therefore before network dispatch; and
- `queue` waits for the structural connectivity port to report `online`, dispatches once, and removes the listener.

Queued work is not a retry. It has not dispatched yet, carries the original React-owned signal, and rejects with that exact signal reason if unmount, supersession, or AppState aborts it while waiting.
Once dispatch begins the adapter never retries, replays, wraps an error, or changes a client result.

## 6. Device and publication qualification

The package root has no Node built-in, server export, database package, NetInfo, AsyncStorage, keychain, or credential implementation in its runtime closure. Its packed consumer:

1. builds and packs `@zmdb/client`, `@zmdb/react`, and `@zmdb/react-native`;
2. installs only those tarballs plus the frozen React and React Native peers;
3. typechecks against published declarations;
4. runs AppState cancellation, foreground refresh, offline refusal, and credential-port identity through React mounting.

The repository's existing Metro fixture separately imports the native adapter and real React Native `AppState`, traverses `@zmdb/compiler/metro`, and produces a Metro 0.87 iOS bundle whose resolver
rejects every Node built-in. Keeping that build witness in the established fixture proves the client adapter adds no competing `./metro` surface.

The workspace conformance harness additionally runs the common generated-client query, mutation, cancellation, stale-result, exact-error, no-retry, opaque-client, import-purity, and SSR cases through
the real native binding.

## 7. Required acceptance titles

- `backgrounding applies the configured cancellation policy`
- `foreground refresh is opt-in`
- `offline state refuses before network dispatch`
- `credential storage is injected and never bundled`
- `Metro consumer bundles without Node built-ins`
- `React hooks are reused rather than duplicated`
