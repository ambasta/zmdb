# `@zmdb/solid` — Solid client adapter specification

> **Status:** implemented by issue #695 over the generated-client and adapter-conformance boundaries from #684 and #690.

## 1. Responsibility

The package binds one application-generated client type to Solid context, resources and owner disposal. It does not inspect generated metadata, encode requests, validate responses, wrap client errors,
cache across owners or retry requests.

`createZmdbSolid<Client>()` creates a private context and returns:

- `Provider`, which installs one `Client` for the current Solid owner tree;
- `useClient()`, which returns that exact client or rejects use outside the provider;
- `query(source, load)`, which creates a native Solid resource; and
- `mutation(run)`, which creates owner-scoped mutation state.

Creating the binding namespace or provider performs no request.

## 2. Query resources

`source` is either a Solid accessor or one fixed input value. The loader receives the context client, current input and a fresh `AbortSignal`. A native returned promise is passed unchanged to
`createResource`; another promise-like value is normalized to the native promise Solid expects. Solid therefore owns Suspense tracking and throws the original client error to its error boundary, while
`pending()` retains the exact loader result.

Each source change or explicit refresh aborts the previous request. A generation guard prevents a transport that ignores cancellation from publishing stale data. A source identity change clears
`latest`; refresh retains it. Owner disposal aborts the active request and prevents later writes.

The query exposes:

- `data`, the native `Resource<Output>`;
- `latest()`, the last successful value without reading through a resource error;
- `error()` and `loading()`, projections of native resource state;
- `pending()`, the exact promise-like value currently supplied by the loader; and
- `refresh(): Promise<void>`.

## 3. Mutations

Every `mutate(input)` call receives a fresh controller and runs independently. A later mutation does not abort an earlier non-idempotent operation. `pending()` remains true while any call is
unsettled; only the newest-started call may update `error()`. Results and errors retain identity. Owner disposal aborts every active mutation and suppresses later state writes.

## 4. Package boundary

- Runtime workspace dependency: `@zmdb/client` at `workspace:^`.
- Required peer: `solid-js` at `>=1.9.15 <2.0.0`.
- Public export: `.` only.
- ESM-only, `sideEffects: false`, no Node built-in or private conformance-harness import.

The package is not re-exported by `zmdb`; applications install it only when they choose Solid.

## 5. Qualification

Executable evidence covers the six issue-named behaviours, the common adapter conformance suite, generated-client type inference, package/peer rules, a browser-condition packed consumer, and an SSR
packed consumer. The packed consumers install tarballs rather than workspace symlinks.
