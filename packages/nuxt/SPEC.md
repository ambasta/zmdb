# `@zmdb/nuxt` — Nuxt plugin, SSR transport and hydration SPEC

> Issue #698, parent #687. This package implements the Nuxt meta-framework row frozen in [`packages/zmdb/src/client-integrations/SPEC.md`](../zmdb/src/client-integrations/SPEC.md).

## 1. Package boundary

`@zmdb/nuxt` is ESM-only and publishes:

- `.` as the Nuxt module entry;
- `./client` as the Vue/client binding and browser-plugin entry; and
- `./server` as the Nitro request-transport and server-plugin entry.

Its only production workspace dependencies are `@zmdb/client` and `@zmdb/vue`. Nuxt `>=4.5.2 <5.0.0` and Vue `>=3.5.42 <4.0.0` are required peers. The package has no dependency on web, ORM, schema,
validator, database, Node built-in, cache, state-management, or competing HTTP packages.

Importing any entry performs no request, creates no client, reads no request or environment state, and registers no process-global value. The root module generates framework-only plugin templates when
Nuxt invokes module setup; the public client and server entries remain importable outside a Nuxt build.

## 2. Application integration and module options

The application owns one integration module that exports:

1. a generated-client factory compatible with `(options: ClientOptions) => Client`; and
2. a `ZmdbNuxtBindings<Client>` value created with the application's generated client type and Nuxt's native `useAsyncData`.

The Nuxt module accepts:

```ts
export interface ZmdbNuxtModuleOptions {
  readonly integration: string;
  readonly bindingExport?: string;
  readonly clientFactoryExport?: string;
  readonly baseUrl?: string;
  readonly forwardHeaders?: readonly string[];
  readonly forwardCookies?: readonly string[];
}
```

`integration` is required. Export names must be JavaScript identifiers. `bindingExport` defaults to `zmdb`, `clientFactoryExport` to `createApiClient`, and `baseUrl` to `/api`. Duplicate or invalid
allow-list entries are rejected during setup.

The module resolves the application integration once and generates separate `.server` and `.client` Nuxt plugins. Generated code imports the named application values; the published package never
imports an application's generated source.

## 3. Vue reuse and browser plugin

```ts
export function createZmdbNuxt<Client extends object>(options: ZmdbNuxtBindingOptions): ZmdbNuxtBindings<Client>;
```

`createZmdbNuxt` creates exactly one `@zmdb/vue` binding namespace and returns all four real Vue members unchanged:

- `createZmdbPlugin`;
- `useZmdbClient`;
- `useZmdbQuery`; and
- `useZmdbMutation`.

It adds only `useZmdbAsyncData`. This package does not copy Vue query state, mutation state, watcher, generation, or disposal logic.

`createZmdbNuxtClientPlugin` creates a generated client with an explicit browser `createFetchTransport`, installs the inherited Vue plugin on the current Nuxt Vue application, and performs no request.
No server event, Nitro fetch, incoming header, cookie, or credential literal is reachable from `./client`.

## 4. Request-scoped server transport

The generated server plugin receives the current Nuxt application's SSR event and Nitro's bare local fetch. It creates one transport, client, and Vue installation per plugin invocation. No client,
event, transport, incoming headers, or credentials are retained outside that request's application.

`createNuxtServerTransport(fetch, incomingHeaders, options)`:

1. normalizes and freezes the explicit header and cookie allow-lists;
2. snapshots only selected incoming header values;
3. parses the incoming cookie header without decoding values and retains only selected cookie names;
4. creates a WHATWG fetch wrapper over Nitro local fetch for each generated-client request;
5. adds selected values only when the generated operation did not already provide that header;
6. moves an operation-owned cookie header across the generic Fetch boundary without changing its value; and
7. delegates URL resolution, cancellation, response conversion, status handling, size bounds, decoding, validation, and errors to `@zmdb/client`.

`cookie` may not appear in `forwardHeaders`; applications must name individual cookies through `forwardCookies`. Transport-owned request headers (`accept`, `content-type`, `content-length`, `host`,
`connection`, and `transfer-encoding`) cannot be forwarded from the incoming request.

With empty allow-lists, no incoming credential is forwarded. Two concurrent Nitro requests with different headers or cookies receive different clients and transports.

## 5. Stable keys and native hydration

```ts
useZmdbAsyncData<Input, Output>(
  operationKey: string,
  input: MaybeRefOrGetter<Input>,
  load: QueryLoader<Client, Input, Output>,
): ZmdbNuxtAsyncData<Output>;
```

The operation key is explicit and non-empty. The adapter does not inspect generated-client methods, operation registries, OpenAPI, route metadata, function source, or callback identity.

`createNuxtDataKey(operationKey, input)` canonicalizes the pair:

- object keys are sorted;
- array order is retained, and arrays must be dense with no named properties;
- strings, booleans, `null`, finite numbers, plain objects, and arrays are accepted; and
- cycles, non-finite numbers, class instances, `undefined`, bigint, symbol values or keys, and function values are rejected.

Equal operation/input values therefore produce byte-identical keys independently of object property insertion order. Different operation keys or inputs produce different keys.

`useZmdbAsyncData` passes a reactive computed key and the exact native `useAsyncData` supplied by the application. It forces shallow data and native `dedupe: 'cancel'`, but does not override
`getCachedData`, payload storage, server execution, hydration, refresh, error conversion, or navigation handling. A matching server payload is consumed by Nuxt without invoking the browser handler.
When the reactive input changes, native key watching selects the new entry and the handler calls the browser-injected generated client.

Only validated operation output and the explicit serializable input influence hydration. Clients, transports, request events, credentials, signals, and errors are never placed in a package-owned
payload or cache.

## 6. Cancellation and errors

Native `useAsyncData` supplies a fresh `AbortSignal` to the operation callback. Nuxt owns cancellation when a request is de-duplicated, a key changes, a scope is disposed, or navigation abandons the
load. The adapter forwards that exact signal and never replaces its reason.

The generated client remains responsible for transport and response errors. The adapter does not catch, retry, normalize, or serialize them. Nuxt's documented `useAsyncData` error projection remains
the native public behavior.

The inherited Vue composables retain their existing `@zmdb/vue` cancellation, stale-completion, mutation-concurrency, and error-identity semantics.

## 7. Qualification evidence

The issue is qualified by:

- exact named runtime tests for Nitro request isolation, selected credentials, request-scoped fetch, stable keys, native hydration, and browser transport switching;
- compile-only generated-client inference for all three public entries;
- the shared adapter contract running through `createZmdbNuxt` and the real Vue effect-scope lifecycle;
- import-purity and package-matrix checks for `.`, `./client`, and `./server`; and
- a packed Nuxt 4.5.2 application that installs only package tarballs and declared peers, builds through the real module, renders concurrent SSR requests, verifies credential isolation, observes a
  native Nuxt payload, and exercises the packed browser plugin separately.

## 8. Explicit non-goals

This package does not provide:

- a generated client or framework-specific operation generator;
- URL construction, request serialization, authentication policy, response parsing, or validation;
- a second cache, payload registry, retry loop, polling, focus refetch, mutation replay, Pinia, or TanStack Query;
- automatic forwarding of all headers or cookies;
- a global client singleton;
- a root barrel mixing server and client runtime implementations;
- Vue composable reimplementations; or
- a default `zmdb` facade export.
