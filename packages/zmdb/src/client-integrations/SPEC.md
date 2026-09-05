# SPEC — Official client framework adapters (frozen)

Issue #688, parent #687. This is the architecture contract for the optional UI and meta-framework packages:

- `@zmdb/react`
- `@zmdb/angular`
- `@zmdb/vue`
- `@zmdb/svelte`
- `@zmdb/solid`
- `@zmdb/react-native`
- `@zmdb/next`
- `@zmdb/nuxt`
- `@zmdb/sveltekit`

This file originally froze all nine packages before implementation. Issue #691 now ships `@zmdb/react`; the other eight remain implementation targets. Each implementation issue creates its own
package-level `SPEC.md` and must preserve this common contract. The generated client, request transport, wire format, response validation and client error classes belong to #679 and its implementation
children; this specification does not add another client API.

## 0. Measured starting point

Measured on 2026-09-05 at `cd75aed4`:

- `@zmdb/client` is a published, zero-dependency package with seven public subpaths. The generated-client workflow emits and externally exercises a real client through that runtime. Its package
  contract and `packages/web/src/contract/SPEC.md` remain authoritative; this tests freeze adds no surface to either.
- The repository has no published framework-client adapter package. Issue #689 adds only the private `fixtures/client-adapters` conformance workspace.
- `docs-site/content/framework-integrations.md` documents one- or two-line server framework wrappers over `makeEndpoint`. Those remain recipes, not packages.
- React Native support currently consists of the `@zmdb/aot-validator/metro` transform and structural SQLite driver examples. There is no client-state adapter.
- The committed Metro fixture runs Metro 0.87, preserves an existing Babel transformer and proves the AOT transform. `@zmdb/aot-validator` records `>=0.87.0 <0.88.0` as its supported Metro line.
- The Next.js guide currently calls repositories directly from server components, route handlers and server actions. It documents no generated HTTP client or client-state adapter.
- The architecture and publication gates know about the existing packages, but no rule can validate packages that do not exist. The dependency rules below therefore need executable missing-package
  assertions in #689 and packed-package enforcement in #700.

The framework release lines in §4 were measured with `yarn npm info`, not inferred from old documentation.

## 1. Ownership boundary

### 1.1 The generated client is opaque

An adapter receives an application-generated client or a factory that creates one. It may call methods selected by application code, but it must not:

- inspect an operation registry, generated source, OpenAPI document or `HttpContractIR`;
- derive paths, query strings, headers, bodies or response validators;
- implement a competing transport, intercept final responses or bypass `@zmdb/client`;
- parse or normalize a client error;
- regenerate client types for a framework;
- import the application's generated module from inside a published adapter.

A meta-framework adapter may supply its request-scoped WHATWG `fetch`, selected credentials and framework cache options through the public generated-client factory. That is environment injection, not
another request encoder or response decoder.

The application supplies the generated client type as a generic:

```ts
export type QueryLoader<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;
```

The callback is the boundary. It lets an adapter bind a call to framework lifetime without knowing which operations the generated client has.

### 1.2 Bindings are created for one application client type

A single non-generic global context would widen every generated client to a common base and lose its operation methods. Every base adapter therefore exports a factory whose type parameter is the
application's generated `ApiClient`:

```ts
import type { ApiClient } from './generated/api.js';

const zmdb = createZmdbReact<ApiClient>();
```

The factory creates framework tokens, contexts or accessors, not a client and not a request. Creating bindings at module scope is safe; client instances and request state remain inside the framework
owner. A package may choose framework-native names for the returned members, but it must preserve the generic `Client` type end to end without asking the application for a cast.

There is no shared `@zmdb/client-adapters` runtime package. The common contract is tested by a private conformance harness in #689 and #690. Forcing React, Angular, Vue, Svelte and Solid through one
runtime abstraction would erase the lifecycle differences these packages exist to own.

### 1.3 What an adapter owns

An official adapter may own only:

- framework DI, context, provider, injector, owner, effect-scope or store binding;
- activation and disposal of an `AbortController`;
- framework-native projection of query and mutation state;
- stale-completion suppression after input changes or disposal;
- request-local SSR client construction;
- injection of the framework's request-scoped `fetch`;
- explicit server/browser export separation;
- framework-native request memoization or hydration;
- React Native application state, connectivity and credential-store ports.

Everything else remains in the generated module and `@zmdb/client`.

## 2. Package qualification

### 2.1 The test

An integration earns a package only when every statement below is true:

1. **Native ownership.** It owns behaviour implemented through a framework primitive that the neutral client cannot provide: DI/context, reactive lifetime, subscription cleanup, owner disposal,
   request-local SSR transport, hydration, or an enforced server/browser boundary.
