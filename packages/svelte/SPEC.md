# `@zmdb/svelte` — typed context and stores specification

> **Status:** package contract implemented by issue #694 under the common adapter contract in `packages/zmdb/src/client-integrations/SPEC.md`.

## 1. Boundary

`@zmdb/svelte` is an ESM-only integration package with one root export. It depends inward on `@zmdb/client`, requires `svelte@>=5.57.0 <6.0.0` as a peer, and has no server, ORM, database, cache,
transport, generated-code, or competing HTTP dependency.

The package receives an opaque application-generated client. Application callbacks select generated methods:

```ts
export type QueryLoader<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;
```

No source in this package inspects a generated client, operation registry, OpenAPI document, URL, response, credential, or validator.

## 2. Public API

```ts
import type { Readable } from 'svelte/store';

export interface QuerySnapshot<Output> {
  readonly data: Output | undefined;
  readonly error: unknown;
  readonly loading: boolean;
}

export interface MutationSnapshot {
  readonly error: unknown;
  readonly pending: boolean;
}

export interface SvelteQueryStore<Output> extends Readable<QuerySnapshot<Output>> {
  refresh(): Promise<void>;
  destroy(): void;
}

export interface SvelteMutationStore<Input, Output> extends Readable<MutationSnapshot> {
  mutate(input: Input): Promise<Output>;
  destroy(): void;
}

export interface ZmdbSvelteBindings<Client> {
  getClient(): Client;
  setClient(client: Client): Client;
  hasClient(): boolean;
  query<Input, Output>(input: Input | Readable<Input>, load: QueryLoader<Client, Input, Output>): SvelteQueryStore<Output>;
  mutation<Input, Output>(run: MutationRunner<Client, Input, Output>): SvelteMutationStore<Input, Output>;
}

export function createZmdbSvelte<Client>(): ZmdbSvelteBindings<Client>;
export function createQueryStore<Client, Input, Output>(client: Client, input: Input | Readable<Input>, load: QueryLoader<Client, Input, Output>): SvelteQueryStore<Output>;
export function createMutationStore<Client, Input, Output>(client: Client, run: MutationRunner<Client, Input, Output>): SvelteMutationStore<Input, Output>;
```

`createZmdbSvelte` calls Svelte's `createContext<Client>()` once and is safe at module scope. `setClient`, `getClient`, `query`, and `mutation` are component-initialisation operations. Context-bound
stores register `destroy()` with `onDestroy`; direct store constructors remain usable by SvelteKit and non-component owners.

## 3. Query lifecycle

Constructing a binding or query store performs no request. The first subscription:

1. reads the current plain input or input-store value;
2. publishes `{ data, error: undefined, loading: true }`; and
3. calls the application loader with a fresh `AbortSignal`.

Additional subscribers share that one logical store request. The final unsubscribe aborts it and prevents every later completion from writing state. A later first subscription starts a fresh request
and retains successful data only when the input identity is unchanged.

An input-store change compares identity with `Object.is`, clears data and error for the old identity, aborts the selected request, and starts the new input while subscribed. Refresh retains data,
clears error, aborts the selected request, and returns a promise for the replacement request. A monotonically increasing generation rejects stale state writes even when a loader ignores abort.

Lifecycle and supersession aborts are control flow and never become store errors. An explicit `refresh()` still rejects with the exact abort reason if it is superseded or destroyed. Refreshing an
inactive or destroyed store rejects with `SvelteAdapterError`.

## 4. Mutation lifecycle

`mutate(input)` starts one independent request and returns its exact result or rejection. Concurrent mutations are never aborted merely because a newer mutation starts. `pending` remains true while
the current owner has at least one unsettled mutation.

Starting the newest mutation clears visible error. Only that newest-started mutation may publish an error, and it publishes the exact thrown object. Final unsubscribe or `destroy()` aborts every
in-flight mutation, clears pending state, suppresses later writes, and leaves each returned promise to reject with its own exact abort reason.

## 5. Context and SSR isolation

The binding factory owns only a typed Svelte context key. It stores no module-level client, request, credential, query snapshot, mutation snapshot, or hydration registry. The closest provider wins,
separate sibling component trees remain isolated, and separate `svelte/server` renders using one binding namespace cannot observe one another's clients.

Base-adapter SSR does not start a request merely because a component renders. Explicit server loading remains application or SvelteKit work; issue #699 reuses these stores rather than copying them.

## 6. Qualification

The package closes only with:

- exact named runtime tests for context isolation, first-subscription activation, final-unsubscribe cancellation, input-store stale suppression, SSR isolation, and mutation error identity;
- the shared generated-client conformance suite, including cancellation, protocol/error identity, no retry, opaque clients, concurrent mutations, SSR credentials, import purity, and manifest peers;
- compile-only inference through the real public package;
- a packed consumer that installs tarballs rather than workspace sources, typechecks against Svelte 5.57.0, compiles a browser component graph, and renders isolated server component trees; and
- product-catalog, architecture-policy, generated documentation, export, package, and publish metadata updated for the new package.
