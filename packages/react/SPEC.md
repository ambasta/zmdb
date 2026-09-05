# `@zmdb/react` — generated-client React lifecycle SPEC

> Issue #691, parent #687. This package implements the React slice of the common adapter contract frozen by #688 and exercised by the private harness delivered in #690.

## 1. Package boundary

`@zmdb/react` is ESM-only, has `sideEffects: false`, depends only on `@zmdb/client`, and declares React 19.2 as a required peer. The package's type and packed-consumer fixtures compile the published
declarations against `@types/react`; declaration packages remain a TypeScript consumer concern rather than a production peer. The package is not re-exported by `zmdb`.

The package receives an opaque application-generated client. It does not inspect generated operations, construct URLs, encode requests, validate responses, normalize client errors, install a global
client, or import server, ORM, schema, compiler, validator, cache-library, or meta-framework code.

## 2. Typed binding factory

```ts
export function createZmdbReact<Client extends object = ClientRuntime>(bindingName?: string): ZmdbReactBindings<Client>;
```

Each factory invocation creates one React context and returns:

```ts
export interface ZmdbReactBindings<Client extends object> {
  ZmdbClientProvider(props: { readonly client: Client; readonly children?: ReactNode }): ReactElement;
  useZmdbClient(): Client;
  useZmdbQuery<Output>(load: (client: Client, signal: AbortSignal) => PromiseLike<Output>, dependencies: DependencyList): QueryState<Output>;
  useZmdbMutation<Input, Output>(run: (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>): MutationState<Input, Output>;
}
```

The generic client type is preserved from provider to callback without a consumer assertion. Creating the binding or rendering only the provider performs no request. `useZmdbClient` outside the
matching provider throws an adapter-owned error naming `bindingName` and the missing provider.

## 3. Query lifecycle

Before effect activation, the query state is `{ data: undefined, error: undefined, loading: false }`. Effect activation starts one request with a fresh controller. Start retains successful data for an
explicit refresh, clears the visible error, and sets `loading`.

The supplied dependency list selects the load closure and logical input identity. A change aborts the old controller, clears data and error, and starts the new identity after commit. Refresh aborts an
older query and returns a promise for the replacement. Every completion is generation-guarded because a transport may ignore cancellation.

Success stores the exact value. Failure stores and rejects with the exact error object. Lifecycle or supersession aborts are control flow and are not published as errors. Cleanup prevents every later
state write. Server rendering starts no request because React does not run effects there.

## 4. Mutation lifecycle

A mutation begins only when `mutate(input)` is called after mount. Calls are independent and a newer mutation does not abort an older potentially non-idempotent operation. `pending` remains true while
any call is unsettled. Starting the newest call clears the visible error; only that newest-started call may later publish an error.

Every returned promise preserves the exact value or error for its own call. Unmount aborts every active mutation controller and prevents later state writes.

## 5. React replay and ownership

StrictMode may run effect setup, cleanup, and setup again. Cleanup aborts the first request before the second is the only live request. Separate providers and separate binding factories share no
client, query state, mutation state, controller, cache, or retry policy.

The package provides no shared cache, de-duplication, implicit retry, backoff, focus refetch, polling, hydration registry, or mutation replay. Applications add those policies around the generated
operation or through their chosen state library.

## 6. Qualification

The private `fixtures/client-adapters` binding mounts the real hooks through React, updates real hook dependencies, unmounts the renderer, performs request-isolated server rendering, and runs the
common query, mutation, cancellation, stale-result, exact-error, no-retry, opaque-client, and SSR checks.

The packed fixture builds `@zmdb/client` and `@zmdb/react`, installs their tarballs with React 19.2.8 rather than workspace links, compiles against published declarations, and runs that same common
conformance set. Import probes must observe no request or global registration.