2. **More than construction.** Removing the package would require applications to reproduce a stateful lifecycle protocol, not merely call `createApiClient()` or pass `fetch`.
3. **One inward edge.** It depends only on `@zmdb/client`, its named base adapter where applicable, and required framework peers. It introduces no reverse edge or cycle.
4. **Real qualification evidence.** A packed minimal application exercises the native behaviour through the real framework. A type-only shape or mocked lifecycle is insufficient.
5. **No duplicated client.** Its shipped source contains no URL construction, request serialization, authentication policy, status dispatch or response validation.
6. **No import effect.** Importing the package and creating its binding namespace performs no request, installs no global client and registers no process-global state.

#700 applies the test to the implementation, not merely to this design. A proposed package that cannot demonstrate its qualifying behaviour is deleted from the package and publish lists and replaced
by a documentation recipe.

### 2.2 What remains a recipe

The following do not qualify by themselves:

- an Express, Hono, Fastify, NestJS or tRPC callback that forwards a body to `makeEndpoint`;
- a framework `fetch` passed to a generated client factory with no lifecycle or isolation logic;
- a provider or plugin that only stores and returns a client;
- a TanStack Query query function, NgRx effect, Pinia action or similar cache-library callback;
- an Expo config plugin for the AOT transform;
- an Expo SQLite, OP-SQLite, NetInfo, AsyncStorage or credential-vault wrapper that only adapts a structural application-owned port;
- a package whose complete implementation is a re-export of another adapter.

Recipes are still supported documentation. They simply do not create another package, peer range, release surface or compatibility promise.

### 2.3 Why the nine packages qualify

| Package              | Behaviour unavailable from `@zmdb/client` alone                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `@zmdb/react`        | Context ownership, effect cleanup, dependency changes and React StrictMode/concurrent rendering.     |
| `@zmdb/angular`      | Injector hierarchy, signals, `DestroyRef` cleanup and RxJS unsubscription.                           |
| `@zmdb/vue`          | Application provide/inject, watchers, effect scopes and per-SSR-app isolation.                       |
| `@zmdb/svelte`       | Typed component context, lazy store subscription and final-subscriber teardown.                      |
| `@zmdb/solid`        | Owner graph disposal, resources, Suspense and error-boundary propagation.                            |
| `@zmdb/react-native` | `AppState`, offline refusal, injected credential storage and Metro/device boundary checks.           |
| `@zmdb/next`         | Server/client module separation, request headers/cookies, RSC request memoization and cache options. |
| `@zmdb/nuxt`         | Nitro request context, request-scoped `$fetch`, Nuxt plugin injection and `useAsyncData` hydration.  |
| `@zmdb/sveltekit`    | `RequestEvent.fetch`, request-local `load`, navigation cancellation and framework error propagation. |

This table is a design qualification, not a blanket support claim. `@zmdb/react` has earned its row through the native and packed qualification fixtures in #691; each remaining row stays conditional
on its implementation and packed qualification evidence.

## 3. Common query and mutation semantics

### 3.1 Semantic state

Every base adapter exposes the following information through its native primitives:

```ts
export interface QuerySnapshot<Output> {
  readonly data: Output | undefined;
  readonly error: unknown;
  readonly loading: boolean;
}

export interface MutationSnapshot {
  readonly error: unknown;
  readonly pending: boolean;
}
```

React may expose plain render values, Angular signals, Vue refs, Svelte stores and Solid accessors or resources. The public types do not need to be structurally identical. The conformance harness must
be able to observe the snapshot above without making that harness a runtime dependency.

Every query primitive also exposes `refresh(): Promise<void>`. Every mutation primitive exposes `mutate(input): Promise<Output>`. A mutation result is returned by its promise; adapters do not create a
second result cache.

### 3.2 Activation

- Importing a package, creating bindings, installing a provider/plugin or constructing a context performs no request.
- A query starts only when its framework primitive becomes active: effect activation, injection context activation, watcher/effect-scope activation, first store subscription or Solid resource
  activation.
- Base adapters do not start a request merely because a component is rendered on the server. Server data loading is explicit or belongs to the meta-framework package.
- A mutation starts only when the application calls `mutate`.

### 3.3 Query transitions

For one logical input identity:

1. Before activation: `data === undefined`, `error === undefined`, `loading === false`.
2. Start: retain the last successful `data`, clear `error`, set `loading` to `true`.
3. Success: publish the exact returned value, keep `error` undefined, set `loading` to `false`.
4. Failure: retain the last successful `data`, publish the exact thrown object in `error`, set `loading` to `false`.
5. Explicit refresh: follow the same start/success/failure transitions and return a promise that settles after the selected request settles.

