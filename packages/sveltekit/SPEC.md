# `@zmdb/sveltekit` — request-local SvelteKit client specification

> **Status:** frozen for issue #699 under the common adapter contract in `packages/zmdb/src/client-integrations/SPEC.md`.

## 1. Boundary

`@zmdb/sveltekit` is an ESM-only integration package with physically separate `./client` and `./server` exports and no root barrel.

- `./client` depends inward on `@zmdb/client` and re-exports the native stores and typed context owned by `@zmdb/svelte`.
- `./server` depends inward on `@zmdb/client`, accepts the current SvelteKit request event, and never imports a browser navigation module or Svelte store.
- `@sveltejs/kit@>=2.70.0 <3.0.0` and `svelte@>=5.0.0 <6.0.0` are required peers.
- Neither entry inspects generated-client operations, builds URLs, parses responses, retries requests, or owns a process-global client, request, credential, load, or hydration registry.

Relative TypeScript imports use `.js` specifiers and the package typechecks with `allowImportingTsExtensions: false`.

## 2. Shared generated-client factory

Both entries accept the generated module's public factory:

```ts
export type GeneratedClientFactory<Client> = (options: ClientOptions) => Client;
export type SvelteKitClientOptions = Omit<ClientOptions, 'transport'>;
```

The adapter replaces only `transport`, using `createFetchTransport` from `@zmdb/client`. All request encoding, authentication, cancellation, response validation, and client error identity remain owned
by the generated module and neutral client runtime.

## 3. Server entry

```ts
export interface SvelteKitForwarding {
  readonly headers?: readonly string[];
  readonly cookies?: readonly string[];
}

export interface SvelteKitServerClientOptions extends SvelteKitClientOptions {
  readonly forward?: SvelteKitForwarding;
}

export function createSvelteKitServerFetch(event: Pick<RequestEvent, 'cookies' | 'fetch' | 'request'>, forwarding?: SvelteKitForwarding): typeof globalThis.fetch;

export function createSvelteKitServerClient<Client>(
  event: Pick<RequestEvent, 'cookies' | 'fetch' | 'request'>,
  createClient: GeneratedClientFactory<Client>,
  options: SvelteKitServerClientOptions,
): Client;
```

The fetch wrapper always invokes the current `event.fetch`. It sets `credentials: 'omit'` so SvelteKit cannot implicitly inherit the page request's cookie or authorization header. It then copies only
names explicitly selected by `forward.headers` and `forward.cookies`. No forwarding is the default. Cookie names are validated and serialized from `event.cookies`; `cookie` and `set-cookie` are not
accepted as ordinary header selections.

An allow-listed incoming header cannot silently replace a different generated-client header. Such a conflict is adapter misuse before dispatch and throws `SvelteKitAdapterError`.

The typed server-load helper requires a stable dependency key, creates one client per invocation, calls `event.depends(key)`, and passes `event.request.signal` to the application callback:

```ts
export function createSvelteKitServerLoad<Client, Event, Output>(definition: SvelteKitServerLoadDefinition<Client, Event, Output>): (event: Event) => Promise<Output>;
```

It does not catch, wrap, stringify, or translate a SvelteKit redirect, status error, request-abort reason, generated-client error, or application error.

## 4. Client entry

The client entry exports `createSvelteKitBrowserClient`, which constructs a generated client with the current universal `LoadEvent.fetch`. During a client-side navigation that is SvelteKit's browser
fetch; during hydration it retains SvelteKit's native response reuse and dependency tracking.

It also re-exports these public `@zmdb/svelte` primitives rather than copying their implementation:

- `createZmdbSvelte`;
- `createQueryStore`;
- `createMutationStore`; and
- their public store, snapshot, callback, and binding types.

`createSvelteKitNavigationScope` accepts each native `OnNavigate` value through `track(navigation)`. The signal selected for that navigation aborts only when `navigation.complete` rejects, and uses
that exact rejection as `signal.reason`. A successful navigation clears the selected signal without inventing an abort.

`createSvelteKitClientLoad` requires a stable dependency key, uses `event.fetch`, selects the current navigation signal, and calls the application callback without catching its result. A newer or
otherwise abandoned navigation therefore rejects generated-client work with SvelteKit's original navigation error.

## 5. Request isolation and errors

- Every server-load invocation constructs a distinct generated client and fetch wrapper.
- Forwarded values are read from that invocation's event only.
- The package has no module-level mutable request state.
- Redirects and status errors retain object identity.
- Generated-client errors retain object identity.
- Cancellation retains `AbortSignal.reason` identity.
- Importing either entry performs no request or global registration.

## 6. Qualification

The package closes only with:

- exact named runtime tests:
  - `server load uses event.fetch`;
  - `concurrent requests do not share clients or credentials`;
  - `browser navigation uses browser fetch`;
  - `abandoned navigation aborts work`;
  - `load errors retain framework status handling`;
- compile-only inference through both real public subpaths;
- shared adapter manifest, import-purity, dependency-cycle, and Svelte-store reuse checks;
- a packed external SvelteKit application that installs tarballs, builds both graphs, renders concurrent request-isolated SSR responses, preserves native redirect and status handling, and executes the
  client navigation helper; and
- product catalog, architecture policy, publication metadata, generated documentation, export paths, and measured repository counts updated for the new package.
