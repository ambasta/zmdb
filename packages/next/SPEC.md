# `@zmdb/next` — request-scoped App Router client SPEC

> Issue #697, parent #687. This package implements the Next.js slice of the common client-adapter contract frozen by #688 and exercised by the private harness delivered in #690.

## 1. Physical package boundary

`@zmdb/next` is ESM-only and has no mixed root export:

- `@zmdb/next/client` begins with `'use client'` and re-exports the `@zmdb/react` binding factory as `createZmdbNextClient`;
- `@zmdb/next/server` begins with `import 'server-only'` and owns every request, credential and cache concern.

The package depends inward on `@zmdb/client` and `@zmdb/react`. `server-only@0.0.1` is the executable Next boundary marker. Next 16.3, React 19.2 and React DOM 19.2 are required peers; React
declaration packages are fixture/dev dependencies rather than production peers. The package is not re-exported by `zmdb`.

## 2. Server request scope

```ts
export async function createNextServerClient<Client extends object>(options: NextServerClientOptions<Client>): Promise<NextServerClient<Client>>;
```

`createClient` is the application-generated `(options: ClientOptions) => Client` factory. `baseUrl` and `fetch` are explicit. When `request` is omitted, the public server entry awaits Next's current
`headers()` and `cookies()` stores from the documented `next/headers` entry. That import occurs only while creating an implicit request scope, so importing the guarded server entry performs no Next
request-module initialization. Route handlers and tests may instead supply structurally compatible stores explicitly.

No header or cookie is forwarded by default. `forward.headers` is case-insensitive and `forward.cookies` is case-sensitive; duplicate, malformed or injection-capable names and values are rejected. The
selected ordinary headers become `@zmdb/client` option headers, so its conflict and transport-owned-header checks still apply. Selected cookies are attached by the Next fetch decorator after the
neutral `createFetchTransport` has prepared the request. This is the only server-specific difference: URL planning, request bodies, cancellation, response limits, decoding and stable errors stay in
`@zmdb/client`.

`clientHeaders` carries application-owned server headers such as a service credential and is conflict-checked against forwarded headers. Generated operation headers still retain their existing
ownership and collision rules.

## 3. Next fetch policy

```ts
export interface NextFetchPolicy {
  readonly cache?: RequestCache;
  readonly next?: {
    readonly revalidate?: number | false;
    readonly tags?: string[];
  };
}
```

The adapter applies the exact supplied `cache` value and `next` object to every call through the request scope. It invents no default cache mode, revalidation interval, tag, retry or invalidation.
`cache: 'no-store'` therefore remains an explicit caller decision.

## 4. Request-local memoization

Each returned request scope owns its generated client and exposes:

```ts
memoize<Arguments extends readonly unknown[], Result>(
  load: (client: Client, ...arguments_: Arguments) => PromiseLike<Result>,
  key: (...arguments_: Arguments) => string,
): (...arguments_: Arguments) => Promise<Result>;
```

Each memoized loader owns a promise map inside that one request scope. Concurrent duplicate keys share one exact promise, including its value or rejection. Another request scope receives another map
even when it uses the same loader and key text. There is no module-level map, current request, client, credential, hydration registry or cache.

The explicit key prevents the adapter from serializing generated-client input, inspecting operation metadata or imposing an equality policy. Constructing a scope or memoized loader performs no
request.

## 5. Browser lifecycle

`createZmdbNextClient` is the same function object as `createZmdbReact`. The package adds no second provider or hook implementation. Provider isolation, effect activation, abort, stale-result
suppression, exact error identity, no implicit retry and server-render behavior therefore remain the `@zmdb/react` contract.

The client entry cannot reach the server entry, `server-only`, Next request APIs, environment values or credentials. A real Next client-component build rejects an attempted server import, and the
packed fixture scans emitted browser chunks for the server credential canary and server modules.

## 6. Packed App Router qualification

The packed fixture installs built tarballs for `@zmdb/client`, `@zmdb/react` and `@zmdb/next` with Next 16.3.4, React 19.2.8 and React DOM 19.2.8. It:

1. proves a client component importing `@zmdb/next/server` fails the real Next build through the `server-only` marker;
2. builds a valid App Router application with a server component, route handler and client component;
3. starts the production Next server and sends two requests with distinct selected and unselected credentials;
4. proves duplicate server-component and route-handler loads share one upstream call only inside their request;
5. proves the browser binding renders through the reused React provider; and
6. verifies the credential canary exists in server output and is absent from every browser chunk.

No benchmark result is generated by this package. Framework benchmark measurement remains deferred to the roadmap's benchmark issue.