When the input identity changes, clear `data` and `error`, abort the previous request and start the new identity if the primitive remains active. This prevents data for one route parameter from being
displayed under another.

There is at most one live query request per primitive. A new input or refresh aborts the previous one. A monotonically increasing generation still guards every completion because a transport may
ignore an abort signal.

### 3.4 Mutation transitions and concurrency

- Each `mutate(input)` call is an independent request. A later mutation does not abort an earlier mutation: an abort cannot prove a non-idempotent server operation did not execute.
- `pending` is `true` while at least one mutation started by the primitive is unsettled.
- Starting the newest mutation clears the visible `error`.
- Every returned promise resolves or rejects with the exact client result or error for that call.
- Only the newest-started mutation may update the visible `error`; an older completion cannot overwrite state selected by a newer call.
- Disposing the owner aborts every in-flight mutation and prevents all later state writes.

### 3.5 Cancellation

Each request receives a fresh `AbortController`. The adapter aborts it when:

- the owning framework scope is disposed;
- a query's input identity changes;
- a newer refresh supersedes a query;
- a meta-framework navigation or load is abandoned;
- React Native applies its configured background policy.

Lifecycle and supersession aborts are control flow and are not published as query or mutation errors. A promise returned by an explicit `refresh` or `mutate` still rejects with the exact abort reason.
The adapter never replaces `signal.reason`.

React StrictMode may activate, dispose and activate an effect again. The first request must be aborted before the second becomes the only live request. The contract does not pretend that aborting a
dispatched request proves the server never received it.

### 3.6 Error identity

Once a generated client call begins, its error object is never wrapped, cloned, converted to a string or translated to framework state. `Object.is(observedError, thrownError)` must be true.

Adapters may create their own errors only before dispatch for adapter-owned misuse, such as a missing provider or an explicit React Native offline refusal. Next, Nuxt and SvelteKit redirects, status
errors and navigation cancellations remain the framework's original objects.

### 3.7 Cache, de-duplication and retries

- Base adapters have no shared cache and perform no cross-owner request de-duplication.
- Retaining the last successful value inside one live primitive is state, not a cache.
- There is no implicit retry, backoff, refetch-on-focus, polling or mutation replay.
- Applications that need a cache or retry policy wrap the generated operation or use their chosen cache library through a recipe. The official adapter does not depend on TanStack Query, NgRx, Pinia,
  Apollo or another state library.
- The only built-in de-duplication allowed in this epic is request-local RSC memoization and framework-native hydration in the three meta-framework packages.

## 4. Package, peer and export matrix

### 4.1 Version policy

Framework runtimes are required peer dependencies, not bundled dependencies and not optional peers. The exact version used by each packed fixture is a dev dependency of that fixture. Peer ranges cover
the measured current stable line only; this repository does not promise old-major compatibility.

`@types/react` is an optional peer for packages whose declarations name React types and an exact fixture dev dependency. It is not a runtime dependency.

| Peer package    | Exact fixture version | Frozen peer range  |
| --------------- | --------------------- | ------------------ |
| `react`         | `19.2.8`              | `>=19.2.0 <20.0.0` |
| `react-dom`     | `19.2.8`              | `>=19.2.0 <20.0.0` |
| `@types/react`  | `19.2.18`             | `>=19.2.0 <20.0.0` |
| `@angular/core` | `22.1.5`              | `>=22.1.0 <23.0.0` |
| `rxjs`          | `7.8.2`               | `>=7.4.0 <8.0.0`   |
| `vue`           | `3.5.42`              | `>=3.5.0 <4.0.0`   |
| `svelte`        | `5.57.0`              | `>=5.0.0 <6.0.0`   |
| `solid-js`      | `1.9.15`              | `>=1.9.0 <2.0.0`   |
| `react-native`  | `0.87.1`              | `>=0.87.0 <0.88.0` |
| `next`          | `16.3.4`              | `>=16.3.0 <17.0.0` |
| `nuxt`          | `4.5.2`               | `>=4.5.0 <5.0.0`   |
| `@sveltejs/kit` | `2.70.3`              | `>=2.70.0 <3.0.0`  |

`@angular/common`, Angular `HttpClient`, NetInfo, AsyncStorage and native credential vaults are not peers because the adapters do not import them. Their application-owned structural bridges remain
recipes. SvelteKit 2.70.3 currently advertises an optional TypeScript peer only through TypeScript 6; #700 must prove the repository's TypeScript 7 fixture works rather than treating an optional peer
warning as compatibility evidence.

