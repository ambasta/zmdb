# `@zmdb/vue` — Vue plugin and composables SPEC

> Issue #693, parent #687. This package implements the Vue 3 base-adapter row of the common client integration contract in
> [`packages/zmdb/src/client-integrations/SPEC.md`](../zmdb/src/client-integrations/SPEC.md).

## 1. Package boundary

`@zmdb/vue` is ESM-only and has:

- one production workspace dependency, `@zmdb/client`;
- one required framework peer, `vue@>=3.5.0 <4.0.0`;
- no dependency on `@zmdb/web`, the ORM, schema, validator, database, Node built-in, HTTP client, cache, or state-management package;
- no module-level client, request, credential, cache, mutable registry, retry loop, or polling loop; and
- one public root export.

The package owns only Vue-native application injection, watcher/effect-scope lifetime, reactive query/mutation state, cancellation, stale-completion suppression, and per-application SSR isolation.
Generated operation methods, request construction, authentication, response validation, and client errors remain owned by the application-generated client and `@zmdb/client`.

## 2. Public contract

```ts
import type { ClientRuntime } from '@zmdb/client';
import type { MaybeRefOrGetter, Plugin, Ref } from 'vue';

export type QueryLoader<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;

export interface VueQueryState<Output> {
  readonly data: Readonly<Ref<Output | undefined>>;
  readonly error: Readonly<Ref<unknown>>;
  readonly loading: Readonly<Ref<boolean>>;
  refresh(): Promise<void>;
}

export interface VueMutationState<Input, Output> {
  readonly error: Readonly<Ref<unknown>>;
  readonly pending: Readonly<Ref<boolean>>;
  mutate(input: Input): Promise<Output>;
}

export interface ZmdbVueBindings<Client extends object> {
  createZmdbPlugin(client: Client): Plugin;
  useZmdbClient(): Client;
  useZmdbQuery<Input, Output>(input: MaybeRefOrGetter<Input>, load: QueryLoader<Client, Input, Output>): VueQueryState<Output>;
  useZmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): VueMutationState<Input, Output>;
}

export function createZmdbVue<Client extends object = ClientRuntime>(bindingName?: string): ZmdbVueBindings<Client>;
```

Applications supply their generated client type once to `createZmdbVue<ApiClient>()`. Query output and mutation input/output types are then inferred from the operation callback. The optional binding
name is diagnostic text only and does not affect request identity.

## 3. Plugin and client injection

Each `createZmdbVue` call creates one private typed `InjectionKey<Client>`. `createZmdbPlugin(client)` returns an immutable Vue plugin whose `install` method provides that client on only the receiving
application.

Creating bindings, creating the plugin, and installing it perform no request. `useZmdbClient()`:

- returns the exact provided client object from the current injection context;
- never falls back to a process-global client;
- distinguishes use outside an injection context from a missing plugin; and
- names the binding and the required installation action in its error.

Two applications that install different clients through the same binding namespace must resolve their own clients. Installing one application must not affect another.

## 4. Query lifecycle

`useZmdbQuery` requires an active component/effect scope and injection context. It creates read-only computed projections over private shallow refs and starts a synchronous, immediate Vue watcher over
`toValue(input)`.

For one input identity:

1. start clears the visible error and sets `loading` to `true`;
2. success publishes the exact resolved value, clears the error, and sets `loading` to `false`;
3. failure retains prior successful data, publishes the exact thrown object, and sets `loading` to `false`; and
4. explicit `refresh()` retains prior data, starts a fresh controller, and returns a promise for that selected request.

When the watched input changes, the composable:

- increments a generation;
- creates a fresh `AbortController`;
- aborts the preceding query with an adapter-owned cancellation reason;
- clears data and error belonging to the old input identity; and
- starts the new request synchronously with the watcher change.

Every completion checks its generation before writing. A transport that ignores abort cannot let an older success or failure overwrite the selected input's state.

There is at most one live query request per composable. An explicit refresh supersedes and aborts the preceding query. Automatic watcher requests consume their own rejection to avoid an unhandled
promise; explicit `refresh()` resolves or rejects for the caller.

## 5. Mutation lifecycle

`useZmdbMutation` also requires an active component/effect scope and injection context. Each `mutate(input)`:

- receives a fresh controller;
- starts an independent generated-client request;
- clears the visible error and increments the in-flight count;
- resolves or rejects with the exact operation value or error; and
- never aborts an earlier mutation merely because a newer mutation began.

`pending` remains true until every mutation started by that composable settles. Only the newest-started mutation may write the visible error, so an older failure cannot replace state selected by a
newer call.

## 6. Disposal, cancellation, and error identity

Both composables register `onScopeDispose` exactly once.

Query disposal stops the watcher, invalidates the current generation, aborts the active request, and sets `loading` to false. Mutation disposal aborts every active controller and sets `pending` to
false. Neither path publishes its lifecycle cancellation as an operation error, and no settled request may write after disposal.

The adapter does not wrap or translate an error after dispatch. A generated `ClientResponseError`, protocol error, response validation error, custom transport error, or arbitrary rejection remains the
same object in the returned promise and visible error ref.

Calls made after disposal reject before dispatch with an adapter-owned `ZmdbVueCancellation` error.

## 7. SSR isolation

The binding namespace may safely exist at module scope because it retains only its immutable injection key. SSR request code creates one generated client and `createSSRApp` instance per request and
installs the client on that application.

There is no shared current application, current client, query state, mutation state, credential, or hydration registry. Concurrent SSR applications with different credentials must preserve those
credentials through the generated requests.

The base Vue adapter does not render-trigger server data loading or invent a hydration cache. Explicit server loading and Nuxt-specific hydration belong outside this package.

## 8. Qualification evidence

The issue is qualified by:

- exact named runtime tests in `src/index.spec.ts`;
- generated-client inference checks in `src/index.type-test.ts` and the private adapter type bridge;
- the real Vue effect-scope binding in `fixtures/client-adapters/src/vue-binding.ts`;
- the shared cancellation, stale-result, error-identity, no-retry, mutation-concurrency, SSR-isolation, import, and package conformance cases;
- browser and SSR consumers in `fixtures/client-adapters/vue`; and
- `src/packed-consumer.spec.ts`, which builds and packs `@zmdb/client` and `@zmdb/vue`, installs only those tarballs plus Vue into a temporary project, typechecks without workspace paths, bundles a
  browser entry, runs browser and SSR entries, and executes all common conformance cases.

Vue's runtime creates its documented `__VUE_HMR_RUNTIME__`, `__VUE_INSTANCE_SETTERS__`, and `__VUE_SSR_SETTERS__` hooks when imported. The import-purity fixture permits those Vue-owned keys for this
package while continuing to reject adapter-created globals, network requests, unexpected dependencies, or package metadata drift.

## 9. Explicit non-goals

This package does not provide:

- a shared cache, request de-duplication across composables, retries, polling, focus refetch, or mutation replay;
- Pinia, TanStack Query, router, form, Suspense, or hydration policy;
- a generated-client factory or framework-specific generated client;
- server header/cookie forwarding or a request-scoped Fetch adapter;
- Nuxt module, Nitro, or `useAsyncData` integration; or
- a public cross-framework adapter runtime.

Applications may layer cache/state libraries over the operation callbacks. Nuxt-specific behavior belongs to `@zmdb/nuxt`.
