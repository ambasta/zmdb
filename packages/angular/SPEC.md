# @zmdb/angular — generated-client bindings

> **Status:** implemented by issue #692 under the common adapter contract frozen by #688 and exercised through the private #690 conformance harness.

## 1. Responsibility

`@zmdb/angular` binds one application-generated client type to Angular dependency injection, signals, `DestroyRef`, and RxJS subscription lifetime. It does not create a client, inspect generated
operations, construct URLs, serialize requests, validate responses, retry calls, cache results, or import an application-generated module.

The application creates one binding namespace for its generated client type:

```ts
import type { ApiClient } from './generated/api.js';
import { createZmdbAngular } from '@zmdb/angular';

export const zmdb = createZmdbAngular<ApiClient>('application API client');
```

The namespace owns one `InjectionToken<ZmdbClientRef<ApiClient>>` and preserves the exact client type through provider, injection, query, mutation, and Observable callbacks. The one-property holder is
intentional: Angular 22.1.5 probes every resolved provider value for `ngOnDestroy`. Providing the generated client object directly therefore makes Angular inspect an otherwise opaque application
contract. Angular probes the frozen holder instead, while `injectZmdbClient()` returns the original client by identity. Creating the namespace or a provider performs no request and registers no
adapter global state.

## 2. Public root

The package publishes only `"."`:

```ts
export type QueryLoader<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;

export type MutationRunner<Client, Input, Output> = (client: Client, input: Input, signal: AbortSignal) => PromiseLike<Output>;

export interface ZmdbSignalQuery<Input, Output> {
  readonly data: Signal<Output | undefined>;
  readonly error: Signal<unknown>;
  readonly loading: Signal<boolean>;
  setInput(input: Input): void;
  refresh(): Promise<void>;
}

export interface ZmdbSignalMutation<Input, Output> {
  readonly error: Signal<unknown>;
  readonly pending: Signal<boolean>;
  mutate(input: Input): Promise<Output>;
}

export interface ZmdbClientRef<Client> {
  readonly client: Client;
}

export interface ZmdbAngularBindings<Client> {
  readonly ZMDB_CLIENT: InjectionToken<ZmdbClientRef<Client>>;
  provideZmdbClient(client: Client): EnvironmentProviders;
  injectZmdbClient(): Client;
  zmdbQuery<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): ZmdbSignalQuery<Input, Output>;
  zmdbMutation<Input, Output>(run: MutationRunner<Client, Input, Output>): ZmdbSignalMutation<Input, Output>;
  zmdbObservable<Input, Output>(input: Input, load: QueryLoader<Client, Input, Output>): Observable<Output>;
}

export function createZmdbAngular<Client>(description?: string): ZmdbAngularBindings<Client>;
```

The methods that inject Angular values must run in an Angular injection context. Missing providers retain Angular's native `NullInjectorError`; the adapter does not hide or translate it.

## 3. Query and mutation lifecycle

Creating `zmdbQuery` is the Angular activation boundary. It injects the nearest client and `DestroyRef`, publishes `data`, `error`, and `loading` as read-only signals, and starts exactly one request.
`setInput` clears data and error, aborts the previous request, and starts the new identity. `refresh` retains successful data while replacing the active request.

Every request receives a fresh `AbortController`. A monotonically increasing generation suppresses a completion from a transport that ignores abort. Client errors retain object identity. Lifecycle and
supersession aborts are not written into `error`, and there is no implicit retry.

Each `mutate` call owns an independent controller and promise. Later mutations do not abort earlier non-idempotent calls. `pending` remains true while any call is unsettled; only the newest-started
mutation may publish a visible error. Destroying the injector aborts all active queries and mutations and prevents later state writes.

## 4. Observable bridge

`zmdbObservable` is cold. Each subscription injects no new global state and owns one generated-client request. Unsubscribing before settlement aborts that exact request. Injector destruction aborts
all subscriptions in the scope and completes them without publishing the lifecycle cancellation as a client error. Success and failure retain the exact client value or error.

The bridge is intentionally not a cache, shared replay stream, polling source, retry policy, or NgRx abstraction.

## 5. Injector and SSR isolation

`provideZmdbClient` returns `EnvironmentProviders`. Normal Angular parent/child resolution applies: a child inherits its parent client unless it provides an override. The injected holder prevents
Angular's lifecycle-hook probe from touching the generated client; the public injection helper still returns that original client object. SSR applications create one request injector and one client
per request. There is no module-level current client, credential, query state, or hydration registry.

Two concurrent request injectors with distinct generated clients and credentials therefore remain isolated. Destroying one request injector cannot cancel or replace requests owned by another.

## 6. Dependencies and refusal of HttpClient ownership

The committed dependency boundary is:

- workspace dependencies: none; generated clients use `@zmdb/client`, but this adapter receives their public method shape without importing or inspecting that runtime;
- required peers: `@angular/core` at `>=22.1.5 <23.0.0` and `rxjs` at `>=7.8.2 <8.0.0`;
- exact conformance versions: Angular `22.1.5` and RxJS `7.8.2`.

`@angular/common` and `HttpClient` are not imported, bundled, or declared as peers. Applications that choose `HttpClient` adapt it while constructing their generated client; this package receives the
finished structural client and never duplicates transport logic.

The package has no workspace dependency and no dependency on `@zmdb/web`, schema, compiler, ORM, database, server, cache, state-management, or private conformance-harness code. Its root is ESM-only
and side-effect free. Import qualification first loads the required Angular/RxJS peers, whose own baseline includes Angular's `ngDevMode` and devtools globals, then proves importing `@zmdb/angular`
adds no request or additional global registration.

## 7. Qualification

Issue #692 proves:

- generated-client input and output inference at the published package boundary;
- parent inheritance and child injector override;
- signal transitions, stale-result suppression, exact error identity, no retry, and independent mutations through the shared conformance suite;
- query and mutation cancellation through `DestroyRef`;
- exact Observable cancellation on unsubscribe;
- concurrent SSR credential isolation;
- import success without `@angular/common` or `HttpClient`; and
- a packed browser bundle plus a packed Node SSR consumer using tarballs rather than workspace links.

Issue #700 adds broader application-level qualification without replacing or weakening these package-owned checks.