### 4.2 Dependency and export matrix

Every package is ESM-only, has `sideEffects: false`, performs no global registration at import time and follows the repository's source-export/build-repoint convention.

| Package              | Workspace dependencies         | Required framework peers                      | Public exports              |
| -------------------- | ------------------------------ | --------------------------------------------- | --------------------------- |
| `@zmdb/react`        | `@zmdb/client`                 | `react`; optional `@types/react`              | `.`                         |
| `@zmdb/angular`      | `@zmdb/client`                 | `@angular/core`, `rxjs`                       | `.`                         |
| `@zmdb/vue`          | `@zmdb/client`                 | `vue`                                         | `.`                         |
| `@zmdb/svelte`       | `@zmdb/client`                 | `svelte`                                      | `.`                         |
| `@zmdb/solid`        | `@zmdb/client`                 | `solid-js`                                    | `.`                         |
| `@zmdb/react-native` | `@zmdb/client`, `@zmdb/react`  | `react`, `react-native`; optional React types | `.`                         |
| `@zmdb/next`         | `@zmdb/client`, `@zmdb/react`  | `next`, `react`, `react-dom`; optional types  | `./client`, `./server`      |
| `@zmdb/nuxt`         | `@zmdb/client`, `@zmdb/vue`    | `nuxt`, `vue`                                 | `.`, `./client`, `./server` |
| `@zmdb/sveltekit`    | `@zmdb/client`, `@zmdb/svelte` | `@sveltejs/kit`, `svelte`                     | `./client`, `./server`      |

The dependency arrows are:

```text
@zmdb/client
├── @zmdb/react
│   ├── @zmdb/react-native
│   └── @zmdb/next
├── @zmdb/angular
├── @zmdb/vue
│   └── @zmdb/nuxt
├── @zmdb/svelte
│   └── @zmdb/sveltekit
└── @zmdb/solid
```

No arrow points from a base adapter to a meta-framework adapter, from `@zmdb/client` to an adapter, or from any adapter to `@zmdb/web`, the ORM, schema packages, compiler or validator.

These packages are not dependencies or re-exports of the default `zmdb` package. Doing so would make an application that chose one framework install the release surface and peer constraints of all
nine. Cohesion is provided by one generated-client contract and one documentation journey, not by a facade that imports every optional ecosystem.

### 4.3 Environment-separated exports

- `@zmdb/next` has no mixed root barrel. `./client` begins with `'use client'` and reaches `@zmdb/react`; `./server` carries the server-only guard and cannot be resolved into a browser bundle.
- `@zmdb/nuxt` root is the Nuxt module entry. `./client` contains the browser plugin/composables and `./server` contains Nitro request integration. The module may register those entries but importing
  it performs no request or global client registration.
- `@zmdb/sveltekit` has no mixed root barrel. `./client` reaches `@zmdb/svelte`; `./server` accepts a request event and never enters the browser graph.
- `@zmdb/react-native` has no `./metro` export. The AOT Metro transform remains `@zmdb/aot-validator/metro`; the client adapter owns device lifecycle only.
- Base adapter roots contain no server secret, Node built-in or meta-framework import.

## 5. SSR, hydration and credential ownership

### 5.1 Request isolation

There is no module-level current client, current request, credential, query state or hydration registry. Each SSR request creates its client and adapter owner from the framework's request object. Two
concurrent requests carrying different credentials must remain distinguishable through the real packed framework fixture.

Server helpers forward no cookie or header by default. The application supplies an allow-list of names. An adapter must not forward the entire incoming `cookie`, `authorization` or header collection
merely because the framework exposes it.

Generated clients, transports, request objects, credentials and errors are never serialized into hydration payloads.

### 5.2 Base adapters

React, Angular, Vue, Svelte and Solid provide request-local context/injector/app/tree/owner state for SSR but do not invent a cross-framework hydration cache. An application may render existing data
through ordinary props or framework state. Explicit server data loading remains outside the base adapter.

### 5.3 Meta-framework adapters

- **Next:** server and browser clients are separate. RSC memoization is scoped to one request and must not use a process-global map. Next cache, revalidation and `no-store` policy is explicit when
  constructing the request-scoped fetch supplied to the generated client; it does not add fields to #679's `ClientRequest` or `CallOptions`.
- **Nuxt:** `useAsyncData` owns hydration. The helper requires an explicit stable operation key and serializable input; it does not inspect generated-client metadata. A matching hydrated success is
  consumed without a second browser request.
- **SvelteKit:** server `load` data owns hydration. The helper requires an explicit stable key when more than one operation shares a load and preserves native redirects/status errors. Browser
  navigation uses browser fetch and aborts an abandoned navigation.

A hydration key mismatch or absent payload starts a normal client request. Framework payloads may contain only already-validated operation results and explicit serializable inputs.

## 6. Framework-specific boundaries

### 6.1 React

The binding factory owns one React context. The provider is isolated per tree. Query effects abort on dependency changes and unmount; mutation controllers abort on unmount. Missing-provider errors
name the binding and explain that its provider is absent. StrictMode leaves at most one live request after its setup/cleanup replay. Issue #691 implements this contract in `@zmdb/react`.

### 6.2 Angular

The binding factory owns a typed `InjectionToken<Client>`. Providers respect injector hierarchy. Queries expose Angular signals and bind controllers to `DestroyRef`. The RxJS bridge aborts on final
unsubscribe. The package does not require `HttpClient`; applications that want it adapt its fetch shape outside the package.

### 6.3 Vue

The binding factory owns an `InjectionKey<Client>` and plugin. Queries use refs/watchers and `onScopeDispose`. Each `createSSRApp` installation owns separate client and state. Installing the plugin
does not activate a query.

### 6.4 Svelte

The binding factory owns a typed context key. A query store starts on first subscription and aborts when its final subscriber leaves. A later subscription starts a new request. Input-store changes
abort and generation-guard the previous request.

### 6.5 Solid

The binding factory owns a Solid context. Query resources bind cleanup to the current owner and preserve Solid's native pending promise and thrown error for Suspense and error boundaries. Source
changes use the latest input and suppress earlier completion.

### 6.6 React Native

The package reuses `@zmdb/react` bindings rather than copying hooks. It accepts structural connectivity and credential-store ports supplied by the application. Offline refusal happens before dispatch.
Foreground refresh is opt-in. Background behaviour is an explicit policy: abort active queries, leave them running, or abort and mark them refreshable; there is no hidden default retry.

The packed fixture must traverse the existing Metro transform and prove that no Node built-in, server export or credential implementation reaches the device bundle.

### 6.7 Next

The server entry accepts the generated client factory, request-scoped fetch, explicit header/cookie allow-lists and an explicit Next fetch-cache policy. That policy decorates the framework fetch
supplied at client construction; it does not change the neutral request contract. The client entry reuses `@zmdb/react`. RSC memoization is request-local. No server module, environment read or
credential literal is reachable from `./client`.

### 6.8 Nuxt

The module installs request-local server and browser plugins. The server entry uses the current Nitro event's fetch and allow-listed credentials. The client entry reuses `@zmdb/vue`. `useAsyncData`
integration uses explicit stable keys and native payload hydration rather than a second cache.

### 6.9 SvelteKit

The server entry accepts the current `RequestEvent` and uses `event.fetch`. Typed load helpers keep redirects, status errors and aborts as SvelteKit values. The client entry reuses `@zmdb/svelte`;
abandoned navigation aborts its request.

## 7. Acceptance inherited by implementation issues

The tests freeze in #689 must name and execute at least:

- `does not request before the framework primitive activates`;
- `cancels when the owning scope is disposed`;
- `ignores a stale response after inputs change`;
- `preserves ClientResponseError identity`;
- `does not share request state across SSR requests`;
- `does not retry without explicit policy`;
- `imports without executing network I/O`;
- `accepts a generated client without inspecting its contract`;
- `framework package has only expected peers`;
- `every proposed package names framework behaviour unavailable from @zmdb/client alone`;
- `the dependency graph from meta-framework to base adapter is acyclic`.

#700 must additionally prove from packed applications:

- each retained package exercises the qualifying native behaviour in §2.3;
- every public export imports in its intended environment;
- server entries are absent from browser/device bundles;
- no adapter contains client transport, URL or response-validation implementation;
- exact fixture versions satisfy the frozen peer ranges;
- a default `zmdb` installation contains none of the adapter packages or framework peers.

## 8. Rejected alternatives

- No framework-specific generated client.
- No OpenAPI-derived React hooks or operation-metadata inspection.
- No global client singleton.
- No common runtime adapter abstraction.
- No built-in cache, retry engine, polling or refetch-on-focus policy.
- No automatic forwarding of all cookies or headers.
- No root barrel that mixes server and client exports.
- No `zmdb/react`, `zmdb/next` or other umbrella re-export that would pull optional peers into the default product.
- No package for a two-line wrapper or application-owned native service.
- No runtime adapter implementation in issue #688.
